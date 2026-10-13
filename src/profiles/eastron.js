// -----------------------------------------------------------------------------
// Eastron SDM630 and SDM120 energy meters (RS-485, through a Modbus TCP
// gateway). Input registers (function 4), IEEE 754 float32, most significant
// register first.
//
// Source: Eastron "SDM630 Modbus Protocol" and "SDM120 Modbus Protocol"
// (eastroneurope.com), cross-checked with volkszaehler/mbmd (BSD-3-Clause),
// meters/rs485/sdm.go and sdm120.go. The register addresses below are the
// protocol addresses (the documents' "30001" is address 0x0000).
//
// Sign: the meters count the active power positive when importing.
// -----------------------------------------------------------------------------

import { MEASURES, point, readNumber } from './common.js';

const float = (address) => point('input', address, 'float32');
const read = (address) => (get) => readNumber(get, 'input', address, 'float32');

function measure(key, name, kind, address, extra = {}) {
  return {
    key,
    name,
    ...MEASURES[kind],
    precision: 2,
    points: [float(address)],
    value: read(address),
    ...extra,
  };
}

/** Readings the meters answer by groups of contiguous registers. */
const READ_OPTIONS = { maxRegisters: 64, maxGap: 0 };

export const sdm630 = {
  id: 'eastron_sdm630',
  label: 'Eastron SDM630',
  readOptions: READ_OPTIONS,
  features() {
    return [
      measure('sdm_power', 'power', 'power', 0x0034, { main: true, precision: 1 }),
      measure('sdm_import', 'energyImport', 'importIndex', 0x0048, { main: true, precision: 3 }),
      measure('sdm_export', 'energyExport', 'exportIndex', 0x004a, { main: true, precision: 3 }),
      measure('sdm_power_l1', 'powerL1', 'power', 0x000c, { precision: 1 }),
      measure('sdm_power_l2', 'powerL2', 'power', 0x000e, { precision: 1 }),
      measure('sdm_power_l3', 'powerL3', 'power', 0x0010, { precision: 1 }),
      measure('sdm_voltage_l1', 'voltageL1', 'voltage', 0x0000, { precision: 1 }),
      measure('sdm_voltage_l2', 'voltageL2', 'voltage', 0x0002, { precision: 1 }),
      measure('sdm_voltage_l3', 'voltageL3', 'voltage', 0x0004, { precision: 1 }),
      measure('sdm_current_l1', 'currentL1', 'current', 0x0006),
      measure('sdm_current_l2', 'currentL2', 'current', 0x0008),
      measure('sdm_current_l3', 'currentL3', 'current', 0x000a),
    ];
  },
};

export const sdm120 = {
  id: 'eastron_sdm120',
  label: 'Eastron SDM120',
  readOptions: READ_OPTIONS,
  features() {
    return [
      measure('sdm_power', 'power', 'power', 0x000c, { main: true, precision: 1 }),
      measure('sdm_import', 'energyImport', 'importIndex', 0x0048, { main: true, precision: 3 }),
      measure('sdm_export', 'energyExport', 'exportIndex', 0x004a, { main: true, precision: 3 }),
      measure('sdm_voltage', 'voltage', 'voltage', 0x0000, { precision: 1 }),
      measure('sdm_current', 'current', 'current', 0x0006),
    ];
  },
};
