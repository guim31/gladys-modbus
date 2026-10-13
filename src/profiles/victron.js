// -----------------------------------------------------------------------------
// Victron Energy GX devices (Cerbo GX, Venus GX, Ekrano...): the system
// overview the GX publishes on unit id 100, holding registers (function 3).
// Modbus TCP has to be enabled on the GX (Settings > Services > Modbus TCP).
//
// Source: Victron "CCGX Modbus TCP register list" (com.victronenergy.system,
// registers 808-850), cross-checked with sfstar/hass-victron (Apache-2.0),
// custom_components/victron/const.py.
//
// The grid power is positive when importing, like Gladys wants it. The
// battery is optional: the probe reads its state of charge once.
// -----------------------------------------------------------------------------

import { ModbusException } from '../modbus/frames.js';
import { MEASURES, point, readNumber, sumOf } from './common.js';
import { batteryPower } from './huawei.js';

const h = (address, type = 'uint16') => point('holding', address, type);
const u16 =
  (address, divisor = 1) =>
  (get) =>
    readNumber(get, 'holding', address, 'uint16', { scale: 1 / divisor });
const i16 =
  (address, divisor = 1) =>
  (get) =>
    readNumber(get, 'holding', address, 'int16', { scale: 1 / divisor });

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const PV_AC = range(808, 813); // PV on AC output and on AC input, L1-L3
const CONSUMPTION = range(817, 819);
const GRID = range(820, 822);

async function probe({ connection, unitId }) {
  try {
    await connection.read(unitId, 'holding', 843, 1);
    return { battery: true };
  } catch (err) {
    if (err instanceof ModbusException && err.code !== 10 && err.code !== 11) {
      return { battery: false };
    }
    throw err;
  }
}

export const victronGx = {
  id: 'victron_gx',
  label: 'Victron GX',
  readOptions: { maxRegisters: 64, maxGap: 3 },
  probe,
  features(layout = {}) {
    const features = [
      {
        key: 'victron_grid_power',
        name: 'gridPower',
        ...MEASURES.gridPower,
        main: true,
        precision: 0,
        points: GRID.map((address) => h(address, 'int16')),
        value: (get) => sumOf(GRID.map((address) => i16(address)(get))),
      },
      {
        key: 'victron_consumption',
        name: 'consumption',
        ...MEASURES.homePower,
        main: true,
        precision: 0,
        points: CONSUMPTION.map((address) => h(address)),
        value: (get) => sumOf(CONSUMPTION.map((address) => u16(address)(get))),
      },
      {
        key: 'victron_solar_power',
        name: 'solarPower',
        ...MEASURES.productionPower,
        main: true,
        precision: 0,
        points: [...PV_AC.map((address) => h(address)), h(850)],
        value: (get) => sumOf([...PV_AC, 850].map((address) => u16(address)(get))),
      },
    ];
    if (layout.battery) {
      features.push(
        {
          key: 'victron_battery_level',
          name: 'batteryLevel',
          ...MEASURES.batteryLevel,
          main: true,
          precision: 0,
          points: [h(843)],
          value: u16(843),
        },
        ...batteryPower('victron', h(842, 'int16'), i16(842)),
        {
          key: 'victron_battery_voltage',
          name: 'batteryVoltage',
          ...MEASURES.voltage,
          precision: 1,
          points: [h(840)],
          value: u16(840, 10),
        },
      );
    }
    return features;
  },
};
