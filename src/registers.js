// -----------------------------------------------------------------------------
// Custom registers: the one-line syntax a user types in the configuration to
// read (and, when declared, write) registers no profile covers.
//
// The configuration form only has single-line text fields, so the entries are
// separated by semicolons:
//
//   Flow temperature: holding 100 int16 scale=0.1 temperature;
//   Heat pump power: input 30775 int32 power;
//   Pump: coil 5 switch
//
// An entry is `name: table address`, then, in any order: a data type
// (int16 by default), a kind (what the value is, `value` by default) and
// options `key=value`. Every mistake is reported with the number of its
// entry, its name, and the word at fault.
// -----------------------------------------------------------------------------

import { DATA_TYPES, SWAPS, WRITABLE_TYPES, bitOf, decodeWords } from './modbus/datatypes.js';
import { isBitTable } from './modbus/frames.js';
import { KINDS, publishedUnit, unitLabel, unitOfSymbol } from './kinds.js';

export const TABLE_NAMES = ['holding', 'input', 'coil', 'discrete'];
const TABLE_ALIASES = {
  holding: 'holding',
  input: 'input',
  coil: 'coil',
  coils: 'coil',
  discrete: 'discrete',
};
const KEY_LETTER = { holding: 'h', input: 'i', coil: 'c', discrete: 'd' };
const OPTION_KEYS = ['scale', 'offset', 'unit', 'swap', 'min', 'max', 'precision', 'on', 'off'];

export const MAX_ENTRIES = 40;
export const MAX_NAME_LENGTH = 40;

/**
 * Parse the custom registers of one device.
 * @param {string} text the configuration value
 * @returns {{ entries: Array<object>, errors: Array<{ entry, name, code, params }> }}
 */
export function parseRegisters(text) {
  const entries = [];
  const errors = [];
  const raw = String(text ?? '')
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (raw.length > MAX_ENTRIES) {
    errors.push({
      entry: MAX_ENTRIES + 1,
      name: '',
      code: 'tooMany',
      params: { max: MAX_ENTRIES },
    });
  }
  raw.slice(0, MAX_ENTRIES).forEach((source, index) => {
    const result = parseEntry(source, index + 1);
    if (result.error) {
      errors.push(result.error);
      return;
    }
    const entry = result.entry;
    const twin = entries.find((other) => other.key === entry.key);
    if (twin) {
      errors.push(fail(entry.index, entry.name, 'duplicate', { other: twin.index }));
      return;
    }
    const sameName = entries.find((other) => other.name === entry.name);
    if (sameName) {
      errors.push(fail(entry.index, entry.name, 'duplicateName', { other: sameName.index }));
      return;
    }
    entries.push(entry);
  });
  return { entries, errors };
}

function fail(entry, name, code, params = {}) {
  return { entry, name, code, params };
}

/**
 * Parse one entry.
 * @param {string} source "name: table address ..."
 * @param {number} index 1-based, for the messages
 */
export function parseEntry(source, index = 1) {
  const colon = source.indexOf(':');
  if (colon === -1) {
    return { error: fail(index, source.slice(0, 24), 'missingColon') };
  }
  const name = source.slice(0, colon).trim();
  const error = (code, params) => ({ error: fail(index, name, code, params) });
  if (name === '') {
    return error('emptyName');
  }
  if (name.length > MAX_NAME_LENGTH) {
    return error('nameTooLong', { max: MAX_NAME_LENGTH });
  }

  let table;
  let address;
  let dataType;
  let bit;
  let kind;
  const options = {};
  for (const word of source
    .slice(colon + 1)
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    const lower = word.toLowerCase();
    if (table === undefined && TABLE_ALIASES[lower]) {
      table = TABLE_ALIASES[lower];
    } else if (address === undefined && /^(0x[0-9a-f]+|\d+)$/i.test(word)) {
      address = Number(word);
      if (address > 0xffff) {
        return error('badAddress', { word });
      }
    } else if (dataType === undefined && DATA_TYPES[lower] !== undefined) {
      dataType = lower;
    } else if (dataType === undefined && /^bit(\d|1[0-5])$/.test(lower)) {
      dataType = 'bit';
      bit = Number(lower.slice(3));
    } else if (kind === undefined && KINDS[lower]) {
      kind = lower;
    } else if (word.includes('=')) {
      const [key, ...rest] = word.split('=');
      const value = rest.join('=');
      if (!OPTION_KEYS.includes(key.toLowerCase())) {
        return error('unknownOption', { word });
      }
      options[key.toLowerCase()] = value;
    } else {
      return error('unknownWord', { word });
    }
  }
  if (table === undefined) {
    return error('missingTable');
  }
  if (address === undefined) {
    return error('missingAddress');
  }

  const bits = isBitTable(table);
  if (bits && dataType !== undefined) {
    return error('typeOnBits', { table });
  }
  dataType ??= bits ? 'bool' : 'int16';
  kind ??= bits || dataType === 'bit' ? 'binary' : 'value';
  const definition = KINDS[kind];

  const numbers = {};
  for (const key of ['scale', 'offset', 'min', 'max', 'precision', 'on', 'off']) {
    if (options[key] === undefined) {
      continue;
    }
    // A comma is a decimal comma: "scale=0,1" is 0.1.
    const value = Number(options[key].replace(',', '.'));
    if (options[key] === '' || !Number.isFinite(value)) {
      return error('badNumber', { word: `${key}=${options[key]}` });
    }
    numbers[key] = value;
  }
  if (numbers.scale === 0) {
    return error('badNumber', { word: `scale=${options.scale}` });
  }
  if (
    numbers.precision !== undefined &&
    (!Number.isInteger(numbers.precision) || numbers.precision < 0 || numbers.precision > 6)
  ) {
    return error('badNumber', { word: `precision=${options.precision}` });
  }
  const swap = (options.swap ?? 'none').toLowerCase();
  if (!SWAPS.includes(swap)) {
    return error('badSwap', { word: options.swap });
  }

  let unit = definition.units[0];
  if (options.unit !== undefined) {
    unit = unitOfSymbol(options.unit);
    if (unit === undefined || !definition.units.includes(unit)) {
      return error('badUnit', {
        word: options.unit,
        kind,
        allowed: allowedSymbols(definition.units),
      });
    }
  }

  if (definition.boolean && !(bits || dataType === 'bit' || DATA_TYPES[dataType] === 1)) {
    return error('booleanNeedsRegister', { kind });
  }
  if (bits && !definition.boolean) {
    return error('bitsAreBinary', { table });
  }

  const writable = Boolean(definition.writable);
  if (writable) {
    if (table === 'input' || table === 'discrete') {
      return error('readOnlyTable', { table, kind });
    }
    if (dataType === 'bit') {
      return error('noBitWrite');
    }
    if (!bits && !WRITABLE_TYPES.includes(dataType)) {
      return error('noWideWrite', { type: dataType });
    }
    if (kind === 'setpoint' && (numbers.min === undefined || numbers.max === undefined)) {
      return error('setpointBounds');
    }
  }
  const min = numbers.min ?? definition.min;
  const max = numbers.max ?? definition.max;
  if (min >= max) {
    return error('badBounds');
  }

  const scale = numbers.scale ?? 1;
  const precision =
    numbers.precision ?? (dataType === 'float32' || dataType === 'float64' ? 2 : decimalsOf(scale));
  const suffix = dataType === 'bit' ? `_b${bit}` : '';
  return {
    entry: {
      index,
      name,
      key: `c_${KEY_LETTER[table]}${address}${suffix}`,
      kind,
      table,
      address,
      dataType,
      bit,
      swap,
      scale,
      offset: numbers.offset ?? 0,
      unit,
      min,
      max,
      precision,
      on: numbers.on ?? 1,
      off: numbers.off ?? 0,
      writable,
    },
  };
}

function decimalsOf(number) {
  const text = String(number);
  if (text.includes('e-')) {
    return Number(text.split('e-')[1]);
  }
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function allowedSymbols(units) {
  return units.filter(Boolean).map(unitLabel).join(', ');
}

/** Number of registers (or bits) an entry reads. */
export function registerCount(entry) {
  if (isBitTable(entry.table) || entry.dataType === 'bit') {
    return 1;
  }
  return DATA_TYPES[entry.dataType];
}

/** The raw value of an entry from the words (or bits) read, before scaling. */
export function rawValue(entry, words) {
  if (isBitTable(entry.table)) {
    return words[0];
  }
  if (entry.dataType === 'bit') {
    return bitOf(words[0], entry.bit);
  }
  return decodeWords(words, entry.dataType, entry.swap);
}

/**
 * The value published for an entry, from the words read.
 * @returns {number|undefined} undefined for a value that is not a number (NaN float)
 */
export function entryValue(entry, words) {
  const raw = rawValue(entry, words);
  if (!Number.isFinite(raw)) {
    return undefined;
  }
  if (KINDS[entry.kind].boolean) {
    if (isBitTable(entry.table) || entry.dataType === 'bit') {
      return raw ? 1 : 0;
    }
    // A register switch: "on" is its on value, anything else is off.
    return raw === entry.on ? 1 : raw === entry.off ? 0 : raw !== 0 ? 1 : 0;
  }
  const { factor } = publishedUnit(entry.kind, entry.unit);
  const value = (raw * entry.scale + entry.offset) * factor;
  const precision = entry.precision + Math.max(0, Math.round(-Math.log10(factor)));
  return roundTo(value, Math.min(precision, 6));
}

export function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
