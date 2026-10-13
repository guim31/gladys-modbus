#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Modbus device, with the integration's own client
// and profiles: what the integration would publish, feature by feature. It
// never writes (no function 5, 6 or 16 is sent).
//
//   node scripts/probe.mjs --host 192.0.2.10 [--port 502] [--unit 1]
//     [--profile custom|eastron_sdm630|eastron_sdm120|sunspec|huawei_sun2000|victron_gx]
//     [--framing tcp|rtu_over_tcp] [--registers "Power: input 0x0034 float32 power"]
//     [--timeout 3]
//
// The serial number of the device is masked in the output.
// -----------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { ConnectionPool } from '../src/modbus/connection.js';
import { BlockReader } from '../src/modbus/reader.js';
import { PROFILES, customFeature } from '../src/profiles/index.js';
import { pointId } from '../src/profiles/common.js';
import { parseRegisters } from '../src/registers.js';
import { featureName } from '../src/names.js';
import { registerErrorText } from '../src/messages.js';

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    port: { type: 'string', default: '502' },
    unit: { type: 'string', default: '1' },
    profile: { type: 'string', default: 'custom' },
    framing: { type: 'string', default: 'tcp' },
    registers: { type: 'string', default: '' },
    timeout: { type: 'string', default: '3' },
  },
});

if (!values.host || !PROFILES[values.profile]) {
  console.error(
    `Usage: node scripts/probe.mjs --host <ip> [--profile ${Object.keys(PROFILES).join('|')}]`,
  );
  process.exit(2);
}

const profile = PROFILES[values.profile];
const unitId = Number(values.unit);
const pool = new ConnectionPool();
const connection = pool.get({
  host: values.host,
  port: Number(values.port),
  framing: values.framing,
  timeoutMs: Number(values.timeout) * 1000,
  waitAfterConnectMs: profile.waitAfterConnectMs ?? 0,
});

const mask = (text) => (text ? `${String(text).slice(0, 3)}…` : text);

try {
  let layout = {};
  if (profile.probe) {
    layout = await profile.probe({ connection, unitId });
    console.log('Probe:', JSON.stringify({ ...layout, serial: mask(layout.serial) }));
  }
  const { entries, errors } = parseRegisters(values.registers);
  for (const error of errors) {
    console.error('Register mistake:', registerErrorText(error).en);
  }
  const features = [...profile.features(layout), ...entries.map(customFeature)];
  const points = new Map();
  for (const feature of features) {
    for (const point of feature.points) {
      points.set(pointId(point), { id: pointId(point), ...point });
    }
  }
  const started = Date.now();
  const results = await new BlockReader().readPoints(
    connection,
    unitId,
    [...points.values()],
    profile.readOptions,
  );
  console.log(`Read ${points.size} point(s) in ${Date.now() - started} ms`);
  const get = (point) => {
    const result = results.get(pointId(point));
    return Array.isArray(result) ? result : undefined;
  };
  for (const feature of features) {
    const name = feature.label ?? featureName(feature.name, 'en', feature.occurrence);
    let value;
    try {
      value = feature.value(get);
    } catch (err) {
      value = `decode error: ${err.message}`;
    }
    const failures = feature.points
      .map((point) => results.get(pointId(point)))
      .filter((result) => result instanceof Error)
      .map((err) => err.message);
    console.log(
      [
        name.padEnd(32),
        `${feature.category}/${feature.type}`.padEnd(40),
        JSON.stringify(value),
        feature.unit ?? '',
        failures.length ? `(${failures.join(', ')})` : '',
      ].join(' '),
    );
  }
} catch (err) {
  console.error(`Probe failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  pool.closeAll();
}
