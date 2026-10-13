// -----------------------------------------------------------------------------
// Huawei SUN2000 inverters, through the SDongle (port 502) or the inverter's
// own access point, holding registers (function 3).
//
// Source: Huawei "SUN2000 Solar Inverter Modbus Interface Definitions"
// (registers 30000-37800), the addresses and gains matching the ones the
// wlcrs/huawei-solar-lib project documents (read to cross-check, not copied:
// AGPL). Gains: the raw value is divided by them.
//
// The power meter (DTSU666-H behind the inverter) and the LUNA2000 battery are
// optional: the probe looks for them once (meter status 1 = normal, a rated
// battery capacity above 0) and the features follow.
//
// Pitfalls: the inverter wants a second of rest after the connection opens,
// accepts one Modbus TCP client at a time, and answers "busy" (exception 6)
// while it is starting.
// -----------------------------------------------------------------------------

import { ModbusException } from '../modbus/frames.js';
import { MEASURES, point, readNumber, readString } from './common.js';

const h = (address, type) => point('holding', address, type);

/** Device status (32089) -> operating state. */
export function huaweiState(status) {
  if (status <= 0x0003 || status === 0xa000) return 'standby';
  if (status === 0x0100) return 'starting';
  if (status === 0x0201 || status === 0x0202) return 'throttled';
  if (status >= 0x0200 && status <= 0x0203) return 'producing';
  if (status >= 0x0401 && status <= 0x0405) return 'producing';
  if (status === 0x0300) return 'fault';
  if (status >= 0x0301 && status <= 0x03ff) return 'off';
  return 'unknown';
}

async function probe({ connection, unitId }) {
  const layout = { model: '', serial: '', meter: false, battery: false };
  layout.model = await readString(connection, unitId, 'holding', 30000, 15);
  layout.serial = await readString(connection, unitId, 'holding', 30015, 10);
  layout.meter = await optional(async () => {
    const [status] = await connection.read(unitId, 'holding', 37100, 1);
    return status === 1;
  });
  layout.battery = await optional(async () => {
    const words = await connection.read(unitId, 'holding', 37758, 2);
    return ((words[0] << 16) | words[1]) >>> 0 > 0;
  });
  return layout;
}

/** A read that a device without the accessory refuses: absent, not an error. */
async function optional(read) {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ModbusException && err.code !== 10 && err.code !== 11) {
      return false;
    }
    throw err;
  }
}

const num =
  (address, type, divisor = 1) =>
  (get) =>
    readNumber(get, 'holding', address, type, { scale: 1 / divisor });

export const huaweiSun2000 = {
  id: 'huawei_sun2000',
  label: 'Huawei SUN2000',
  waitAfterConnectMs: 1000,
  readOptions: { maxRegisters: 64, maxGap: 10 },
  probe,
  deviceName(layout) {
    return layout.model ? `Huawei ${layout.model}` : null;
  },
  identity(layout) {
    return { serial: layout.serial };
  },
  features(layout = {}) {
    const features = [
      {
        key: 'huawei_power',
        name: 'acPower',
        ...MEASURES.productionPower,
        min: -1_000_000,
        main: true,
        precision: 0,
        points: [h(32080, 'int32')],
        value: num(32080, 'int32'),
      },
      {
        key: 'huawei_yield',
        name: 'yieldTotal',
        ...MEASURES.productionIndex,
        main: true,
        precision: 2,
        points: [h(32106, 'uint32')],
        value: num(32106, 'uint32', 100),
      },
      {
        key: 'huawei_dc_power',
        name: 'dcPower',
        ...MEASURES.productionPower,
        precision: 0,
        points: [h(32064, 'int32')],
        value: num(32064, 'int32'),
      },
      {
        key: 'huawei_voltage',
        name: 'acVoltage',
        ...MEASURES.voltage,
        precision: 1,
        points: [h(32069, 'uint16')],
        value: num(32069, 'uint16', 10),
      },
      {
        key: 'huawei_current',
        name: 'acCurrent',
        ...MEASURES.current,
        precision: 3,
        points: [h(32072, 'int32')],
        value: num(32072, 'int32', 1000),
      },
      {
        key: 'huawei_temperature',
        name: 'temperature',
        ...MEASURES.deviceTemperature,
        precision: 1,
        points: [h(32087, 'int16')],
        value: num(32087, 'int16', 10),
      },
      {
        key: 'huawei_state',
        name: 'state',
        ...MEASURES.state,
        points: [h(32089, 'uint16')],
        value: (get) => {
          const status = readNumber(get, 'holding', 32089, 'uint16');
          return status === undefined ? undefined : { state: huaweiState(status) };
        },
      },
    ];
    if (layout.meter) {
      features.push(
        {
          // Huawei counts the meter power positive when exporting; Gladys
          // wants the grid power positive when importing.
          key: 'huawei_grid_power',
          name: 'gridPower',
          ...MEASURES.gridPower,
          main: true,
          precision: 0,
          points: [h(37113, 'int32')],
          value: (get) => {
            const power = readNumber(get, 'holding', 37113, 'int32');
            return power === undefined ? undefined : -power || 0;
          },
        },
        {
          key: 'huawei_grid_import',
          name: 'gridImport',
          ...MEASURES.importIndex,
          precision: 2,
          points: [h(37121, 'int32')],
          value: num(37121, 'int32', 100),
        },
        {
          // Some firmwares count the export negative (wlcrs/huawei_solar#54).
          key: 'huawei_grid_export',
          name: 'gridExport',
          ...MEASURES.exportIndex,
          precision: 2,
          points: [h(37119, 'int32')],
          value: (get) => {
            const value = readNumber(get, 'holding', 37119, 'int32', { scale: 0.01 });
            return value === undefined ? undefined : Math.abs(value);
          },
        },
      );
    }
    if (layout.battery) {
      features.push(
        {
          key: 'huawei_battery_level',
          name: 'batteryLevel',
          ...MEASURES.batteryLevel,
          main: true,
          precision: 1,
          points: [h(37760, 'uint16')],
          value: num(37760, 'uint16', 10),
        },
        ...batteryPower('huawei', h(37765, 'int32'), (get) =>
          readNumber(get, 'holding', 37765, 'int32'),
        ),
      );
    }
    return features;
  },
};

/**
 * The charge and discharge powers of a battery whose power is signed
 * (positive when charging).
 */
export function batteryPower(prefix, powerPoint, read) {
  const part = (sign) => (get) => {
    const power = read(get);
    return power === undefined ? undefined : Math.max(0, sign * power);
  };
  return [
    {
      key: `${prefix}_battery_charge`,
      name: 'batteryCharge',
      ...MEASURES.chargePower,
      precision: 0,
      points: [powerPoint],
      value: part(1),
    },
    {
      key: `${prefix}_battery_discharge`,
      name: 'batteryDischarge',
      ...MEASURES.dischargePower,
      precision: 0,
      points: [powerPoint],
      value: part(-1),
    },
  ];
}
