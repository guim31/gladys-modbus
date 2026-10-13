// -----------------------------------------------------------------------------
// The custom registers syntax and the configuration slots: what is accepted,
// and a clear message, entry by entry, for every mistake.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryValue, parseEntry, parseRegisters } from '../src/registers.js';
import { REGISTER_ERRORS, configErrorText, registerErrorText } from '../src/messages.js';
import { DEFAULT_CONFIG, normalizeConfig, platformId, readSlots } from '../src/config.js';
import { HEAT_PUMP_REGISTERS } from './fixtures/devices.js';

const entry = (text) => {
  const result = parseEntry(text);
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.entry;
};
const code = (text) => parseEntry(text).error?.code;

test('an entry: name, table, address, then type, kind and options in any order', () => {
  assert.deepEqual(entry('Flow: holding 100 int16 scale=0.1 temperature'), {
    index: 1,
    name: 'Flow',
    key: 'c_h100',
    kind: 'temperature',
    table: 'holding',
    address: 100,
    dataType: 'int16',
    bit: undefined,
    swap: 'none',
    scale: 0.1,
    offset: 0,
    unit: 'celsius',
    min: -50,
    max: 150,
    precision: 1,
    on: 1,
    off: 0,
    writable: false,
  });
  const reordered = entry('Flow: temperature scale=0.1 int16 HOLDING 0x64');
  assert.equal(reordered.address, 100);
  assert.equal(reordered.key, 'c_h100');
  // Defaults: int16 and `value` for a register, `binary` for a bit.
  assert.deepEqual([entry('X: input 3').dataType, entry('X: input 3').kind], ['int16', 'value']);
  assert.equal(entry('X: coil 3').kind, 'binary');
  assert.equal(entry('X: holding 3 bit15').key, 'c_h3_b15');
  assert.equal(entry('X: discrete 3').key, 'c_d3');
  assert.equal(entry('X: input 3 scale=0,01').precision, 2, 'decimal comma');
  assert.equal(entry('X: input 3 float32').precision, 2);
  assert.equal(entry('X: input 3 energy unit=Wh').unit, 'watt-hour');
});

test('the whole field: semicolons between entries, duplicates refused', () => {
  const { entries, errors } = parseRegisters(HEAT_PUMP_REGISTERS);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 11);
  assert.deepEqual(parseRegisters(' ; ;').entries, []);
  const duplicates = parseRegisters('A: holding 1; B: holding 1; A: holding 2');
  assert.deepEqual(
    duplicates.errors.map((error) => [error.entry, error.code, error.params.other]),
    [
      [2, 'duplicate', 1],
      [3, 'duplicateName', 1],
    ],
  );
  const many = Array.from({ length: 45 }, (_, i) => `R${i}: holding ${i}`).join(';');
  const tooMany = parseRegisters(many);
  assert.equal(tooMany.entries.length, 40);
  assert.equal(tooMany.errors[0].code, 'tooMany');
});

test('every mistake has its code', () => {
  const cases = {
    'no colon here': 'missingColon',
    ': holding 1': 'emptyName',
    [`${'n'.repeat(41)}: holding 1`]: 'nameTooLong',
    'X: holding 70000': 'badAddress',
    'X: holding 1 colour=red': 'unknownOption',
    'X: holding 1 int33': 'unknownWord',
    'X: 100 int16': 'missingTable',
    'X: holding int16': 'missingAddress',
    'X: coil 1 int16': 'typeOnBits',
    'X: holding 1 scale=abc': 'badNumber',
    'X: holding 1 scale=0': 'badNumber',
    'X: holding 1 precision=1.5': 'badNumber',
    'X: holding 1 swap=little': 'badSwap',
    'X: holding 1 power unit=°C': 'badUnit',
    'X: holding 1 int32 binary': 'booleanNeedsRegister',
    'X: coil 1 temperature': 'bitsAreBinary',
    'X: input 1 switch': 'readOnlyTable',
    'X: holding 1 bit3 switch': 'noBitWrite',
    'X: holding 1 int64 setpoint min=1 max=2': 'noWideWrite',
    'X: holding 1 setpoint': 'setpointBounds',
    'X: holding 1 min=10 max=5': 'badBounds',
  };
  for (const [text, expected] of Object.entries(cases)) {
    assert.equal(code(text), expected, text);
  }
  // Every code the parser can produce has a message.
  const produced = new Set([...Object.values(cases), 'tooMany', 'duplicate', 'duplicateName']);
  for (const produce of produced) {
    assert.ok(REGISTER_ERRORS[produce], produce);
  }
});

test('the messages name the device, the entry and the word at fault', () => {
  const { errors } = parseRegisters('Flow: holding 100 int16; Pump: coil 5 int16');
  const text = configErrorText({ slot: 2, code: 'register', params: errors[0] });
  assert.equal(text.en, 'Device 2, entry 2 "Pump": a coil is one bit: it takes no data type.');
  assert.equal(
    text.fr,
    'Appareil 2, entrée 2 « Pump » : un coil est un bit : il ne prend pas de type de donnée.',
  );
  assert.equal(
    text.de,
    'Gerät 2, Eintrag 2 „Pump“: ein coil ist ein Bit: Es braucht keinen Datentyp.',
  );
  assert.equal(
    text.es,
    'Dispositivo 2, entrada 2 «Pump»: un coil es un bit: no lleva tipo de dato.',
  );
  const unit = registerErrorText(parseEntry('X: holding 1 power unit=°C').error);
  assert.match(unit.en, /unit=°C does not fit power: use W, kW\./);
});

test('values: scale, offset, word order, conversions, booleans', () => {
  assert.equal(entryValue(entry('X: holding 1 int16 scale=0.1'), [0xffce]), -5);
  assert.equal(entryValue(entry('X: holding 1 uint16 scale=0.5 offset=-40'), [100]), 10);
  assert.equal(entryValue(entry('X: input 1 uint32 swap=word'), [0x0001, 0x0002]), 0x00020001);
  assert.equal(entryValue(entry('X: input 1 uint32 energy unit=Wh'), [0, 1500]), 1.5);
  assert.equal(entryValue(entry('X: input 1 float32 energy unit=MWh'), [0x3f80, 0]), 1000);
  assert.equal(entryValue(entry('X: input 1 float32'), [0x7fc0, 0]), undefined, 'NaN');
  assert.equal(entryValue(entry('X: holding 1 bit2'), [0b100]), 1);
  assert.equal(entryValue(entry('X: holding 1 switch on=2 off=5'), [2]), 1);
  assert.equal(entryValue(entry('X: holding 1 switch on=2 off=5'), [5]), 0);
  assert.equal(entryValue(entry('X: coil 1'), [1]), 1);
});

test('the configuration: defaults, types, slots', () => {
  const config = normalizeConfig({
    poll_interval: 10,
    timeout: '5',
    allow_write: 'true',
    language: 'it',
  });
  assert.equal(config.poll_interval, '10');
  assert.equal(config.timeout, 5);
  assert.equal(config.allow_write, true);
  assert.equal(config.language, 'fr', 'an unknown language falls back to French');
  assert.equal(normalizeConfig({ poll_interval: '7' }).poll_interval, DEFAULT_CONFIG.poll_interval);
  assert.equal(normalizeConfig({ device_1_port: '' }).device_1_port, 502, 'an emptied field');

  const { slots, errors, targets } = readSlots(
    normalizeConfig({
      device_1_host: ' 192.0.2.10 ',
      device_1_profile: 'eastron_sdm630',
      device_2_host: 'http://192.0.2.11',
      device_3_host: '192.0.2.10',
      device_3_profile: 'sunspec',
      device_4_host: 'inverter.local',
      device_4_unit_id: 300,
    }),
  );
  assert.deepEqual(
    slots.map((slot) => [slot.index, slot.host, slot.port, slot.unitId, slot.profileId]),
    [[1, '192.0.2.10', 502, 1, 'eastron_sdm630']],
  );
  assert.deepEqual(
    errors.map((error) => [error.slot, error.code]),
    [
      [2, 'badHost'],
      [3, 'duplicateSlot'],
      [4, 'badUnitId'],
    ],
  );
  assert.deepEqual([...targets.keys()], [1, 3]);
  assert.equal(platformId('Inverter.LOCAL', 502, 3), 'inverter.local-502-3');
  const custom = readSlots(normalizeConfig({ device_1_host: '192.0.2.12' }));
  assert.deepEqual(
    custom.errors.map((error) => error.code),
    ['nothingToRead'],
  );
  assert.equal(custom.targets.size, 1, 'the "Test a read" action still reaches it');
});
