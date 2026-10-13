// -----------------------------------------------------------------------------
// The life of the integration: the container's own polling, the core's poll
// as a fallback, devices that stop and start answering, the connection
// status, the logs, the writes, the state budget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureLogs, createWorld, slot } from './helpers/world.js';
import * as F from './fixtures/devices.js';
import { MemoryStore } from '../src/store.js';
import { HEARTBEAT_MS, STATE_BUDGET_PER_MINUTE } from '../src/hub.js';
import { pick } from '../src/i18n.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A heat pump read through custom registers, in English. */
function heatPumpWorld({ config = {}, ...options } = {}) {
  return createWorld({
    servers: [{ units: { 7: F.heatPump() } }],
    config: (s) => ({
      language: 'en',
      ...slot(1, s[0], { unitId: 7, registers: F.HEAT_PUMP_REGISTERS }),
      ...config,
    }),
    ...options,
  });
}

const NAME = 'Modbus 127.0.0.1 #7';

test('the container refreshes the states by itself, without any onPoll from Gladys', async (t) => {
  const world = await heatPumpWorld({ timers: true });
  try {
    t.mock.method(world.hub, 'effectiveIntervalMs', () => 40);
    await world.app.poller.restart();
    assert.equal(world.state(NAME, 'Flow temperature'), 35.2);
    world.servers[0].units[7].int16('holding', 100, 401);
    for (let i = 0; i < 50 && world.state(NAME, 'Flow temperature') !== 40.1; i += 1) {
      await wait(20);
    }
    assert.equal(world.state(NAME, 'Flow temperature'), 40.1);
    // Gladys never called onPoll: no poll command went through the WebSocket.
    assert.ok(!world.fake.wsMessages.some((message) => /poll/i.test(message.type ?? '')));
  } finally {
    await world.stop();
  }
});

test('the core poll is a fallback: skipped right after the timer read', async () => {
  let now = 1_000_000;
  const world = await heatPumpWorld({ now: () => now });
  try {
    const device = world.device(NAME);
    world.servers[0].requests.length = 0;
    assert.deepEqual(await world.fake.poll(device), { success: true });
    assert.equal(world.servers[0].requests.length, 0, 'read less than 90 % of a period ago');
    now += 30_000;
    await world.fake.poll(device);
    assert.ok(world.servers[0].requests.length > 0);
  } finally {
    await world.stop();
  }
});

test('a device added to Gladys gets all its states at once, and the widget is nudged', async () => {
  const world = await heatPumpWorld({ createAll: false });
  try {
    assert.equal(world.fake.states.length, 0, 'nothing is read before the device exists');
    await world.createDevices();
    assert.equal(world.state(NAME, 'Defrost'), 1);
    assert.equal(world.state(NAME, 'Heat pump power'), 1820);
    assert.ok(world.fake.widgetRefreshes.includes('device_overview'));
  } finally {
    await world.stop();
  }
});

test('only the values that changed are published, with a heartbeat of 6 hours', async (t) => {
  const world = await heatPumpWorld();
  try {
    const calls = [];
    const original = world.gladys.publishChangedStates.bind(world.gladys);
    t.mock.method(world.gladys, 'publishChangedStates', (states, options) => {
      calls.push(options);
      return original(states, options);
    });
    const before = world.fake.states.length;
    await world.app.poller.cycle({ force: true });
    assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
    world.servers[0].units[7].uint16('input', 220, 1900);
    await world.app.poller.cycle({ force: true });
    assert.equal(world.fake.states.length, before + 1);
    assert.equal(world.state(NAME, 'Heat pump power'), 1900);
    assert.ok(calls.every((options) => options.heartbeat === HEARTBEAT_MS));
    assert.ok(HEARTBEAT_MS <= 12 * 60 * 60 * 1000);
  } finally {
    await world.stop();
  }
});

test('a device that stops answering: one warning, one scene event, the status says why', async (t) => {
  const world = await heatPumpWorld();
  try {
    const server = world.servers[0];
    const logs = await captureLogs(t, async () => {
      server.behaviour.mute = true;
      await world.app.poller.cycle({ force: true }); // first failure: not yet
      assert.equal(world.fake.sceneEvents.length, 0);
      await world.app.poller.cycle({ force: true });
      await world.app.poller.cycle({ force: true });
      await world.app.poller.cycle({ force: true });
    });
    const warnings = logs.filter((line) => line.includes('does not answer'));
    assert.equal(warnings.length, 1, logs.join('\n'));
    assert.deepEqual(
      world.fake.sceneEvents.map((event) => event.key),
      ['device_unreachable'],
    );
    const [event] = world.fake.sceneEvents;
    assert.equal(event.data.device, world.device(NAME).external_id);
    assert.equal(event.data.device_name, NAME);
    assert.match(event.data.error, /No answer from 127\.0\.0\.1:\d+ \(unit 7\)/);
    const status = world.fake.connectionStatus;
    assert.equal(status.connected, false);
    assert.match(status.message.fr, /Appareil 1 \(127\.0\.0\.1:\d+, esclave 7\) ne répond pas/);
    assert.ok(world.fake.widgetRefreshes.length > 0);

    const recovery = await captureLogs(t, async () => {
      server.behaviour.mute = false;
      await wait(300); // the late answers of the timed-out requests
      await world.app.poller.cycle({ force: true });
    });
    assert.deepEqual(
      recovery.filter((line) => line.includes('answers again')).length,
      1,
      recovery.join('\n'),
    );
    assert.deepEqual(
      world.fake.sceneEvents.map((event) => event.key),
      ['device_unreachable', 'device_reachable'],
    );
    assert.equal(world.fake.connectionStatus.connected, true);
    assert.match(world.fake.connectionStatus.message.en, /1 of 1 device\(s\) answering/);
  } finally {
    await world.stop();
  }
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const world = await heatPumpWorld();
  try {
    world.servers[0].units[7].uint16('input', 220, 2500);
    const logs = await captureLogs(t, async () => {
      await world.app.poller.cycle({ force: true });
      await world.fake.poll(world.device(NAME));
      await world.fake.widgetGet('device_overview', {
        settings: { device: world.device(NAME).external_id },
      });
    });
    assert.deepEqual(logs, []);
    const debug = await captureLogs(t, () => world.app.poller.cycle({ force: true }), 'debug');
    assert.ok(debug.length > 0, 'LOG_LEVEL=debug shows the cycles');
  } finally {
    await world.stop();
  }
});

test('credentials typed in an address never reach the logs nor the status', async (t) => {
  let world;
  const logs = await captureLogs(t, async () => {
    world = await createWorld({
      config: () => ({
        device_1_host: 'admin:hunter2@192.0.2.10',
        device_1_registers: 'Power: input 0 power',
      }),
    });
  });
  try {
    const everything = JSON.stringify([logs, world.fake.connectionStatuses]);
    assert.ok(!everything.includes('hunter2'), everything);
    assert.match(
      world.fake.connectionStatus.message.en,
      /Device 1: the address "…@192\.0\.2\.10" is not valid/,
    );
  } finally {
    await world.stop();
  }
});

test('configuration mistakes are listed entry by entry, the rest keeps working', async () => {
  const world = await createWorld({
    servers: [{ units: { 7: F.heatPump(), 1: F.sdm630() } }],
    config: (s) => ({
      language: 'fr',
      ...slot(1, s[0], {
        unitId: 7,
        registers:
          'Flow temperature: holding 100 int16 scale=0.1 temperature; Pump: coil 5 int16; Fan: input 3 int33',
      }),
      ...slot(2, s[0], { profile: 'eastron_sdm630' }),
      device_3_registers: 'Lost: holding 1',
    }),
  });
  try {
    const status = world.fake.connectionStatus;
    assert.equal(status.connected, false);
    assert.match(status.message.fr, /La configuration contient des erreurs/);
    assert.match(
      status.message.fr,
      /Appareil 1, entrée 2 « Pump » : un coil est un bit : il ne prend pas de type de donnée\./,
    );
    assert.match(
      status.message.en,
      /Device 1, entry 3 "Fan": unknown word "int33": expected a data type/,
    );
    assert.match(
      status.message.de,
      /Gerät 3: Register sind eingetragen, aber die Adresse ist leer\./,
    );
    // Device 1 keeps its valid entry, device 2 is untouched.
    assert.equal(world.fake.discoveredDevices.length, 2);
    assert.equal(world.state('Modbus 127.0.0.1 #7', 'Flow temperature'), 35.2);
    const ack = await world.fake.action('check_config');
    assert.equal(ack.success, false);
    assert.match(ack.error, /^3 erreur\(s\) dans la configuration :/);
    assert.match(
      ack.error,
      /Appareil 2 \(127\.0\.0\.1:\d+, esclave 1\), Eastron SDM630 : 12 fonctionnalité\(s\), répond/,
    );
  } finally {
    await world.stop();
  }
});

test('nothing configured: the status says where to start', async () => {
  const world = await createWorld();
  try {
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.es, /Introduzca la dirección/);
    const ack = await world.fake.action('check_config');
    assert.equal(ack.success, true);
  } finally {
    await world.stop();
  }
});

test('a wrong profile is said plainly (SunSpec on an Eastron meter)', async () => {
  const world = await createWorld({
    servers: [{ units: { 1: F.sdm630() } }],
    config: (s) => ({ language: 'en', ...slot(1, s[0], { profile: 'sunspec' }) }),
  });
  try {
    assert.equal(world.fake.discoveredDevices.length, 0);
    assert.match(world.fake.connectionStatus.message.en, /no SunSpec map at 40000, 0 or 50000/);
  } finally {
    await world.stop();
  }
});

test('registers the device refuses are reported, not taken for zeros', async () => {
  const world = await createWorld({
    servers: [{ units: { 1: F.sdm630() } }],
    config: (s) => ({ language: 'en', ...slot(1, s[0], { registers: 'Nothing: holding 4000' }) }),
  });
  try {
    assert.equal(world.state('Modbus 127.0.0.1', 'Nothing'), undefined);
    assert.match(world.fake.connectionStatus.message.en, /refuses every register/);
  } finally {
    await world.stop();
  }
});

test('an inverter asleep at restart is published from what /data remembers', async () => {
  const store = new MemoryStore();
  const first = await createWorld({
    servers: [{ units: { 126: F.smaSunnyBoy() } }],
    config: (s) => ({ language: 'en', ...slot(1, s[0], { profile: 'sunspec', unitId: 126 }) }),
    store,
  });
  const port = first.servers[0].port;
  const features = first.device('SMA SB5.0-1AV-41').features.map((feature) => feature.external_id);
  await first.stop();

  // Night: the inverter is off, nothing listens on its port.
  const second = await createWorld({
    config: () => ({
      language: 'en',
      device_1_host: '127.0.0.1',
      device_1_port: port,
      device_1_unit_id: 126,
      device_1_profile: 'sunspec',
    }),
    store,
  });
  try {
    const [device] = second.fake.discoveredDevices;
    assert.deepEqual(
      device.features.map((feature) => feature.external_id),
      features,
    );
    assert.equal(second.fake.connectionStatus.connected, false);
    assert.match(second.fake.connectionStatus.message.en, /does not answer: Cannot connect/);
  } finally {
    await second.stop();
  }
});

test('writing is off by default: the declared switches and setpoints refuse every write', async () => {
  const world = await heatPumpWorld();
  try {
    const device = world.device(NAME);
    const setpoint = device.features.find((feature) => feature.name === 'DHW setpoint');
    // Published controllable (read_only is not part of the structure the core
    // compares: turning writing on must not need a new device)...
    assert.equal(setpoint.read_only, false);
    assert.match(world.fake.connectionStatus.message.en, /Writing is off/);
    // ...but nothing is written while writing is off.
    const ack = await world.fake.setValue(device, setpoint, 50);
    assert.equal(ack.success, false);
    assert.match(ack.error, /Writing is disabled/);
    assert.deepEqual(world.servers[0].writes, []);
  } finally {
    await world.stop();
  }
});

test('writes: a bounded setpoint, a coil, a register switch; never outside the bounds', async () => {
  const world = await heatPumpWorld({ config: { allow_write: true } });
  try {
    const device = world.device(NAME);
    const feature = (name) => device.features.find((candidate) => candidate.name === name);
    const writes = world.servers[0].writes;

    assert.deepEqual(await world.fake.setValue(device, feature('DHW setpoint'), 50), {
      success: true,
    });
    assert.deepEqual(writes.at(-1), { unitId: 7, table: 'holding', address: 110, values: [50] });
    assert.equal(world.state(NAME, 'DHW setpoint'), 50, 'read back after the write');

    const refused = await world.fake.setValue(device, feature('DHW setpoint'), 70);
    assert.equal(refused.success, false);
    assert.match(refused.error, /70 is outside the declared bounds \(40 to 55\)/);
    assert.equal(writes.length, 1);

    await world.fake.setValue(device, feature('Circulation pump'), 1);
    assert.deepEqual(writes.at(-1), { unitId: 7, table: 'coil', address: 5, values: [1] });
    assert.equal(world.state(NAME, 'Circulation pump'), 1);

    await world.fake.setValue(device, feature('Heating'), 0);
    assert.deepEqual(writes.at(-1), { unitId: 7, table: 'holding', address: 111, values: [0] });

    const readOnly = await world.fake.setValue(device, feature('Flow temperature'), 20);
    assert.equal(readOnly.success, false);
    assert.match(readOnly.error, /read-only/);
    assert.equal(writes.length, 3);
  } finally {
    await world.stop();
  }
});

test('a scaled setpoint is written back in raw units', async () => {
  const world = await createWorld({
    servers: [{ units: { 7: F.heatPump() } }],
    config: (s) => ({
      language: 'en',
      allow_write: true,
      ...slot(1, s[0], {
        unitId: 7,
        registers: 'Flow setpoint: holding 100 int16 scale=0.1 setpoint min=20 max=60',
      }),
    }),
  });
  try {
    const device = world.device(NAME);
    await world.fake.setValue(device, device.features[0], 42.5);
    assert.deepEqual(world.servers[0].writes.at(-1).values, [425]);
    assert.equal(world.state(NAME, 'Flow setpoint'), 42.5);
  } finally {
    await world.stop();
  }
});

test('too many features for the pace asked: the reads slow down to the core budget', async () => {
  const world = await createWorld({
    servers: [{ units: { 1: F.sdm630(), 2: F.sdm630(), 3: F.sdm630(), 4: F.sdm630() } }],
    config: (s) => ({
      poll_interval: '5',
      ...slot(1, s[0], { profile: 'eastron_sdm630' }),
      ...slot(2, s[0], { profile: 'eastron_sdm630', unitId: 2 }),
      ...slot(3, s[0], { profile: 'eastron_sdm630', unitId: 3 }),
      ...slot(4, s[0], { profile: 'eastron_sdm630', unitId: 4 }),
    }),
  });
  try {
    // 48 features every 5 s would be 576 states a minute.
    const interval = world.hub.effectiveIntervalMs();
    assert.ok((48 * 60_000) / interval <= STATE_BUDGET_PER_MINUTE, `${interval} ms`);
    assert.equal(interval, 12_000);
  } finally {
    await world.stop();
  }
});

test('a new configuration is applied at once', async () => {
  const world = await heatPumpWorld();
  try {
    const port = world.servers[0].port;
    await world.fake.configUpdated({
      language: 'en',
      device_1_host: '127.0.0.1',
      device_1_port: port,
      device_1_unit_id: 7,
      device_1_registers: 'Power only: input 220 power',
    });
    const [device] = world.fake.discoveredDevices;
    assert.deepEqual(
      device.features.map((feature) => feature.name),
      ['Power only'],
    );
    assert.equal(pick(world.fake.connectionStatus.message, 'en'), '1 of 1 device(s) answering.');
  } finally {
    await world.stop();
  }
});
