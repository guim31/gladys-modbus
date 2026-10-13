// -----------------------------------------------------------------------------
// The shape every profile shares, and the helpers they read registers with.
//
// A profile describes one family of devices:
//   - id, label         the key stored in the configuration (never renamed)
//                       and the name shown (a brand: never translated)
//   - readOptions       how its reads may be grouped (see src/modbus/reader.js)
//   - waitAfterConnectMs (optional) pause the device needs after connecting
//   - probe(context)    (optional) what this very device has (SunSpec models,
//                       a meter, a battery...), read once and kept in /data
//   - features(layout)  the measures, each one a future Gladys feature:
//       { key, name, category, type, unit, min, max, main, precision,
//         points: [{ table, address, count }], value(get) }
//     `value` gets the words read for its points (`get(point)`) and returns a
//     number, `{ state }` for a text feature, or undefined when the device
//     has no valid value right now.
// -----------------------------------------------------------------------------

import { DATA_TYPES, decodeString, decodeWords } from '../modbus/datatypes.js';

/** A profile could not recognize the device (wrong profile, wrong unit id). */
export class ProfileError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = 'ProfileError';
    this.code = code;
    this.params = params;
  }
}

/** The point of a value: `count` registers from `address`. */
export function point(table, address, type = 'uint16') {
  return { table, address, count: DATA_TYPES[type] ?? 1 };
}

/** The identifier of a point in the read results. */
export function pointId({ table, address, count }) {
  return `${table}:${address}:${count}`;
}

/**
 * Read a number from the results.
 * @param {Function} get get(point) -> words or undefined
 * @param {string} table
 * @param {number} address
 * @param {string} type
 * @param {object} [options]
 * @param {string} [options.swap]
 * @param {number} [options.scale] multiplied
 * @param {(raw: number) => boolean} [options.invalid] raw values meaning "not available"
 */
export function readNumber(get, table, address, type, { swap = 'none', scale = 1, invalid } = {}) {
  const words = get(point(table, address, type));
  if (!Array.isArray(words)) {
    return undefined;
  }
  const raw = decodeWords(words, type, swap);
  if (!Number.isFinite(raw) || (invalid && invalid(raw))) {
    return undefined;
  }
  return raw * scale;
}

/** Read a string of `size` registers. */
export async function readString(connection, unitId, table, address, size) {
  return decodeString(await connection.read(unitId, table, address, size));
}

/** The sum of the values that are available, undefined when none is. */
export function sumOf(values) {
  const known = values.filter((value) => value !== undefined);
  return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0);
}

/** Common categories of the profile measures. */
export const MEASURES = {
  power: {
    category: 'energy-sensor',
    type: 'power',
    unit: 'watt',
    min: -1_000_000,
    max: 1_000_000,
  },
  voltage: { category: 'energy-sensor', type: 'voltage', unit: 'volt', min: 0, max: 1000 },
  current: { category: 'energy-sensor', type: 'current', unit: 'ampere', min: -1000, max: 1000 },
  importIndex: {
    category: 'energy-sensor',
    type: 'index',
    unit: 'kilowatt-hour',
    min: 0,
    max: 1_000_000_000,
  },
  exportIndex: {
    category: 'grid-sensor',
    type: 'output-index',
    unit: 'kilowatt-hour',
    min: 0,
    max: 1_000_000_000,
  },
  productionPower: {
    category: 'energy-production-sensor',
    type: 'power',
    unit: 'watt',
    min: 0,
    max: 1_000_000,
  },
  productionIndex: {
    category: 'energy-production-sensor',
    type: 'index',
    unit: 'kilowatt-hour',
    min: 0,
    max: 1_000_000_000,
  },
  gridPower: {
    category: 'grid-sensor',
    type: 'power',
    unit: 'watt',
    min: -1_000_000,
    max: 1_000_000,
  },
  homePower: {
    category: 'home-output-sensor',
    type: 'power',
    unit: 'watt',
    min: 0,
    max: 1_000_000,
  },
  deviceTemperature: {
    category: 'device-temperature-sensor',
    type: 'decimal',
    unit: 'celsius',
    min: -40,
    max: 150,
  },
  batteryLevel: {
    category: 'battery-storage',
    type: 'battery-level',
    unit: 'percent',
    min: 0,
    max: 100,
  },
  chargePower: {
    category: 'battery-storage',
    type: 'charge-power',
    unit: 'watt',
    min: 0,
    max: 1_000_000,
  },
  dischargePower: {
    category: 'battery-storage',
    type: 'discharge-power',
    unit: 'watt',
    min: 0,
    max: 1_000_000,
  },
  // Gladys requires min/max on every feature, text included: 0/0 like Zigbee2MQTT.
  state: { category: 'text', type: 'text', min: 0, max: 0 },
};
