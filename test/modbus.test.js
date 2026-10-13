// -----------------------------------------------------------------------------
// The Modbus layer: data types, frames, the connection and the grouped reads,
// against the fake server of test/helpers/fakeModbus.js and, for Modbus TCP,
// against an independent implementation (jsmodbus).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import {
  bufferToWords,
  decodeString,
  decodeWords,
  encodeValue,
  wordsToBuffer,
} from '../src/modbus/datatypes.js';
import {
  ModbusException,
  crc16,
  decodeRtu,
  decodeTcp,
  encodeRtu,
  parseResponse,
  readRequest,
} from '../src/modbus/frames.js';
import { ConnectionPool, ModbusConnection, isUnreachable } from '../src/modbus/connection.js';
import { BlockReader, planReads } from '../src/modbus/reader.js';
import { closedPort, createFakeModbusServer, createUnit } from './helpers/fakeModbus.js';

const require = createRequire(import.meta.url);

test('the four word and byte orders decode a float32 like Home Assistant', () => {
  // 231.2 V as an IEEE 754 float is 0x4367 0x3333 (ABCD).
  assert.equal(decodeWords([0x4367, 0x3333], 'float32').toFixed(1), '231.2');
  assert.equal(decodeWords([0x3333, 0x4367], 'float32', 'word').toFixed(1), '231.2');
  assert.equal(decodeWords([0x6743, 0x3333], 'float32', 'byte').toFixed(1), '231.2');
  assert.equal(decodeWords([0x3333, 0x6743], 'float32', 'word_byte').toFixed(1), '231.2');
});

test('integers of every width, signed and unsigned', () => {
  assert.equal(decodeWords([0xffff], 'int16'), -1);
  assert.equal(decodeWords([0xffff], 'uint16'), 65535);
  assert.equal(decodeWords([0x0102, 0x0304], 'uint32'), 0x01020304);
  assert.equal(decodeWords([0x0102, 0x0304], 'uint32', 'word'), 0x03040102);
  assert.equal(decodeWords([0xffff, 0xfffe], 'int32'), -2);
  assert.equal(decodeWords([0, 0, 0x0001, 0x0000], 'uint64'), 65536);
  assert.equal(decodeWords([0xffff, 0xffff, 0xffff, 0xffff], 'int64'), -1);
  assert.equal(decodeWords([0x4059, 0, 0, 0], 'float64'), 100);
  assert.throws(() => decodeWords([1], 'int32'), /spans 2 register/);
  assert.throws(() => decodeWords([1], 'int8'), /Unknown data type/);
});

test('encoding is the inverse of decoding, and refuses what does not fit', () => {
  for (const swap of ['none', 'byte', 'word', 'word_byte']) {
    assert.equal(decodeWords(encodeValue(-1234, 'int32', swap), 'int32', swap), -1234);
    assert.equal(decodeWords(encodeValue(21.5, 'float32', swap), 'float32', swap), 21.5);
    assert.deepEqual(bufferToWords(wordsToBuffer([0x1234, 0xabcd], swap), swap), [0x1234, 0xabcd]);
  }
  assert.deepEqual(encodeValue(450, 'int16'), [450]);
  assert.deepEqual(encodeValue(-1, 'int16'), [0xffff]);
  assert.throws(() => encodeValue(70000, 'uint16'), RangeError);
  assert.throws(() => encodeValue(-1, 'uint32'), RangeError);
  assert.throws(() => encodeValue(1, 'uint64'), /not supported/);
});

test('strings: two characters per register, padding dropped', () => {
  const words = [0x5375, 0x6e53, 0x7065, 0x6300, 0x0000];
  assert.equal(decodeString(words), 'SunSpec');
});

test('CRC-16/MODBUS of the textbook request 01 03 00 00 00 0A is C5 CD', () => {
  const frame = encodeRtu(1, readRequest('holding', 0, 10));
  assert.deepEqual([...frame], [0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd]);
  assert.equal(crc16(Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a])), 0xcdc5);
});

test('a Modbus TCP answer captured by pysunspec2 decodes to the SunSpec marker', () => {
  // From the pysunspec2 test suite (Apache-2.0): the answer to reading the two
  // registers at 40000, "SunS".
  const answer = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x01, 0x03, 0x04]),
    Buffer.from('SunS', 'latin1'),
  ]);
  const { frame, rest } = decodeTcp(answer);
  assert.equal(rest.length, 0);
  assert.equal(frame.unitId, 1);
  const words = parseResponse(readRequest('holding', 40000, 2), frame.pdu);
  assert.deepEqual(words, [0x5375, 0x6e53]);
});

test('frames: exceptions, partial and corrupted RTU answers', () => {
  const request = readRequest('input', 0, 2);
  assert.throws(
    () => parseResponse(request, Buffer.from([0x84, 0x02])),
    (err) => err instanceof ModbusException && err.code === 2,
  );
  const answer = encodeRtu(1, Buffer.from([0x04, 0x04, 0x43, 0x67, 0x33, 0x33]));
  assert.equal(decodeRtu(answer.subarray(0, 5)).frame, undefined);
  assert.deepEqual([...decodeRtu(answer).frame.pdu], [0x04, 0x04, 0x43, 0x67, 0x33, 0x33]);
  const corrupted = Buffer.from(answer);
  corrupted[4] ^= 0xff;
  assert.throws(() => decodeRtu(corrupted), /CRC/);
  assert.throws(() => readRequest('holding', 65535, 2), RangeError);
  assert.throws(() => readRequest('holding', 0, 126), RangeError);
});

for (const framing of ['tcp', 'rtu_over_tcp']) {
  test(`reads, writes and exceptions over ${framing}`, async () => {
    const unit = createUnit()
      .float32('input', 0, 230.5)
      .zeros('holding', 100, 2)
      .bit('coil', 3, 0)
      .bit('discrete', 7, 1);
    const server = await createFakeModbusServer({ framing, units: { 1: unit } });
    const connection = new ModbusConnection({ host: server.host, port: server.port, framing });
    try {
      const words = await connection.read(1, 'input', 0, 2);
      assert.equal(decodeWords(words, 'float32'), 230.5);
      assert.deepEqual(await connection.read(1, 'discrete', 7, 1), [1]);
      await connection.writeCoil(1, 3, true);
      assert.deepEqual(await connection.read(1, 'coil', 3, 1), [1]);
      await connection.writeRegisters(1, 100, [0x0001, 0x0002]);
      await connection.writeRegisters(1, 101, [7]);
      assert.deepEqual(await connection.read(1, 'holding', 100, 2), [1, 7]);
      await assert.rejects(
        connection.read(1, 'holding', 500, 1),
        (err) => err instanceof ModbusException && err.code === 2 && !isUnreachable(err),
      );
      // A unit missing behind the gateway: exception 11, the device is unreachable.
      await assert.rejects(connection.read(9, 'holding', 0, 1), (err) => isUnreachable(err));
    } finally {
      connection.close();
      await server.close();
    }
  });
}

test('concurrent requests are queued: one at a time on the connection', async () => {
  const unit = createUnit();
  for (let i = 0; i < 20; i += 1) {
    unit.uint16('holding', i, i * 10);
  }
  const server = await createFakeModbusServer({ framing: 'rtu_over_tcp', units: { 1: unit } });
  server.behaviour.latencyMs = 5;
  const connection = new ModbusConnection({
    host: server.host,
    port: server.port,
    framing: 'rtu_over_tcp',
  });
  try {
    const answers = await Promise.all(
      Array.from({ length: 20 }, (_, i) => connection.read(1, 'holding', i, 1)),
    );
    assert.deepEqual(
      answers.map(([word]) => word),
      Array.from({ length: 20 }, (_, i) => i * 10),
    );
    assert.equal(server.connectionCount, 1);
  } finally {
    connection.close();
    await server.close();
  }
});

test('a silent device times out, and the next answer is not mixed up', async () => {
  const unit = createUnit().uint16('holding', 0, 42);
  const server = await createFakeModbusServer({
    framing: 'rtu_over_tcp',
    units: { 1: unit, 2: createUnit().uint16('holding', 0, 1) },
    silentUnits: new Set([2]),
  });
  const connection = new ModbusConnection({
    host: server.host,
    port: server.port,
    framing: 'rtu_over_tcp',
    timeoutMs: 100,
  });
  try {
    await assert.rejects(connection.read(2, 'holding', 0, 1), (err) => {
      assert.ok(isUnreachable(err));
      assert.match(err.message, /No answer from 127\.0\.0\.1:\d+ \(unit 2\) within 100 ms/);
      return true;
    });
    assert.deepEqual(await connection.read(1, 'holding', 0, 1), [42]);
  } finally {
    connection.close();
    await server.close();
  }
});

test('a connection dropped by the device is reopened transparently', async () => {
  const unit = createUnit().uint16('input', 5, 99);
  const server = await createFakeModbusServer({ units: { 1: unit } });
  const connection = new ModbusConnection({ host: server.host, port: server.port });
  try {
    assert.deepEqual(await connection.read(1, 'input', 5, 1), [99]);
    // Dropped between two requests (idle timeout of the device)...
    server.dropConnections();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(await connection.read(1, 'input', 5, 1), [99]);
    // ...and while a request is in flight: retried once on a fresh connection.
    server.behaviour.dropNext = true;
    assert.deepEqual(await connection.read(1, 'input', 5, 1), [99]);
  } finally {
    connection.close();
    await server.close();
  }
});

test('a busy device is asked again once', async () => {
  const server = await createFakeModbusServer({
    units: { 1: createUnit().uint16('holding', 0, 3) },
  });
  const connection = new ModbusConnection({ host: server.host, port: server.port });
  try {
    server.behaviour.nextException = 6;
    assert.deepEqual(await connection.read(1, 'holding', 0, 1), [3]);
    assert.equal(server.requests.length, 2);
  } finally {
    connection.close();
    await server.close();
  }
});

test('a refused connection is retried with a growing delay, failing fast in between', async () => {
  const port = await closedPort();
  let now = 1_000_000;
  let attempts = 0;
  const connection = new ModbusConnection({
    host: '127.0.0.1',
    port,
    now: () => now,
    createSocket: (options) => {
      attempts += 1;
      return net.createConnection(options);
    },
  });
  await assert.rejects(
    connection.read(1, 'holding', 0, 1),
    /Cannot connect to 127\.0\.0\.1:\d+: ECONNREFUSED/,
  );
  await assert.rejects(connection.read(1, 'holding', 0, 1), /ECONNREFUSED/);
  assert.equal(attempts, 1, 'no new attempt within the first second');
  now += 1000;
  await assert.rejects(connection.read(1, 'holding', 0, 1), /ECONNREFUSED/);
  assert.equal(attempts, 2);
  now += 1000; // the second delay is 2 s
  await assert.rejects(connection.read(1, 'holding', 0, 1), /ECONNREFUSED/);
  assert.equal(attempts, 2);
  connection.close();
});

test('the pool shares one connection per gateway', () => {
  const pool = new ConnectionPool();
  const a = pool.get({ host: '192.0.2.10', port: 502 });
  const b = pool.get({ host: '192.0.2.10', port: 502, waitAfterConnectMs: 1000 });
  const c = pool.get({ host: '192.0.2.10', port: 502, framing: 'rtu_over_tcp' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.waitAfterConnectMs, 1000);
  pool.closeAll();
});

test('contiguous points are read together, within the size limit', () => {
  const blocks = planReads(
    [
      { id: 'v1', table: 'input', address: 0, count: 2 },
      { id: 'v2', table: 'input', address: 2, count: 2 },
      { id: 'p', table: 'input', address: 12, count: 2 },
      { id: 'h', table: 'holding', address: 2, count: 1 },
      { id: 'h2', table: 'holding', address: 2, count: 1 },
    ],
    { maxRegisters: 64 },
  );
  assert.deepEqual(
    blocks.map(({ table, address, count, points }) => [table, address, count, points.length]),
    [
      ['holding', 2, 1, 2],
      ['input', 0, 4, 2],
      ['input', 12, 2, 1],
    ],
  );
  const capped = planReads(
    Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`,
      table: 'input',
      address: i * 2,
      count: 2,
    })),
    { maxRegisters: 64 },
  );
  assert.deepEqual(
    capped.map((block) => block.count),
    [64, 16],
  );
});

test('a grouped read refused for a hole is split, once and for all', async () => {
  // Registers 0-1 and 3-4 exist, 2 does not: the grouped read 0-4 fails.
  const unit = createUnit().uint32('holding', 0, 7).uint32('holding', 3, 9);
  const server = await createFakeModbusServer({ units: { 1: unit } });
  const connection = new ModbusConnection({ host: server.host, port: server.port });
  const reader = new BlockReader();
  const points = [
    { id: 'a', table: 'holding', address: 0, count: 2 },
    { id: 'b', table: 'holding', address: 3, count: 2 },
    { id: 'missing', table: 'holding', address: 10, count: 1 },
  ];
  try {
    const first = await reader.readPoints(connection, 1, points, { maxGap: 1 });
    assert.equal(decodeWords(first.get('a'), 'uint32'), 7);
    assert.equal(decodeWords(first.get('b'), 'uint32'), 9);
    assert.ok(first.get('missing') instanceof ModbusException);
    assert.equal(server.requests.length, 4); // the group, then a and b, then missing
    server.requests.length = 0;
    await reader.readPoints(connection, 1, points, { maxGap: 1 });
    assert.equal(server.requests.length, 3, 'the split is remembered');
  } finally {
    connection.close();
    await server.close();
  }
});

test('interoperability: the client reads a jsmodbus Modbus TCP server', async () => {
  const modbus = require('jsmodbus');
  const holding = Buffer.alloc(200);
  holding.writeFloatBE(49.98, 20); // register 10
  holding.writeInt16BE(-25, 40); // register 20
  const netServer = new net.Server();
  new modbus.server.TCP(netServer, { holding });
  await new Promise((resolve) => netServer.listen(0, '127.0.0.1', resolve));
  const connection = new ModbusConnection({ host: '127.0.0.1', port: netServer.address().port });
  try {
    assert.equal(
      decodeWords(await connection.read(1, 'holding', 10, 2), 'float32').toFixed(2),
      '49.98',
    );
    assert.equal(decodeWords(await connection.read(1, 'holding', 20, 1), 'int16'), -25);
    await connection.writeRegisters(1, 30, [1234]);
    assert.equal(holding.readUInt16BE(60), 1234);
  } finally {
    connection.close();
    await new Promise((resolve) => netServer.close(resolve));
  }
});
