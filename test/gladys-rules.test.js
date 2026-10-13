// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: the five profiles (Eastron SDM630 and SDM120, SunSpec as SMA,
// SolarEdge and Fronius answer it, Huawei SUN2000 with meter and battery,
// Victron GX) and custom registers of every kind, writable or not, in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld, slot } from './helpers/world.js';
import * as F from './fixtures/devices.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const fleets = {
  meters: {
    servers: [
      { units: { 1: F.sdm630(), 2: F.sdm120() }, framing: 'rtu_over_tcp' },
      { units: { 126: F.smaSunnyBoy() } },
      { units: { 1: F.huaweiSun2000() } },
      { units: { 100: F.victronGx() } },
    ],
    config: (s) => ({
      ...slot(1, s[0], { profile: 'eastron_sdm630' }),
      ...slot(2, s[0], { profile: 'eastron_sdm120', unitId: 2 }),
      ...slot(3, s[1], { profile: 'sunspec', unitId: 126 }),
      ...slot(4, s[2], { profile: 'huawei_sun2000' }),
    }),
    devices: 4,
  },
  sunspec: {
    servers: [
      { units: { 1: F.solarEdge() } },
      { units: { 1: F.froniusSymo(), 240: F.froniusSmartMeter() } },
      { units: { 100: F.victronGx(), 7: F.heatPump() } },
    ],
    config: (s) => ({
      ...slot(1, s[0], { profile: 'sunspec', registers: 'Inverter fan: holding 40000 uint16' }),
      ...slot(2, s[1], { profile: 'sunspec' }),
      ...slot(3, s[1], { profile: 'sunspec', unitId: 240 }),
      ...slot(4, s[2], { profile: 'victron_gx', unitId: 100 }),
    }),
    devices: 4,
  },
  custom: {
    servers: [{ units: { 7: F.heatPump() } }],
    config: (s) => ({ ...slot(1, s[0], { unitId: 7, registers: F.HEAT_PUMP_REGISTERS }) }),
    devices: 1,
  },
};

const scenarios = [];
for (const [fleet, spec] of Object.entries(fleets)) {
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const allowWrite of [false, true]) {
      scenarios.push({ fleet, spec, language, allowWrite });
    }
  }
}

for (const { fleet, spec, language, allowWrite } of scenarios) {
  test(`every discovered device follows the Gladys rules (${fleet}, ${language}, writing ${allowWrite ? 'on' : 'off'})`, async () => {
    const world = await createWorld({
      servers: spec.servers,
      config: (servers) => ({ ...spec.config(servers), language, allow_write: allowWrite }),
    });
    try {
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, spec.devices, 'every configured device is discovered');
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(feature.external_id.startsWith(`${device.external_id}:`), `${at}: foreign id`);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
          assert.ok(feature.name.length <= 40, `${at}: name longer than 40 characters`);
        }
      }
    } finally {
      await world.stop();
    }
  });
}

test('the writable features are the declared switches and setpoints, nothing else', async () => {
  const world = await createWorld({
    servers: fleets.custom.servers,
    config: (servers) => ({ ...fleets.custom.config(servers), allow_write: true }),
  });
  try {
    const [device] = world.fake.discoveredDevices;
    const writable = device.features.filter((feature) => !feature.read_only).map((f) => f.name);
    assert.deepEqual(writable.sort(), ['Circulation pump', 'DHW setpoint', 'Heating']);
    // Not voice-controllable: never a switch or thermostat category.
    for (const feature of device.features) {
      assert.ok(!['switch', 'thermostat', 'light'].includes(feature.category), feature.name);
    }
  } finally {
    await world.stop();
  }
});
