// -----------------------------------------------------------------------------
// The hub: the configured devices, their connections, what their probe found,
// and what the last read gave. Everything the SDK handlers do goes through it.
//
// - A device is published to Gladys once its features are known: at once for
//   a meter or custom registers, after its probe for SunSpec, Huawei and
//   Victron (kept in /data, so a device asleep at restart is still published).
// - A read cycle reads the devices the user added to Gladys, publishes the
//   values that changed (plus a heartbeat every 6 hours) and follows their
//   reachability: one log line and one scene event when a device stops
//   answering, one when it answers again.
// - The connection status of the Configuration screen says what is wrong:
//   configuration mistakes entry by entry, devices that do not answer.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { pollIntervalMs, readSlots } from './config.js';
import { joinLines, localize, pick } from './i18n.js';
import { PROFILE_ERRORS, SLOT_LABEL, STATUS, configErrorText, writeError } from './messages.js';
import { ConnectionPool, isUnreachable } from './modbus/connection.js';
import { encodeValue } from './modbus/datatypes.js';
import { BlockReader } from './modbus/reader.js';
import { STATES, featureName } from './names.js';
import { ProfileError, pointId } from './profiles/common.js';
import { PROFILES, customFeature } from './profiles/index.js';
import { roundTo } from './registers.js';
import { createIssueLog } from './issues.js';

const logger = createLogger({ name: 'modbus' });

export const DEVICE_TYPE = 'modbus';
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
/** Failed cycles in a row before a device that answered is declared lost. */
export const UNREACHABLE_AFTER = 2;
/** The core accepts 300 states a minute: keep a margin for the heartbeats. */
export const STATE_BUDGET_PER_MINUTE = 240;
export const TRIGGERS = { UNREACHABLE: 'device_unreachable', REACHABLE: 'device_reachable' };

export const ALL_REFUSED = {
  en: 'the device answers but refuses every register (Modbus exception): check the profile, the unit id and the addresses.',
  fr: "l'appareil répond mais refuse tous les registres (exception Modbus) : vérifiez le profil, l'identifiant d'esclave et les adresses.",
  de: 'das Gerät antwortet, lehnt aber jedes Register ab (Modbus-Ausnahme): Prüfe Profil, Unit-ID und Adressen.',
  es: 'el dispositivo responde pero rechaza todos los registros (excepción Modbus): compruebe el perfil, el identificador de esclavo y las direcciones.',
};

export class ModbusHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store src/store.js
   * @param {Function} [options.createSocket] test seam for the connections
   * @param {() => number} [options.now]
   * @param {() => void} [options.onReachabilityChange]
   */
  constructor({ gladys, store, createSocket, now = () => Date.now(), onReachabilityChange }) {
    this.gladys = gladys;
    this.onReachabilityChange = onReachabilityChange ?? (() => {});
    this.store = store;
    this.now = now;
    this.pool = new ConnectionPool({ createSocket, now });
    this.config = null;
    this.runtimes = new Map(); // slot index -> runtime
    this.targets = new Map();
    this.errors = [];
    this.lastStatus = null;
    this.slowedDown = false;
    this.issues = createIssueLog(logger);
  }

  // --- Configuration ---------------------------------------------------------------

  /**
   * Apply a configuration: rebuild the devices, probe them, publish them.
   * @param {object} config normalized
   */
  async configure(config) {
    this.pool.closeAll();
    this.config = config;
    const { slots, errors, targets } = readSlots(config);
    this.errors = errors;
    this.targets = targets;
    const previous = this.runtimes;
    this.runtimes = new Map();
    for (const slot of slots) {
      const old = previous.get(slot.index);
      const profile = PROFILES[slot.profileId];
      this.runtimes.set(slot.index, {
        slot,
        profile,
        ids: this.gladys.externalIds(DEVICE_TYPE, slot.platformId),
        layout: profile.probe ? await this.cachedLayout(slot) : {},
        features: [],
        reader: new BlockReader(),
        // Same device as before: keep what we know of its reachability.
        status:
          old && old.slot.platformId === slot.platformId
            ? old.status
            : { reachable: null, failures: 0, lastReadAt: null, error: null },
      });
    }
    for (const runtime of this.runtimes.values()) {
      this.buildFeatures(runtime);
    }
    const count = this.runtimes.size;
    logger.info(
      `Configuration: ${count} device(s)${errors.length ? `, ${errors.length} mistake(s)` : ''}` +
        `${config.allow_write ? ', writing allowed' : ''}`,
    );
    for (const error of errors) {
      logger.warn(`Configuration mistake: ${configErrorText(error).en}`);
    }
    // Probe what needs it now: the devices are published with their features.
    await Promise.all([...this.runtimes.values()].map((runtime) => this.probe(runtime)));
    await this.publishDevices();
    await this.reportStatus({ force: true });
  }

  async cachedLayout(slot) {
    try {
      return (await this.store.get(layoutKey(slot))) ?? null;
    } catch {
      return null;
    }
  }

  /** Read again what the devices have (the "Scan" button of the Discovery tab). */
  async rescan() {
    await Promise.all(
      [...this.runtimes.values()].map((runtime) =>
        this.probe(runtime, { force: true, mark: false }),
      ),
    );
    await this.publishDevices();
    await this.reportStatus();
  }

  /**
   * Run the profile's probe when it has one and has not succeeded yet (or when
   * forced). A failed probe keeps the cached layout.
   * @returns {Promise<{ changed: boolean, error?: Error }>}
   */
  async probe(runtime, { force = false, mark = true } = {}) {
    const { profile, slot } = runtime;
    if (!profile.probe || (runtime.probed && !force)) {
      return { changed: false };
    }
    try {
      const layout = await profile.probe({
        connection: this.connection(runtime),
        unitId: slot.unitId,
      });
      runtime.probed = true;
      const changed = JSON.stringify(layout) !== JSON.stringify(runtime.layout);
      runtime.layout = layout;
      if (changed) {
        await this.store.set(layoutKey(slot), layout);
        this.buildFeatures(runtime);
        logger.info(`${SLOT_LABEL.en(slot)}: ${describeLayout(profile, layout)}`);
      }
      return { changed };
    } catch (err) {
      if (mark) {
        this.markFailure(runtime, err);
      }
      return { changed: false, error: err };
    }
  }

  connection(runtime) {
    const { slot, profile } = runtime;
    return this.pool.get({
      host: slot.host,
      port: slot.port,
      framing: slot.framing,
      timeoutMs: this.config.timeout * 1000,
      waitAfterConnectMs: profile.waitAfterConnectMs ?? 0,
    });
  }

  /** The feature definitions of a device: its profile's, then its custom registers. */
  buildFeatures(runtime) {
    const { profile, slot, layout } = runtime;
    const lang = this.config.language;
    const features = layout ? profile.features(layout) : [];
    const names = new Set(
      features.map((feature) => featureName(feature.name, lang, feature.occurrence)),
    );
    runtime.featureErrors = [];
    for (const entry of slot.entries) {
      if (names.has(entry.name)) {
        // The name of a profile feature: Gladys wants distinct names.
        runtime.featureErrors.push({
          slot: slot.index,
          code: 'register',
          params: { entry: entry.index, name: entry.name, code: 'profileName' },
        });
        continue;
      }
      names.add(entry.name);
      features.push(customFeature(entry));
    }
    runtime.features = features;
  }

  // --- Devices ----------------------------------------------------------------------------

  /** The devices Gladys shows in its Discovery tab. */
  buildDevices() {
    return [...this.runtimes.values()]
      .filter((runtime) => runtime.layout && runtime.features.length > 0)
      .map((runtime) => this.buildDevice(runtime));
  }

  buildDevice(runtime) {
    const { slot, profile, layout, ids } = runtime;
    const lang = this.config.language;
    const identity = profile.identity?.(layout) ?? {};
    const params = [
      { name: 'HOST', value: slot.host },
      { name: 'PORT', value: String(slot.port) },
      { name: 'UNIT_ID', value: String(slot.unitId) },
      { name: 'PROFILE', value: profile.id },
    ];
    if (identity.serial) {
      params.push({ name: 'SERIAL', value: identity.serial });
    }
    return {
      name:
        profile.deviceName?.(layout) ??
        `${profile.label} ${slot.host}${slot.unitId !== 1 ? ` #${slot.unitId}` : ''}`,
      external_id: ids.device,
      model: profile.label,
      // Polled by the container's own timer (src/poller.js); the core's poll
      // is a fallback, once a minute.
      should_poll: true,
      poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
      params,
      features: runtime.features.map((feature) => {
        // A declared switch or setpoint is published controllable even while
        // writing is off: the core leaves read_only out of the structure it
        // compares, so turning writing on later would never offer "Update".
        // While it is off, setValue refuses every write.
        const writable = Boolean(feature.writable);
        return {
          name: feature.label ?? featureName(feature.name, lang, feature.occurrence),
          external_id: ids.feature(feature.key),
          category: feature.category,
          type: feature.type,
          ...(feature.unit ? { unit: feature.unit } : {}),
          min: feature.min,
          max: feature.max,
          read_only: !writable,
          has_feedback: Boolean(feature.writable),
          keep_history: true,
        };
      }),
    };
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(this.buildDevices());
  }

  /** The runtime of a Gladys device, by its external id. */
  runtimeOf(externalId) {
    return [...this.runtimes.values()].find((runtime) => runtime.ids.device === externalId);
  }

  /** The runtimes whose device the user added to Gladys. */
  createdRuntimes() {
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    return [...this.runtimes.values()].filter((runtime) => created.has(runtime.ids.device));
  }

  // --- Reading ----------------------------------------------------------------------------

  /**
   * Read a device and publish what changed.
   * @param {object} runtime
   * @returns {Promise<boolean>} whether the device answered
   */
  async poll(runtime) {
    if (runtime.profile.probe && !runtime.probed) {
      // Not probed yet (asleep at startup): try again. With a layout kept in
      // /data the read goes on, and says whether the device answers.
      const { changed, error } = await this.probe(runtime, { mark: !runtime.layout });
      if (changed) {
        await this.publishDevices();
      }
      if (!runtime.layout) {
        await this.reportStatus();
        return false;
      }
      if (error && !isUnreachable(error)) {
        logger.debug(`${SLOT_LABEL.en(runtime.slot)}: probe failed (${error.message})`);
      }
    }
    let values;
    try {
      values = await this.read(runtime);
    } catch (err) {
      this.markFailure(runtime, err);
      await this.reportStatus();
      return false;
    }
    this.markSuccess(runtime);
    await this.publishValues(runtime, values);
    await this.reportStatus();
    return true;
  }

  /**
   * Read every feature of a device.
   * @returns {Promise<Array<[object, unknown]>>} [feature, value] pairs, value undefined when unknown
   * @throws when the device does not answer, or refuses everything
   */
  async read(runtime) {
    const { slot, profile, features } = runtime;
    const points = new Map();
    for (const feature of features) {
      for (const point of feature.points) {
        points.set(pointId(point), { id: pointId(point), ...point });
      }
    }
    const results = await runtime.reader.readPoints(
      this.connection(runtime),
      slot.unitId,
      [...points.values()],
      profile.readOptions,
    );
    if (points.size > 0 && [...results.values()].every((result) => result instanceof Error)) {
      throw new ProfileError('allRefused');
    }
    const get = (point) => {
      const result = results.get(pointId(point));
      return Array.isArray(result) ? result : undefined;
    };
    return features.map((feature) => {
      try {
        return [feature, feature.value(get)];
      } catch (err) {
        logger.debug(`${feature.key}: cannot decode (${err.message})`);
        return [feature, undefined];
      }
    });
  }

  async publishValues(runtime, values) {
    const created = (this.gladys.devices ?? []).find(
      (device) => device.external_id === runtime.ids.device,
    );
    if (!created) {
      return;
    }
    // Only the features the device was created with: the core drops the others.
    const known = new Set((created.features ?? []).map((feature) => feature.external_id));
    const lang = this.config.language;
    const states = [];
    for (const [feature, value] of values) {
      const externalId = runtime.ids.feature(feature.key);
      if (value === undefined || (known.size > 0 && !known.has(externalId))) {
        continue;
      }
      if (typeof value === 'object') {
        states.push({
          device_feature_external_id: externalId,
          text: (STATES[lang] ?? STATES.en)[value.state] ?? STATES.en.unknown,
        });
      } else {
        states.push({
          device_feature_external_id: externalId,
          state: roundTo(value, feature.precision ?? 2),
        });
      }
    }
    runtime.lastValues = new Map(values.map(([feature, value]) => [feature.key, value]));
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logger.debug(`${SLOT_LABEL.en(runtime.slot)}: ${count} state(s) published`);
      this.issues.ok('publish', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('publish', `Publishing the states failed: ${err.message}`);
    }
  }

  markSuccess(runtime) {
    const { status, slot } = runtime;
    const wasLost = status.reachable === false;
    status.failures = 0;
    status.error = null;
    status.lastReadAt = this.now();
    if (status.reachable !== true) {
      status.reachable = true;
      this.onReachabilityChange(runtime);
      if (wasLost) {
        logger.info(`${SLOT_LABEL.en(slot)} answers again`);
        this.fireTrigger(TRIGGERS.REACHABLE, runtime);
      } else {
        logger.info(`${SLOT_LABEL.en(slot)} answers`);
      }
    }
  }

  markFailure(runtime, err) {
    const { status, slot } = runtime;
    status.failures += 1;
    status.error = errorText(err);
    const declare =
      status.reachable === null ||
      (status.reachable === true && status.failures >= UNREACHABLE_AFTER);
    if (!declare) {
      logger.debug(`${SLOT_LABEL.en(slot)}: ${status.error.en} (failure ${status.failures})`);
      return;
    }
    const wasReachable = status.reachable === true;
    status.reachable = false;
    this.onReachabilityChange(runtime);
    logger.warn(`${SLOT_LABEL.en(slot)} does not answer: ${status.error.en}`);
    if (wasReachable) {
      this.fireTrigger(TRIGGERS.UNREACHABLE, runtime, status.error.en);
    }
  }

  fireTrigger(key, runtime, error) {
    const device = (this.gladys.devices ?? []).find(
      (created) => created.external_id === runtime.ids.device,
    );
    if (!device) {
      return; // a scene can only target a device added to Gladys
    }
    const data = { device: device.external_id, device_name: device.name ?? '' };
    if (error !== undefined) {
      data.error = error.slice(0, 1000);
    }
    this.gladys.publishSceneEvent(key, data).catch((err) => {
      logger.warn(`Scene trigger ${key} refused: ${err.message}`);
    });
  }

  /** Delay between two reads: the configured one, slowed down to keep under the core's state budget. */
  effectiveIntervalMs() {
    const configured = pollIntervalMs(this.config);
    const features = this.createdRuntimes().reduce(
      (total, runtime) => total + runtime.features.length,
      0,
    );
    const minimum = Math.ceil((features * 60_000) / STATE_BUDGET_PER_MINUTE);
    if (minimum > configured) {
      if (!this.slowedDown) {
        logger.warn(
          `${features} features every ${configured / 1000} s would exceed the ${STATE_BUDGET_PER_MINUTE} states a minute Gladys accepts: reading every ${Math.ceil(minimum / 1000)} s instead`,
        );
        this.slowedDown = true;
      }
      return Math.ceil(minimum / 1000) * 1000;
    }
    this.slowedDown = false;
    return configured;
  }

  // --- Status ---------------------------------------------------------------------------------

  /** The connection status shown in the Configuration screen, sent when it changes. */
  async reportStatus({ force = false } = {}) {
    const lines = [];
    let connected = true;
    const runtimes = [...this.runtimes.values()];
    const errors = [...this.errors, ...runtimes.flatMap((runtime) => runtime.featureErrors ?? [])];
    if (errors.length > 0) {
      connected = false;
      lines.push(STATUS.configErrors, ...errors.map(configErrorText));
    }
    if (runtimes.length === 0 && errors.length === 0) {
      connected = false;
      lines.push(STATUS.notConfigured);
    }
    const lost = runtimes.filter((runtime) => runtime.status.reachable === false);
    if (lost.length > 0) {
      connected = false;
      for (const runtime of lost) {
        lines.push(
          localize(
            {
              en: (label, error) => STATUS.notAnswering.en(label.en, error.en),
              fr: (label, error) => STATUS.notAnswering.fr(label.fr, error.fr),
              de: (label, error) => STATUS.notAnswering.de(label.de, error.de),
              es: (label, error) => STATUS.notAnswering.es(label.es, error.es),
            },
            localize(SLOT_LABEL, runtime.slot),
            runtime.status.error,
          ),
        );
      }
    }
    if (runtimes.length > 0) {
      const answering = runtimes.filter((runtime) => runtime.status.reachable === true).length;
      lines.push(localize(STATUS.answering, answering, runtimes.length));
    }
    if (runtimes.some((runtime) => runtime.features.some((feature) => feature.writable))) {
      lines.push(this.config.allow_write ? STATUS.writeEnabled : STATUS.writeDisabled);
    }
    const message = joinLines(lines);
    const key = JSON.stringify([connected, message]);
    if (!force && key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`Connection status not sent: ${err.message}`);
      this.lastStatus = null;
    }
  }

  // --- Writing ----------------------------------------------------------------------------------

  /**
   * A command from Gladys on a writable feature.
   * @throws when writing is off, the feature read-only, the value out of bounds
   */
  async setValue(device, deviceFeature, value) {
    const runtime = this.runtimeOf(device.external_id);
    const feature = runtime?.features.find(
      (candidate) => runtime.ids.feature(candidate.key) === deviceFeature.external_id,
    );
    if (!feature?.writable) {
      throw writeError('notWritable');
    }
    if (!this.config.allow_write) {
      throw writeError('disabled');
    }
    const { entry } = feature;
    const connection = this.connection(runtime);
    const unitId = runtime.slot.unitId;
    const number = Number(value);
    logger.info(
      `Write ${entry.table} ${entry.address} (${entry.name}) <- ${value} on ${SLOT_LABEL.en(runtime.slot)}`,
    );
    if (entry.kind === 'switch') {
      const on = number !== 0;
      if (entry.table === 'coil') {
        await connection.writeCoil(unitId, entry.address, on);
      } else {
        await connection.writeRegisters(
          unitId,
          entry.address,
          encodeValue(on ? entry.on : entry.off, entry.dataType, entry.swap),
        );
      }
    } else {
      if (!Number.isFinite(number) || number < entry.min || number > entry.max) {
        throw writeError('outOfBounds', value, entry.min, entry.max);
      }
      const raw = (number - entry.offset) / entry.scale;
      await connection.writeRegisters(
        unitId,
        entry.address,
        encodeValue(raw, entry.dataType, entry.swap),
      );
    }
    // Read back: the state Gladys shows is what the device took.
    await this.poll(runtime);
  }

  // --- Lifecycle --------------------------------------------------------------------------------

  stop() {
    this.pool.closeAll();
  }
}

function layoutKey(slot) {
  return `${slot.platformId}:${slot.profileId}`;
}

/** Why a device does not answer, in the four languages. */
export function errorText(err) {
  if (err instanceof ProfileError) {
    return err.code === 'allRefused' ? ALL_REFUSED : PROFILE_ERRORS[err.code];
  }
  const message = isUnreachable(err) ? err.message : `${err.message}`;
  return localize({ en: message });
}

function describeLayout(profile, layout) {
  if (profile.id === 'sunspec') {
    const ids = layout.models.map((model) => model.id).join(', ');
    return `SunSpec at ${layout.base}, models ${ids}${layout.manufacturer ? ` (${layout.manufacturer} ${layout.model})` : ''}`;
  }
  return `${profile.label}: ${JSON.stringify({ ...layout, serial: layout.serial ? '…' : undefined })}`;
}

export { pick };
