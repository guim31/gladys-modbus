// -----------------------------------------------------------------------------
// Integration configuration.
//
// The form is flat (Gladys has no list of objects in a config_schema): four
// device slots, `device_<n>_host`, `_port`, `_unit_id`, `_profile`,
// `_framing` and `_registers`. A slot without a host is unused. DEFAULT_CONFIG
// mirrors the `default` values of the manifest (test/manifest.test.js).
// -----------------------------------------------------------------------------

import { DEFAULT_LANGUAGE, LANGUAGES } from './i18n.js';
import { FRAMINGS } from './modbus/connection.js';
import { PROFILE_IDS } from './profiles/index.js';
import { parseRegisters } from './registers.js';

export const SLOT_COUNT = 4;
export const POLL_INTERVALS = ['5', '10', '15', '30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  language: DEFAULT_LANGUAGE,
  poll_interval: '30',
  timeout: 3,
  allow_write: false,
  ...Object.fromEntries(
    Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).flatMap((n) => [
      [`device_${n}_port`, 502],
      [`device_${n}_unit_id`, 1],
      [`device_${n}_profile`, 'custom'],
      [`device_${n}_framing`, 'tcp'],
    ]),
  ),
};

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    // An emptied field arrives as null or "": keep the default.
    if (value !== null && value !== undefined && value !== '') {
      config[key] = value;
    }
  }
  if (!LANGUAGES.includes(config.language)) {
    config.language = DEFAULT_LANGUAGE;
  }
  if (!POLL_INTERVALS.includes(String(config.poll_interval))) {
    config.poll_interval = DEFAULT_CONFIG.poll_interval;
  }
  config.poll_interval = String(config.poll_interval);
  const timeout = Number(config.timeout);
  config.timeout = Number.isFinite(timeout) ? Math.min(30, Math.max(1, timeout)) : 3;
  config.allow_write = config.allow_write === true || config.allow_write === 'true';
  return config;
}

/** Milliseconds between two reads. */
export function pollIntervalMs(config) {
  return Number(config.poll_interval) * 1000;
}

/**
 * The configured devices, and what is wrong in the configuration.
 * @param {object} config normalized
 * @returns {{ slots: Array<object>, errors: Array<{ slot, code, params }>, targets: Map }}
 *   `targets`: the connection of every slot with a valid address, even when
 *   its registers are wrong or missing (what the "Test a read" action needs).
 */
export function readSlots(config) {
  const slots = [];
  const errors = [];
  const targets = new Map();
  for (let n = 1; n <= SLOT_COUNT; n += 1) {
    const host = String(config[`device_${n}_host`] ?? '').trim();
    const registersText = String(config[`device_${n}_registers`] ?? '');
    if (host === '') {
      if (registersText.trim() !== '') {
        errors.push({ slot: n, code: 'registersWithoutHost' });
      }
      continue;
    }
    const error = (code, params = {}) => errors.push({ slot: n, code, params });
    // A host name or an IPv4 address: no scheme, no port, no credentials.
    if (!/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host)) {
      // Never echo credentials typed by mistake (user:password@host).
      error('badHost', { host: host.replace(/^.*@/, '…@').slice(0, 64) });
      continue;
    }
    const port = Number(config[`device_${n}_port`]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      error('badPort', { port: config[`device_${n}_port`] });
      continue;
    }
    const unitId = Number(config[`device_${n}_unit_id`]);
    if (!Number.isInteger(unitId) || unitId < 0 || unitId > 255) {
      error('badUnitId', { unitId: config[`device_${n}_unit_id`] });
      continue;
    }
    const framing = String(config[`device_${n}_framing`]);
    if (!FRAMINGS.includes(framing)) {
      error('badFraming', { framing });
      continue;
    }
    const profileId = String(config[`device_${n}_profile`]);
    targets.set(n, { index: n, host, port, unitId, framing, profileId });
    if (!PROFILE_IDS.includes(profileId)) {
      error('badProfile', { profile: profileId });
      continue;
    }
    const twin = slots.find(
      (slot) =>
        slot.host.toLowerCase() === host.toLowerCase() &&
        slot.port === port &&
        slot.unitId === unitId,
    );
    if (twin) {
      error('duplicateSlot', { other: twin.index });
      continue;
    }
    const { entries, errors: registerErrors } = parseRegisters(registersText);
    for (const registerError of registerErrors) {
      errors.push({ slot: n, code: 'register', params: registerError });
    }
    if (profileId === 'custom' && entries.length === 0) {
      if (registerErrors.length === 0) {
        error('nothingToRead');
      }
      continue;
    }
    slots.push({
      index: n,
      host,
      port,
      unitId,
      profileId,
      framing,
      entries,
      platformId: platformId(host, port, unitId),
    });
  }
  return { slots, errors, targets };
}

/**
 * The stable part of a device's external id: its Modbus address. A Modbus
 * device has no identity of its own that every device exposes (an Eastron
 * meter has no readable serial number): the address is what the user
 * configured, and stays when the slot changes. Give the device a fixed IP.
 */
export function platformId(host, port, unitId) {
  return `${host.toLowerCase().replace(/[^a-z0-9.-]/g, '-')}-${port}-${unitId}`;
}
