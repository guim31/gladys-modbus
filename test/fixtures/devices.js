// -----------------------------------------------------------------------------
// Register maps of real device types, filled after the manufacturers'
// published tables (see the sources in src/profiles/*.js), with plausible
// values. Addresses an actual device does not implement are left out, so the
// fake server answers exception 2 there like the device would. Serial numbers
// are invented.
// -----------------------------------------------------------------------------

import { createUnit } from '../helpers/fakeModbus.js';

/** Eastron SDM630: float32 input registers. */
export function sdm630() {
  const unit = createUnit()
    .zeros('input', 0x0000, 0x24) // 0x0000-0x0023: per-phase V, I, W, VA, VAr, PF
    .zeros('input', 0x0034, 0x1c); // 0x0034-0x004F: totals, frequency, energies
  const values = {
    0x0000: 231.2,
    0x0002: 229.8,
    0x0004: 232.5,
    0x0006: 1.52,
    0x0008: 0.87,
    0x000a: 2.31,
    0x000c: 341.2,
    0x000e: 190.5,
    0x0010: 520.8,
    0x0034: 1052.5,
    0x0046: 50.01,
    0x0048: 12345.678,
    0x004a: 456.789,
  };
  for (const [address, value] of Object.entries(values)) {
    unit.float32('input', Number(address), value);
  }
  return unit;
}

/** Eastron SDM120: float32 input registers. */
export function sdm120() {
  const unit = createUnit().zeros('input', 0x0000, 0x20).zeros('input', 0x0046, 0x0a);
  unit
    .float32('input', 0x0000, 228.4)
    .float32('input', 0x0006, 4.73)
    .float32('input', 0x000c, -1050.2) // a heat pump meter wired backwards
    .float32('input', 0x0048, 2210.5)
    .float32('input', 0x004a, 3.25);
  return unit;
}

// --- SunSpec -----------------------------------------------------------------------

const MODEL_LENGTHS = { 1: 66, 101: 50, 103: 50, 113: 60, 160: 48, 203: 105, 213: 124 };

/**
 * A SunSpec device: "SunS" at `base`, then the models in order, then the end
 * marker. Each model block exists (zeros), with the points given.
 * @param {Array<{ id, points?: Record<number, Function>, strings?: Record<number, [string, number]> }>} models
 */
export function sunspecDevice(models, { base = 40000, unit = createUnit() } = {}) {
  unit.words('holding', base, [0x5375, 0x6e53]);
  let address = base + 2;
  for (const model of models) {
    const length = MODEL_LENGTHS[model.id];
    unit.zeros('holding', address, length + 2);
    unit.words('holding', address, [model.id, length]);
    for (const [offset, [text, size]] of Object.entries(model.strings ?? {})) {
      unit.string('holding', address + Number(offset), text, size);
    }
    for (const [offset, write] of Object.entries(model.points ?? {})) {
      write(unit, address + Number(offset));
    }
    address += length + 2;
  }
  unit.words('holding', address, [0xffff, 0]);
  return unit;
}

const i16 = (value) => (unit, address) => unit.int16('holding', address, value);
const u16 = (value) => (unit, address) => unit.uint16('holding', address, value);
const u32 = (value) => (unit, address) => unit.uint32('holding', address, value);
const f32 = (value) => (unit, address) => unit.float32('holding', address, value);

const common = (manufacturer, model, version, serial) => ({
  id: 1,
  strings: { 2: [manufacturer, 16], 18: [model, 16], 42: [version, 8], 50: [serial, 16] },
});

/** An SMA Sunny Boy as it answers on unit 126: models 1, 101 (+SF), 160. */
export function smaSunnyBoy() {
  return sunspecDevice([
    common('SMA', 'SB5.0-1AV-41', '4.01.15.R', '3000000001'),
    {
      id: 101,
      points: {
        2: u16(2150), // A
        6: i16(-2), // A_SF
        10: u16(2345), // PhVphA
        13: i16(-1), // V_SF
        14: i16(4987), // W
        15: i16(0), // W_SF
        24: u32(12345678), // WH (Wh)
        26: i16(0), // WH_SF
        31: i16(5150), // DCW
        32: i16(0), // DCW_SF
        33: i16(412), // TmpCab
        34: i16(-32768), // TmpSnk: not implemented
        37: i16(-1), // Tmp_SF
        38: u16(4), // St: MPPT
      },
    },
    { id: 160 }, // MPPT extension: not read
  ]);
}

/** A SolarEdge inverter with its export meter: models 1, 103, 203 on unit 1. */
export function solarEdge() {
  return sunspecDevice(
    [
      common('SolarEdge', 'SE8K-RW0TEBEN4', '0004.0019.0031', '7E0000001'),
      {
        id: 103,
        points: {
          2: u16(1205), // A
          6: i16(-2),
          10: u16(23180), // PhVphA
          13: i16(-2),
          14: i16(8000), // W
          15: i16(-1), // W_SF: 800.0 W
          24: u32(23456789),
          26: i16(1), // WH_SF: 234567890 Wh
          31: i16(8250),
          32: i16(-1),
          33: i16(3950),
          37: i16(-2),
          38: u16(5), // St: throttled
        },
      },
      {
        id: 203,
        points: {
          2: i16(-512), // A
          6: i16(-2),
          7: i16(23012), // PhV
          15: i16(-2),
          18: i16(-3500), // W (meter sign)
          22: i16(0),
          38: u32(9876543), // TotWhExp
          46: u32(4567890), // TotWhImp
          54: i16(0),
        },
      },
    ],
    { unit: createUnit() },
  );
}

/** A Fronius Symo in float mode: models 1, 113 on unit 1. */
export function froniusSymo() {
  return sunspecDevice([
    common('Fronius', 'Symo 8.2-3-M', '0.3.30.2', '34000001'),
    {
      id: 113,
      points: {
        2: f32(11.6), // A
        16: f32(229.9), // PhVphA
        22: f32(7800.5), // W
        32: f32(Number.NaN), // WH: not implemented
        38: f32(8020.25), // DCW
        40: f32(45.5), // TmpCab
        48: u16(4), // St
      },
    },
  ]);
}

/** The Fronius Smart Meter as it answers on unit 240: models 1, 213. */
export function froniusSmartMeter() {
  return sunspecDevice([
    common('Fronius', 'Smart Meter 63A', '1.3', '35000001'),
    {
      id: 213,
      points: {
        2: f32(6.2),
        10: f32(230.1),
        28: f32(1430.5),
        60: f32(1234567.5), // TotWhExp
        68: f32(7654321.0), // TotWhImp
      },
    },
  ]);
}

// --- Huawei SUN2000 -----------------------------------------------------------------

/** A SUN2000 with its DTSU666-H meter and a LUNA2000 battery. */
export function huaweiSun2000({ meter = true, battery = true } = {}) {
  const unit = createUnit()
    .string('holding', 30000, 'SUN2000-5KTL-L1', 15)
    .string('holding', 30015, 'HV0000000001', 10)
    .zeros('holding', 32064, 26) // 32064-32089
    .zeros('holding', 32106, 10); // 32106-32115
  unit
    .int32('holding', 32064, 4120) // input power
    .uint16('holding', 32069, 2318) // phase A voltage /10
    .int32('holding', 32072, 17250) // phase A current /1000
    .int32('holding', 32080, 3950) // active power
    .int16('holding', 32087, 387) // internal temperature /10
    .uint16('holding', 32089, 0x0200) // on-grid
    .uint32('holding', 32106, 1234567); // accumulated yield /100
  if (meter) {
    unit.zeros('holding', 37100, 26);
    unit
      .uint16('holding', 37100, 1) // meter status: normal
      .int32('holding', 37113, 1830) // exporting 1830 W
      .int32('holding', 37119, -345678) // export /100 (negative firmware)
      .int32('holding', 37121, 987654); // import /100
  }
  if (battery) {
    unit.zeros('holding', 37758, 9);
    unit
      .uint32('holding', 37758, 10000) // rated capacity (Wh)
      .uint16('holding', 37760, 875) // SOC /10
      .int32('holding', 37765, -1500); // discharging 1500 W
  }
  return unit;
}

// --- Victron GX -------------------------------------------------------------------------

/** A Cerbo GX on unit 100: three-phase ESS with a battery. */
export function victronGx({ battery = true } = {}) {
  const unit = createUnit().zeros('holding', 800, 27).zeros('holding', 850, 2);
  const values = {
    808: 120,
    809: 0,
    810: 0,
    811: 850,
    812: 830,
    813: 845,
    817: 650,
    818: 410,
    819: 980,
  };
  for (const [address, value] of Object.entries(values)) {
    unit.uint16('holding', Number(address), value);
  }
  unit.int16('holding', 820, 210).int16('holding', 821, -150).int16('holding', 822, 95);
  unit.uint16('holding', 850, 1520);
  if (battery) {
    unit.zeros('holding', 840, 7);
    unit
      .uint16('holding', 840, 528) // 52.8 V
      .int16('holding', 841, 152) // 15.2 A
      .int16('holding', 842, 802) // charging 802 W
      .uint16('holding', 843, 76);
  }
  return unit;
}

// --- A heat pump with custom registers ---------------------------------------------------

/** Holding and input registers a heat pump could expose. */
export function heatPump() {
  return createUnit()
    .int16('holding', 100, 352) // flow temperature ×0.1 °C
    .int16('holding', 101, -45) // outdoor temperature ×0.1 °C
    .uint16('holding', 102, 0b0000_0000_0000_0101) // status bits
    .uint16('holding', 110, 45) // DHW setpoint °C
    .uint16('holding', 111, 1) // heating on (register switch)
    .uint32('input', 200, 154321, 'word') // energy in Wh, little-endian words
    .float32('input', 210, 2.35) // flow l/min
    .uint16('input', 220, 1820) // power W
    .bit('coil', 5, 0) // circulation pump
    .bit('discrete', 3, 1); // defrost
}

/** The custom registers that read heatPump(), every kind and option. */
export const HEAT_PUMP_REGISTERS = [
  'Flow temperature: holding 100 int16 scale=0.1 temperature',
  'Outdoor temperature: holding 101 scale=0,1 temperature unit=°C',
  'Compressor: holding 102 bit0 binary',
  'Alarm: holding 102 bit1',
  'DHW setpoint: holding 110 uint16 setpoint min=40 max=55',
  'Heating: holding 111 switch',
  'Heat pump energy: input 200 uint32 swap=word energy unit=Wh',
  'Flow rate: input 210 float32 value precision=1',
  'Heat pump power: input 220 power',
  'Circulation pump: coil 5 switch',
  'Defrost: discrete 3',
].join('; ');
