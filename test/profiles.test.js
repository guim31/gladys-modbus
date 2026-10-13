// -----------------------------------------------------------------------------
// The profiles against register maps filled after the manufacturers' tables:
// what each device publishes, with the right unit and sign.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld, slot } from './helpers/world.js';
import * as F from './fixtures/devices.js';
import { OFFSETS } from '../src/profiles/sunspec.js';
import { huaweiState } from '../src/profiles/huawei.js';

async function readAll(spec) {
  const world = await createWorld(spec);
  await world.app.poller.cycle({ force: true });
  return world;
}

test('Eastron SDM630 over an RS-485 gateway in RTU over TCP', async () => {
  const world = await readAll({
    servers: [{ units: { 1: F.sdm630() }, framing: 'rtu_over_tcp' }],
    config: (s) => ({ language: 'fr', ...slot(1, s[0], { profile: 'eastron_sdm630' }) }),
  });
  try {
    const name = 'Eastron SDM630 127.0.0.1';
    assert.equal(world.state(name, 'Puissance'), 1052.5);
    assert.equal(world.state(name, 'Énergie importée'), 12345.678);
    assert.equal(world.state(name, 'Énergie exportée'), 456.789);
    assert.equal(world.state(name, 'Tension L2'), 229.8);
    assert.equal(world.state(name, 'Courant L3'), 2.31);
    const device = world.device(name);
    const index = device.features.find((feature) => feature.name === 'Énergie importée');
    // An energy-sensor index in kWh: Gladys derives the energy tracking from it.
    assert.deepEqual(
      [index.category, index.type, index.unit],
      ['energy-sensor', 'index', 'kilowatt-hour'],
    );
    // Contiguous registers are read together: 3 requests for 12 values.
    world.servers[0].requests.length = 0;
    await world.app.poller.cycle({ force: true });
    assert.equal(world.servers[0].requests.length, 3);
  } finally {
    await world.stop();
  }
});

test('two meters on one gateway share its connection', async () => {
  const world = await readAll({
    servers: [{ units: { 1: F.sdm630(), 2: F.sdm120() }, framing: 'rtu_over_tcp' }],
    config: (s) => ({
      language: 'en',
      ...slot(1, s[0], { profile: 'eastron_sdm630' }),
      ...slot(2, s[0], { profile: 'eastron_sdm120', unitId: 2 }),
    }),
  });
  try {
    assert.equal(world.state('Eastron SDM120 127.0.0.1 #2', 'Power'), -1050.2);
    assert.equal(world.state('Eastron SDM120 127.0.0.1 #2', 'Energy imported'), 2210.5);
    assert.equal(world.servers[0].connectionCount, 1);
  } finally {
    await world.stop();
  }
});

test('SunSpec, integers and scale factors (SMA Sunny Boy, model 101)', async () => {
  const world = await readAll({
    servers: [{ units: { 126: F.smaSunnyBoy() } }],
    config: (s) => ({ language: 'en', ...slot(1, s[0], { profile: 'sunspec', unitId: 126 }) }),
  });
  try {
    const name = 'SMA SB5.0-1AV-41';
    const device = world.device(name);
    assert.ok(device, 'named after the common model');
    assert.deepEqual(
      device.params.find((param) => param.name === 'SERIAL'),
      { name: 'SERIAL', value: '3000000001' },
    );
    assert.equal(world.state(name, 'AC power'), 4987);
    assert.equal(world.state(name, 'Total yield'), 12345.678); // Wh -> kWh
    assert.equal(world.state(name, 'AC current'), 21.5); // 2150 × 10^-2
    assert.equal(world.state(name, 'AC voltage'), 234.5);
    assert.equal(world.state(name, 'Internal temperature'), 41.2);
    assert.equal(world.state(name, 'Operating state'), 'Producing');
    // The MPPT model 160 is skipped, the probe is kept in /data.
    const [layout] = Object.values(world.store.data);
    assert.deepEqual(
      layout.models.map((model) => model.id),
      [1, 101, 160],
    );
  } finally {
    await world.stop();
  }
});

test('SunSpec with a meter (SolarEdge, models 103 and 203)', async () => {
  const world = await readAll({
    servers: [{ units: { 1: F.solarEdge() } }],
    config: (s) => ({ language: 'de', ...slot(1, s[0], { profile: 'sunspec' }) }),
  });
  try {
    const name = 'SolarEdge SE8K-RW0TEBEN4';
    assert.equal(world.state(name, 'AC-Leistung'), 800);
    assert.equal(world.state(name, 'Gesamtertrag'), 234567.89);
    assert.equal(world.state(name, 'Betriebszustand'), 'Begrenzt');
    assert.equal(world.state(name, 'Zählerleistung'), -3500);
    assert.equal(world.state(name, 'Zählerstrom'), -5.12);
    assert.equal(world.state(name, 'Zähler bezogene Energie'), 4567.89);
    assert.equal(world.state(name, 'Zähler gelieferte Energie'), 9876.543);
  } finally {
    await world.stop();
  }
});

test('SunSpec float models (Fronius), a value not implemented is not published', async () => {
  const world = await readAll({
    servers: [{ units: { 1: F.froniusSymo(), 240: F.froniusSmartMeter() } }],
    config: (s) => ({
      language: 'es',
      ...slot(1, s[0], { profile: 'sunspec' }),
      ...slot(2, s[0], { profile: 'sunspec', unitId: 240 }),
    }),
  });
  try {
    assert.equal(world.state('Fronius Symo 8.2-3-M', 'Potencia CA'), 7800.5);
    assert.equal(world.state('Fronius Symo 8.2-3-M', 'Potencia CC'), 8020.25);
    // WH is NaN on this inverter: nothing is published rather than a wrong 0.
    assert.equal(world.state('Fronius Symo 8.2-3-M', 'Producción total'), undefined);
    assert.equal(world.state('Fronius Smart Meter 63A', 'Potencia del contador'), 1430.5);
    assert.equal(
      world.state('Fronius Smart Meter 63A', 'Energía importada del contador'),
      7654.321,
    );
  } finally {
    await world.stop();
  }
});

test('the SunSpec offsets match the SunSpec model definitions', async () => {
  const offsetsOf = async (id) => {
    const model = JSON.parse(
      await readFile(new URL(`./fixtures/sunspec/model_${id}.json`, import.meta.url), 'utf8'),
    );
    const offsets = {};
    let offset = 0;
    for (const point of model.group.points) {
      offsets[point.name] = offset;
      offset += point.size;
    }
    return offsets;
  };
  const families = [
    [[101, 102, 103], OFFSETS.inverterInt],
    [[111, 112, 113], OFFSETS.inverterFloat],
    [[201, 202, 203, 204], OFFSETS.meterInt],
    [[211, 212, 213, 214], OFFSETS.meterFloat],
  ];
  for (const [ids, expected] of families) {
    for (const id of ids) {
      const actual = await offsetsOf(id);
      for (const [name, offset] of Object.entries(expected)) {
        assert.equal(actual[name], offset, `model ${id}: ${name}`);
      }
    }
  }
  const common = await offsetsOf(1);
  assert.deepEqual([common.Mn, common.Md, common.Vr, common.SN], [2, 18, 42, 50]);
});

test('Huawei SUN2000: meter sign, battery split, status', async () => {
  const world = await readAll({
    servers: [{ units: { 1: F.huaweiSun2000() } }],
    config: (s) => ({ language: 'fr', ...slot(1, s[0], { profile: 'huawei_sun2000' }) }),
  });
  try {
    const name = 'Huawei SUN2000-5KTL-L1';
    assert.equal(world.state(name, 'Puissance AC'), 3950);
    assert.equal(world.state(name, 'Production totale'), 12345.67);
    assert.equal(world.state(name, 'Courant AC'), 17.25);
    // Exporting 1830 W: Gladys counts the grid power negative when exporting.
    assert.equal(world.state(name, 'Puissance réseau'), -1830);
    assert.equal(world.state(name, 'Énergie injectée au réseau'), 3456.78);
    assert.equal(world.state(name, 'Énergie soutirée au réseau'), 9876.54);
    assert.equal(world.state(name, 'Niveau de batterie'), 87.5);
    assert.equal(world.state(name, 'Puissance de charge batterie'), 0);
    assert.equal(world.state(name, 'Puissance de décharge batterie'), 1500);
    assert.equal(world.state(name, 'État de fonctionnement'), 'En production');
  } finally {
    await world.stop();
  }
});

test('Huawei SUN2000 without meter nor battery: no feature for them', async () => {
  const world = await readAll({
    servers: [{ units: { 1: F.huaweiSun2000({ meter: false, battery: false }) } }],
    config: (s) => ({ language: 'en', ...slot(1, s[0], { profile: 'huawei_sun2000' }) }),
  });
  try {
    const names = world.device('Huawei SUN2000-5KTL-L1').features.map((feature) => feature.name);
    assert.ok(!names.includes('Grid power'));
    assert.ok(!names.includes('Battery level'));
    assert.equal(names.length, 7);
  } finally {
    await world.stop();
  }
});

test('Huawei status codes map to operating states', () => {
  assert.equal(huaweiState(0x0000), 'standby');
  assert.equal(huaweiState(0xa000), 'standby');
  assert.equal(huaweiState(0x0100), 'starting');
  assert.equal(huaweiState(0x0200), 'producing');
  assert.equal(huaweiState(0x0202), 'throttled');
  assert.equal(huaweiState(0x0300), 'fault');
  assert.equal(huaweiState(0x0305), 'off');
  assert.equal(huaweiState(0x0402), 'producing');
  assert.equal(huaweiState(0x0800), 'unknown');
});

test('Victron GX: sums over the phases, battery from the system overview', async () => {
  const world = await readAll({
    servers: [{ units: { 100: F.victronGx() } }],
    config: (s) => ({ language: 'en', ...slot(1, s[0], { profile: 'victron_gx', unitId: 100 }) }),
  });
  try {
    const name = 'Victron GX 127.0.0.1 #100';
    assert.equal(world.state(name, 'Grid power'), 210 - 150 + 95);
    assert.equal(world.state(name, 'House consumption'), 650 + 410 + 980);
    assert.equal(world.state(name, 'Solar power'), 120 + 850 + 830 + 845 + 1520);
    assert.equal(world.state(name, 'Battery level'), 76);
    assert.equal(world.state(name, 'Battery charge power'), 802);
    assert.equal(world.state(name, 'Battery discharge power'), 0);
    assert.equal(world.state(name, 'Battery voltage'), 52.8);
  } finally {
    await world.stop();
  }
});

test('Victron GX without a battery', async () => {
  const world = await readAll({
    servers: [{ units: { 100: F.victronGx({ battery: false }) } }],
    config: (s) => ({ language: 'en', ...slot(1, s[0], { profile: 'victron_gx', unitId: 100 }) }),
  });
  try {
    const names = world.device('Victron GX 127.0.0.1 #100').features.map((feature) => feature.name);
    assert.deepEqual(names, ['Grid power', 'House consumption', 'Solar power']);
  } finally {
    await world.stop();
  }
});

test('custom registers: every kind, data type, word order and option', async () => {
  const world = await readAll({
    servers: [{ units: { 7: F.heatPump() } }],
    config: (s) => ({
      language: 'en',
      ...slot(1, s[0], { unitId: 7, registers: F.HEAT_PUMP_REGISTERS }),
    }),
  });
  try {
    const name = 'Modbus 127.0.0.1 #7';
    assert.equal(world.state(name, 'Flow temperature'), 35.2);
    assert.equal(world.state(name, 'Outdoor temperature'), -4.5);
    assert.equal(world.state(name, 'Compressor'), 1);
    assert.equal(world.state(name, 'Alarm'), 0);
    assert.equal(world.state(name, 'DHW setpoint'), 45);
    assert.equal(world.state(name, 'Heating'), 1);
    assert.equal(world.state(name, 'Heat pump energy'), 154.321); // Wh, word-swapped -> kWh
    assert.equal(world.state(name, 'Flow rate'), 2.3);
    assert.equal(world.state(name, 'Heat pump power'), 1820);
    assert.equal(world.state(name, 'Circulation pump'), 0);
    assert.equal(world.state(name, 'Defrost'), 1);
  } finally {
    await world.stop();
  }
});
