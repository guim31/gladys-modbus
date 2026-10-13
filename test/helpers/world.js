// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Modbus devices on
// 127.0.0.1, an in-memory /data, and the integration wired on top through
// registerHandlers — the very wiring index.js uses.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { MemoryStore } from '../../src/store.js';
import { createFakeModbusServer } from './fakeModbus.js';

// Keep the test output readable (LOG_LEVEL is read on every log call).
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

/**
 * @param {object} options
 * @param {Array<{ units, framing? }>} [options.servers] fake Modbus servers to start
 * @param {(servers: Array) => object} [options.config] the integration config, built from the servers' addresses
 * @param {boolean} [options.connect]
 * @param {boolean} [options.createAll] add every discovered device to Gladys
 * @param {object} [options.store]
 * @param {boolean} [options.timers] run the container's polling timer
 * @param {() => number} [options.now]
 */
export async function createWorld({
  servers: serverSpecs = [],
  config = () => ({}),
  connect = true,
  createAll = true,
  store = new MemoryStore(),
  timers = false,
  now,
} = {}) {
  const servers = await Promise.all(serverSpecs.map((spec) => createFakeModbusServer(spec)));
  const gladys = createFakeGladys({ config: { timeout: 1, ...config(servers) } });
  const app = registerHandlers(gladys, { store, timers, now });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    servers,
    store,
    /** Add the discovered devices to Gladys, as the user does from the Discovery tab. */
    async createDevices(devices = gladys.fake.discoveredDevices) {
      for (const device of devices) {
        await gladys.fake.deviceCreated(device);
      }
    },
    device(name) {
      return gladys.fake.discoveredDevices.find((device) => device.name === name);
    },
    /** The last state published for a feature, by device and feature name. */
    state(deviceName, featureName) {
      const device = world.device(deviceName);
      const feature = device?.features.find((candidate) => candidate.name === featureName);
      if (!feature) {
        throw new Error(`No feature ${featureName} on ${deviceName}`);
      }
      return gladys.fake.lastState(feature.external_id);
    },
    async stop() {
      await app.stop();
      await Promise.all(servers.map((server) => server.close()));
    },
  };
  if (connect) {
    await gladys.connect();
    if (createAll) {
      await world.createDevices();
    }
  }
  return world;
}

/**
 * Capture the log lines written at `level` and above while `run` runs.
 * @returns {Promise<string[]>}
 */
export async function captureLogs(t, run, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  try {
    await run();
  } finally {
    process.env.LOG_LEVEL = previous;
    console.log.mock.restore();
    console.error.mock.restore();
  }
  return lines;
}

/** The config keys of one device slot. */
export function slot(n, server, { unitId = 1, profile = 'custom', registers, framing } = {}) {
  return {
    [`device_${n}_host`]: server.host,
    [`device_${n}_port`]: server.port,
    [`device_${n}_unit_id`]: unitId,
    [`device_${n}_profile`]: profile,
    [`device_${n}_framing`]: framing ?? server.framing,
    ...(registers ? { [`device_${n}_registers`]: registers } : {}),
  };
}
