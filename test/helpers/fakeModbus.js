// -----------------------------------------------------------------------------
// A fake Modbus server on 127.0.0.1, speaking Modbus TCP or RTU over TCP (the
// transparent mode of RS-485 gateways), with one register map per unit id.
//
// Written independently of src/modbus/frames.js (its own framing, CRC and
// exceptions), so that a mistake in the client is not mirrored here. Like a
// real device, an address missing from the map answers exception 2 (illegal
// data address), even inside a grouped read: the tests can check that the
// client splits such reads.
// -----------------------------------------------------------------------------

import net from 'node:net';

const TABLE_BY_FUNCTION = { 1: 'coil', 2: 'discrete', 3: 'holding', 4: 'input' };

/** A register map: table -> Map(address -> word or bit). */
export function createUnit() {
  const unit = {
    holding: new Map(),
    input: new Map(),
    coil: new Map(),
    discrete: new Map(),
    /** Set registers from raw words. */
    words(table, address, words) {
      words.forEach((word, index) => unit[table].set(address + index, word & 0xffff));
      return unit;
    },
    int16(table, address, value) {
      return unit.words(table, address, [value & 0xffff]);
    },
    uint16(table, address, value) {
      return unit.words(table, address, [value]);
    },
    int32(table, address, value, swap = 'none') {
      const buffer = Buffer.alloc(4);
      buffer.writeInt32BE(value, 0);
      return unit.words(table, address, toWords(buffer, swap));
    },
    uint32(table, address, value, swap = 'none') {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(value, 0);
      return unit.words(table, address, toWords(buffer, swap));
    },
    float32(table, address, value, swap = 'none') {
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(value, 0);
      return unit.words(table, address, toWords(buffer, swap));
    },
    uint64(table, address, value) {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64BE(BigInt(value), 0);
      return unit.words(table, address, toWords(buffer, 'none'));
    },
    /** Two characters per register, NUL-padded to `size` registers. */
    string(table, address, text, size) {
      const buffer = Buffer.alloc(size * 2);
      buffer.write(text, 'latin1');
      return unit.words(table, address, toWords(buffer, 'none'));
    },
    /** Declare registers that exist with the value 0. */
    zeros(table, address, count) {
      return unit.words(table, address, new Array(count).fill(0));
    },
    bit(table, address, value) {
      unit[table].set(address, value ? 1 : 0);
      return unit;
    },
  };
  return unit;
}

function toWords(buffer, swap) {
  const words = [];
  for (let i = 0; i < buffer.length; i += 2) {
    words.push(
      swap === 'byte' || swap === 'word_byte' ? buffer.readUInt16LE(i) : buffer.readUInt16BE(i),
    );
  }
  return swap === 'word' || swap === 'word_byte' ? words.reverse() : words;
}

function crc16(buffer) {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc;
}

/**
 * @param {object} options
 * @param {Record<number, ReturnType<typeof createUnit>>} options.units by unit id
 * @param {'tcp'|'rtu_over_tcp'} [options.framing]
 * @param {number} [options.maxRegisters] larger reads answer exception 3
 * @param {Set<number>} [options.silentUnits] unit ids that never answer
 */
export async function createFakeModbusServer({
  units,
  framing = 'tcp',
  maxRegisters = 125,
  silentUnits = new Set(),
} = {}) {
  const requests = [];
  const writes = [];
  const sockets = new Set();
  const behaviour = {
    /** Answer `exception` once to the next request. */
    nextException: null,
    /** Close the connection when the next request arrives. */
    dropNext: false,
    /** Delay every answer (ms). */
    latencyMs: 0,
    /** Answer nothing at all. */
    mute: false,
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const parsed = framing === 'tcp' ? takeTcp(buffer) : takeRtu(buffer);
        if (!parsed) {
          return;
        }
        buffer = parsed.rest;
        handle(socket, parsed);
      }
    });
  });

  function handle(socket, { transactionId, unitId, pdu }) {
    const functionCode = pdu[0];
    const address = pdu.readUInt16BE(1);
    const quantity = pdu.readUInt16BE(3);
    requests.push({ unitId, functionCode, address, count: quantity });
    if (behaviour.dropNext) {
      behaviour.dropNext = false;
      socket.destroy();
      return;
    }
    if (behaviour.mute || silentUnits.has(unitId)) {
      return;
    }
    const answer = (body) => {
      const frame =
        framing === 'tcp'
          ? Buffer.concat([mbap(transactionId, unitId, body.length), body])
          : rtu(unitId, body);
      setTimeout(() => socket.writable && socket.write(frame), behaviour.latencyMs);
    };
    const exception = (code) => answer(Buffer.from([functionCode | 0x80, code]));
    if (behaviour.nextException) {
      const code = behaviour.nextException;
      behaviour.nextException = null;
      exception(code);
      return;
    }
    const unit = units[unitId];
    if (!unit) {
      exception(11); // gateway: target device failed to respond
      return;
    }
    const table = TABLE_BY_FUNCTION[functionCode];
    if (table) {
      if (
        quantity < 1 ||
        quantity > (table === 'coil' || table === 'discrete' ? 2000 : maxRegisters)
      ) {
        exception(3);
        return;
      }
      const values = [];
      for (let i = 0; i < quantity; i += 1) {
        if (!unit[table].has(address + i)) {
          exception(2);
          return;
        }
        values.push(unit[table].get(address + i));
      }
      if (table === 'coil' || table === 'discrete') {
        const bytes = Buffer.alloc(Math.ceil(quantity / 8));
        values.forEach((bit, i) => {
          if (bit) bytes[i >> 3] |= 1 << (i & 7);
        });
        answer(Buffer.concat([Buffer.from([functionCode, bytes.length]), bytes]));
      } else {
        const body = Buffer.alloc(2 + quantity * 2);
        body[0] = functionCode;
        body[1] = quantity * 2;
        values.forEach((word, i) => body.writeUInt16BE(word, 2 + i * 2));
        answer(body);
      }
      return;
    }
    if (functionCode === 5) {
      if (!unit.coil.has(address)) {
        exception(2);
        return;
      }
      unit.coil.set(address, quantity === 0xff00 ? 1 : 0);
      writes.push({ unitId, table: 'coil', address, values: [quantity === 0xff00 ? 1 : 0] });
      answer(pdu.subarray(0, 5));
      return;
    }
    if (functionCode === 6) {
      if (!unit.holding.has(address)) {
        exception(2);
        return;
      }
      unit.holding.set(address, quantity);
      writes.push({ unitId, table: 'holding', address, values: [quantity] });
      answer(pdu.subarray(0, 5));
      return;
    }
    if (functionCode === 16) {
      const words = [];
      for (let i = 0; i < quantity; i += 1) {
        if (!unit.holding.has(address + i)) {
          exception(2);
          return;
        }
        words.push(pdu.readUInt16BE(6 + i * 2));
      }
      words.forEach((word, i) => unit.holding.set(address + i, word));
      writes.push({ unitId, table: 'holding', address, values: words });
      answer(pdu.subarray(0, 5));
      return;
    }
    exception(1);
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    host: '127.0.0.1',
    port,
    framing,
    units,
    requests,
    writes,
    behaviour,
    /** Close every client connection (a device rebooting, an idle timeout). */
    dropConnections() {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    get connectionCount() {
      return sockets.size;
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function mbap(transactionId, unitId, pduLength) {
  const header = Buffer.alloc(7);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(pduLength + 1, 4);
  header[6] = unitId;
  return header;
}

function rtu(unitId, body) {
  const frame = Buffer.concat([Buffer.from([unitId]), body, Buffer.alloc(2)]);
  frame.writeUInt16LE(crc16(frame.subarray(0, frame.length - 2)), frame.length - 2);
  return frame;
}

function takeTcp(buffer) {
  if (buffer.length < 7) return null;
  const total = 6 + buffer.readUInt16BE(4);
  if (buffer.length < total) return null;
  return {
    transactionId: buffer.readUInt16BE(0),
    unitId: buffer[6],
    pdu: buffer.subarray(7, total),
    rest: buffer.subarray(total),
  };
}

function takeRtu(buffer) {
  if (buffer.length < 2) return null;
  const functionCode = buffer[1];
  let length = 8; // reads and single writes: unit, fc, 4 bytes, CRC
  if (functionCode === 16) {
    if (buffer.length < 7) return null;
    length = 7 + buffer[6] + 2;
  }
  if (buffer.length < length) return null;
  const frame = buffer.subarray(0, length);
  if (crc16(frame.subarray(0, length - 2)) !== frame.readUInt16LE(length - 2)) {
    throw new Error('fake server: bad CRC in request');
  }
  return { unitId: frame[0], pdu: frame.subarray(1, length - 2), rest: buffer.subarray(length) };
}

/** An address nothing listens on (a server opened then closed). */
export async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
