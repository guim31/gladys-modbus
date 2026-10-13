// -----------------------------------------------------------------------------
// The buttons of the Configuration screen and the dashboard widget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createWorld, slot } from './helpers/world.js';
import * as F from './fixtures/devices.js';

function world(config = {}) {
  return createWorld({
    servers: [{ units: { 7: F.heatPump(), 126: F.smaSunnyBoy(), 1: F.sdm630() } }],
    config: (s) => ({
      language: 'en',
      ...slot(1, s[0], { unitId: 7, registers: F.HEAT_PUMP_REGISTERS }),
      ...slot(2, s[0], { unitId: 126, profile: 'sunspec' }),
      // No register yet: the action is how the user finds them.
      ...slot(3, s[0], { unitId: 1 }),
      ...config,
    }),
  });
}

test('test a read: raw words, the declared conversion, every other reading', async () => {
  const w = await world();
  try {
    const ack = await w.fake.action('test_read', {
      device: '3',
      register: 'input 0x0048 float32 energy',
    });
    assert.equal(ack.success, true, ack.error);
    const { en, fr } = ack.data.message;
    assert.match(en, /^Device 3 \(127\.0\.0\.1:\d+, unit 1\), input 72-73:/);
    assert.match(en, /\nRaw: 0x4640 0xE6B6 \(17984, 59062\)/);
    assert.match(en, /\nValue \(float32\): 12345\.68 kWh/);
    assert.match(fr, /\nValeur \(float32\) : 12345,68 kWh/);
    assert.match(en, /\n- float32: 12345\.68 · .* \(swap=word\)/);
    assert.match(en, /\n- uint32: 1178658486/);
  } finally {
    await w.stop();
  }
});

test('test a read: count= looks around, swap and scale are applied', async () => {
  const w = await world();
  try {
    const ack = await w.fake.action('test_read', {
      device: '1',
      register: 'holding 100 int16 scale=0.1 count=3',
    });
    assert.equal(ack.success, true, ack.error);
    assert.match(
      ack.data.message.en,
      /holding 100-102:\nRaw: 0x0160 0xFFD3 0x0005 \(352, 65491, 5\)/,
    );
    assert.match(ack.data.message.en, /Value \(int16, ×0\.1\): 35\.2/);
    assert.match(ack.data.message.de, /Wert \(int16, ×0\.1\): 35,2/);
    const bits = await w.fake.action('test_read', { device: '1', register: 'coil 5 count=1' });
    assert.match(bits.data.message.en, /Raw: 0\nValue \(coil\): 0/);
  } finally {
    await w.stop();
  }
});

test('test a read: sunspec lists the models', async () => {
  const w = await world();
  try {
    const ack = await w.fake.action('test_read', { device: '2', register: 'SunSpec' });
    assert.equal(ack.success, true, ack.error);
    assert.equal(
      ack.data.message.en,
      [
        'SunSpec map at 40000: SMA SB5.0-1AV-41 4.01.15.R. Models:',
        '- 1 at 40002, 66 registers',
        '- 101 at 40070, 50 registers (read by the integration)',
        '- 160 at 40122, 48 registers',
      ].join('\n'),
    );
  } finally {
    await w.stop();
  }
});

test('test a read: mistakes in red, in the language of the configuration', async () => {
  const w = await world({ language: 'fr' });
  try {
    const missing = await w.fake.action('test_read', { device: '4', register: 'holding 1' });
    assert.equal(missing.success, false);
    assert.match(missing.error, /Appareil 4 n'a pas d'adresse/);
    const syntax = await w.fake.action('test_read', { device: '1', register: 'holding 1 float33' });
    assert.match(syntax.error, /^entrée 1 : mot inconnu « float33 »/);
    const exception = await w.fake.action('test_read', { device: '1', register: 'input 9999' });
    assert.match(
      exception.error,
      /a répondu l'exception Modbus 2 \(illegal data address\)\. Cette adresse n'existe pas/,
    );
    const empty = await w.fake.action('test_read', { device: '1' });
    assert.match(empty.error, /Saisissez le registre à lire/);
  } finally {
    await w.stop();
  }
});

test('check the configuration: the state of every device', async () => {
  const w = await world({ device_3_registers: 'Power: input 0x0034 float32 power' });
  try {
    const ack = await w.fake.action('check_config');
    assert.equal(ack.success, true, ack.error);
    const lines = ack.data.message.en.split('\n');
    assert.equal(lines[0], 'The configuration has no mistake.');
    assert.match(
      lines[1],
      /^Device 1 \(127\.0\.0\.1:\d+, unit 7\), Modbus: 11 feature\(s\), answers$/,
    );
    assert.match(lines[2], /^Device 2 .*, SunSpec: 7 feature\(s\), answers$/);
  } finally {
    await w.stop();
  }
});

test('the widget: live tiles of the main values, the health of the link', async () => {
  const w = await world();
  try {
    const sma = w.device('SMA SB5.0-1AV-41');
    const ack = await w.fake.widgetGet('device_overview', {
      settings: { device: sma.external_id },
      language: 'fr',
    });
    assert.equal(ack.success, true, ack.error);
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content), []);
    const tiles = content.components.filter((component) => component.type === 'value');
    const ids = new Set(sma.features.map((feature) => feature.external_id));
    assert.deepEqual(
      tiles.map((tile) => sma.features.find((f) => f.external_id === tile.device_feature).name),
      ['AC power', 'Total yield', 'DC power'],
    );
    assert.ok(tiles.every((tile) => ids.has(tile.device_feature)));
    const [status] = content.components.filter((component) => component.type === 'status');
    assert.deepEqual(status.items[0], {
      label: { en: 'Link', fr: 'Liaison', de: 'Verbindung', es: 'Enlace' },
      value: 'Répond',
      color: 'success',
    });
    assert.match(status.items[1].value, /^\d\d:\d\d:\d\d$/);
    assert.deepEqual(status.items[2].value, 'En production');
  } finally {
    await w.stop();
  }
});

test('the widget of a device that stopped answering, or that is gone', async () => {
  const w = await world();
  try {
    w.servers[0].behaviour.mute = true;
    await w.app.poller.cycle({ force: true });
    await w.app.poller.cycle({ force: true });
    const device = w.device('Modbus 127.0.0.1 #7');
    const ack = await w.fake.widgetGet('device_overview', {
      settings: { device: device.external_id },
      language: 'en',
    });
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content), []);
    const status = content.components.find((component) => component.type === 'status');
    assert.equal(status.items[0].value, 'Not answering');
    assert.equal(status.items[0].color, 'danger');
    assert.ok(status.items.at(-1).value.length <= 40);
    const gone = await w.fake.widgetGet('device_overview', { settings: { device: 'ext:x' } });
    assert.deepEqual(validateWidgetContent(gone.data.content), []);
    const none = await w.fake.widgetGet('device_overview', { settings: {} });
    assert.equal(none.data.content.components[0].variant, 'body');
  } finally {
    w.servers[0].behaviour.mute = false;
    await w.stop();
  }
});
