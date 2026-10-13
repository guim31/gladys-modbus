// -----------------------------------------------------------------------------
// SunSpec: the register map many inverters and meters share (SMA, SolarEdge,
// Fronius, Kostal, Huawei with the SunSpec option, ABB/FIMER...).
//
// The device announces itself with the marker "SunS" at holding register
// 40000 (sometimes 0 or 50000), then lists its models one after the other,
// each starting with its id and length, until the id 0xFFFF. The probe walks
// that list once (kept in /data), and the features follow the models found:
//   1        common: manufacturer, model, serial number
//   101-103  inverter, integers + scale factors (single, split, three phase)
//   111-113  the same, float32
//   201-204  meter, integers + scale factors
//   211-214  the same, float32
//
// Offsets are relative to the start of the model (its id register) and come
// from the SunSpec Information Model definitions, sunspec/models
// (Apache-2.0); test/sunspec.test.js checks them against those definitions.
//
// SunSpec marks a value it does not implement: 0x8000 (int16), 0xFFFF
// (uint16, enum16), 0 (acc32), NaN (float32), and a scale factor of 0x8000.
// Such a value is not published.
// -----------------------------------------------------------------------------

import { ModbusException } from '../modbus/frames.js';
import { decodeWords } from '../modbus/datatypes.js';
import { roundTo } from '../registers.js';
import { MEASURES, ProfileError, point, readString } from './common.js';

export const SUNSPEC_BASES = [40000, 0, 50000];
const MARKER = [0x5375, 0x6e53]; // "SunS"
const END = 0xffff;
const MAX_MODELS = 64;

const INVERTER_INT = [101, 102, 103];
const INVERTER_FLOAT = [111, 112, 113];
const METER_INT = [201, 202, 203, 204];
const METER_FLOAT = [211, 212, 213, 214];

/** Point offsets inside the models (the id register is offset 0). */
export const OFFSETS = {
  inverterInt: {
    A: 2,
    A_SF: 6,
    PhVphA: 10,
    V_SF: 13,
    W: 14,
    W_SF: 15,
    WH: 24,
    WH_SF: 26,
    DCW: 31,
    DCW_SF: 32,
    TmpCab: 33,
    Tmp_SF: 37,
    St: 38,
  },
  inverterFloat: { A: 2, PhVphA: 16, W: 22, WH: 32, DCW: 38, TmpCab: 40, St: 48 },
  meterInt: {
    A: 2,
    A_SF: 6,
    PhV: 7,
    V_SF: 15,
    W: 18,
    W_SF: 22,
    TotWhExp: 38,
    TotWhImp: 46,
    TotWh_SF: 54,
  },
  meterFloat: { A: 2, PhV: 10, W: 28, TotWhExp: 60, TotWhImp: 68 },
};

/** The inverter operating states (St), SunSpec model 101-113. */
const OPERATING_STATES = {
  1: 'off',
  2: 'sleeping',
  3: 'starting',
  4: 'producing',
  5: 'throttled',
  6: 'shuttingDown',
  7: 'fault',
  8: 'standby',
};

/**
 * Walk the SunSpec model list.
 * @returns {Promise<object>} the layout: base, models, identity
 */
export async function scanSunSpec(connection, unitId) {
  let base;
  for (const candidate of SUNSPEC_BASES) {
    try {
      const words = await connection.read(unitId, 'holding', candidate, 2);
      if (words[0] === MARKER[0] && words[1] === MARKER[1]) {
        base = candidate;
        break;
      }
    } catch (err) {
      if (!(err instanceof ModbusException) || err.code === 10 || err.code === 11) {
        throw err;
      }
    }
  }
  if (base === undefined) {
    throw new ProfileError('sunspecNotFound');
  }
  const models = [];
  let address = base + 2;
  while (models.length < MAX_MODELS && address + 1 <= 0xffff) {
    const [id, length] = await connection.read(unitId, 'holding', address, 2);
    if (id === END || length === 0) {
      break;
    }
    models.push({ id, address, length });
    address += 2 + length;
  }
  const layout = { base, models, manufacturer: '', model: '', serial: '', version: '' };
  const common = models.find((model) => model.id === 1);
  if (common) {
    // Mn (16 registers at offset 2), Md (16 at 18), Vr (8 at 42), SN (16 at 50).
    layout.manufacturer = await readString(connection, unitId, 'holding', common.address + 2, 16);
    layout.model = await readString(connection, unitId, 'holding', common.address + 18, 16);
    layout.version = await readString(connection, unitId, 'holding', common.address + 42, 8);
    layout.serial = await readString(connection, unitId, 'holding', common.address + 50, 16);
  }
  return layout;
}

/** The models the integration turns into features. */
export function supportedModels(layout) {
  return layout.models.filter((model) =>
    [...INVERTER_INT, ...INVERTER_FLOAT, ...METER_INT, ...METER_FLOAT].includes(model.id),
  );
}

// --- Values -------------------------------------------------------------------

const NOT_IMPLEMENTED = {
  int16: 0x8000,
  uint16: 0xffff,
  enum16: 0xffff,
  acc32: 0,
  sunssf: 0x8000,
};

/** A raw SunSpec point, undefined when not implemented. */
function raw(get, address, type) {
  const size = type === 'acc32' || type === 'float32' ? 2 : 1;
  const words = get({ table: 'holding', address, count: size });
  if (!Array.isArray(words)) {
    return undefined;
  }
  if (type === 'float32') {
    const value = decodeWords(words, 'float32');
    return Number.isFinite(value) ? value : undefined;
  }
  if (type === 'acc32') {
    const value = decodeWords(words, 'uint32');
    return value === NOT_IMPLEMENTED.acc32 ? undefined : value;
  }
  if (words[0] === NOT_IMPLEMENTED[type]) {
    return undefined;
  }
  return type === 'int16' || type === 'sunssf'
    ? decodeWords(words, 'int16')
    : decodeWords(words, 'uint16');
}

/**
 * value × 10^sf × factor, rounded to the decimals the scale factor gives,
 * undefined when the value or its scale factor is not implemented.
 */
function scaled(get, address, type, sfAddress, factor) {
  const value = raw(get, address, type);
  const sf = raw(get, sfAddress, 'sunssf');
  if (value === undefined || sf === undefined || sf < -10 || sf > 10) {
    return undefined;
  }
  return roundTo(value * 10 ** sf * factor, Math.max(0, -sf) + decimalsOfFactor(factor));
}

/** 0.001 (Wh -> kWh) adds three decimals. */
const decimalsOfFactor = (factor) => Math.max(0, Math.round(-Math.log10(factor)));

const pointOf = (address, type) =>
  point('holding', address, type === 'acc32' || type === 'float32' ? 'uint32' : 'uint16');

/**
 * A measure read from an integer point and its scale factor, or from a float.
 * @param {object} spec { key, name, kind, model, offsets, field, intType, factor, main }
 */
function sunspecMeasure({ key, name, kind, model, offsets, field, intType, factor = 1, main }) {
  // The float models have no scale factors.
  const float = offsets.A_SF === undefined;
  const address = model.address + offsets[field];
  if (float) {
    return {
      key,
      name,
      ...MEASURES[kind],
      main,
      // A float carries no precision: two decimals (five for kWh from Wh).
      precision: 2 + decimalsOfFactor(factor),
      points: [pointOf(address, 'float32')],
      value: (get) => {
        const value = raw(get, address, 'float32');
        return value === undefined ? undefined : value * factor;
      },
    };
  }
  const sfAddress = model.address + offsets[SCALE_FACTOR[field]];
  return {
    key,
    name,
    ...MEASURES[kind],
    main,
    // Already rounded to its scale factor.
    precision: 10,
    points: [pointOf(address, intType), pointOf(sfAddress, 'sunssf')],
    value: (get) => scaled(get, address, intType, sfAddress, factor),
  };
}

const SCALE_FACTOR = {
  A: 'A_SF',
  PhVphA: 'V_SF',
  PhV: 'V_SF',
  W: 'W_SF',
  WH: 'WH_SF',
  DCW: 'DCW_SF',
  TmpCab: 'Tmp_SF',
  TotWhExp: 'TotWh_SF',
  TotWhImp: 'TotWh_SF',
};

function inverterFeatures(model, occurrence) {
  const offsets = INVERTER_INT.includes(model.id) ? OFFSETS.inverterInt : OFFSETS.inverterFloat;
  const prefix = `sunspec_inverter${occurrence}`;
  const common = { model, offsets, occurrence };
  const stateAddress = model.address + offsets.St;
  return [
    sunspecMeasure({
      ...common,
      key: `${prefix}_power`,
      name: 'acPower',
      kind: 'productionPower',
      field: 'W',
      intType: 'int16',
      main: true,
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_energy`,
      name: 'yieldTotal',
      kind: 'productionIndex',
      field: 'WH',
      intType: 'acc32',
      factor: 0.001,
      main: true,
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_dc_power`,
      name: 'dcPower',
      kind: 'productionPower',
      field: 'DCW',
      intType: 'int16',
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_current`,
      name: 'acCurrent',
      kind: 'current',
      field: 'A',
      intType: 'uint16',
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_voltage`,
      name: 'acVoltage',
      kind: 'voltage',
      field: 'PhVphA',
      intType: 'uint16',
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_temperature`,
      name: 'temperature',
      kind: 'deviceTemperature',
      field: 'TmpCab',
      intType: 'int16',
    }),
    {
      key: `${prefix}_state`,
      name: 'state',
      ...MEASURES.state,
      points: [pointOf(stateAddress, 'enum16')],
      value: (get) => {
        const state = raw(get, stateAddress, 'enum16');
        return state === undefined ? undefined : { state: OPERATING_STATES[state] ?? 'unknown' };
      },
    },
  ].map((feature) => ({ ...feature, occurrence }));
}

function meterFeatures(model, occurrence) {
  const offsets = METER_INT.includes(model.id) ? OFFSETS.meterInt : OFFSETS.meterFloat;
  const prefix = `sunspec_meter${occurrence}`;
  const common = { model, offsets, occurrence };
  return [
    sunspecMeasure({
      ...common,
      key: `${prefix}_power`,
      name: 'meterPower',
      kind: 'power',
      field: 'W',
      intType: 'int16',
      main: true,
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_import`,
      name: 'meterImport',
      kind: 'importIndex',
      field: 'TotWhImp',
      intType: 'acc32',
      factor: 0.001,
      main: true,
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_export`,
      name: 'meterExport',
      kind: 'exportIndex',
      field: 'TotWhExp',
      intType: 'acc32',
      factor: 0.001,
      main: true,
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_current`,
      name: 'meterCurrent',
      kind: 'current',
      field: 'A',
      intType: 'int16',
    }),
    sunspecMeasure({
      ...common,
      key: `${prefix}_voltage`,
      name: 'meterVoltage',
      kind: 'voltage',
      field: 'PhV',
      intType: 'int16',
    }),
  ].map((feature) => ({ ...feature, occurrence }));
}

export const sunspec = {
  id: 'sunspec',
  label: 'SunSpec',
  // A SunSpec model is a contiguous block: a read may span the points of a
  // model we do not use.
  readOptions: { maxRegisters: 100, maxGap: 24 },
  probe: ({ connection, unitId }) => scanSunSpec(connection, unitId),
  deviceName(layout) {
    return [layout.manufacturer, layout.model].filter(Boolean).join(' ') || null;
  },
  identity(layout) {
    return { serial: layout.serial, version: layout.version };
  },
  features(layout) {
    let inverters = 0;
    let meters = 0;
    return supportedModels(layout).flatMap((model) => {
      if ([...INVERTER_INT, ...INVERTER_FLOAT].includes(model.id)) {
        inverters += 1;
        return inverterFeatures(model, inverters);
      }
      meters += 1;
      return meterFeatures(model, meters);
    });
  },
};
