// -----------------------------------------------------------------------------
// Modbus frames: the PDU (function code + data), wrapped either in the Modbus
// TCP header (MBAP) or in RTU framing (unit id + PDU + CRC-16), the latter for
// the RS-485 gateways run in "transparent" mode, which forward the bytes of
// the TCP stream to the bus untouched ("RTU over TCP").
//
// Reference: Modbus Application Protocol Specification V1.1b3 and Modbus
// Messaging on TCP/IP Implementation Guide V1.0b (modbus.org).
// -----------------------------------------------------------------------------

export const FUNCTION = {
  READ_COILS: 1,
  READ_DISCRETE_INPUTS: 2,
  READ_HOLDING_REGISTERS: 3,
  READ_INPUT_REGISTERS: 4,
  WRITE_SINGLE_COIL: 5,
  WRITE_SINGLE_REGISTER: 6,
  WRITE_MULTIPLE_REGISTERS: 16,
};

/** The four Modbus tables, and the function code that reads each. */
export const TABLES = {
  holding: FUNCTION.READ_HOLDING_REGISTERS,
  input: FUNCTION.READ_INPUT_REGISTERS,
  coil: FUNCTION.READ_COILS,
  discrete: FUNCTION.READ_DISCRETE_INPUTS,
};

/** Bit tables answer bits, the others 16-bit registers. */
export const isBitTable = (table) => table === 'coil' || table === 'discrete';

/** Largest read the specification allows, per table kind. */
export const MAX_READ = { registers: 125, bits: 2000 };

export const EXCEPTION_NAMES = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'server device failure',
  5: 'acknowledge',
  6: 'server device busy',
  8: 'memory parity error',
  10: 'gateway path unavailable',
  11: 'gateway target device failed to respond',
};

/** The device answered with a Modbus exception: it is reachable, the request is not. */
export class ModbusException extends Error {
  constructor(functionCode, code) {
    super(`Modbus exception ${code} (${EXCEPTION_NAMES[code] ?? 'unknown'})`);
    this.name = 'ModbusException';
    this.functionCode = functionCode;
    this.code = code;
  }
}

/**
 * Build a read request PDU.
 * @param {string} table holding | input | coil | discrete
 * @param {number} address 0..65535
 * @param {number} count
 */
export function readRequest(table, address, count) {
  const functionCode = TABLES[table];
  if (functionCode === undefined) {
    throw new Error(`Unknown table ${table}`);
  }
  const max = isBitTable(table) ? MAX_READ.bits : MAX_READ.registers;
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new RangeError(`Cannot read ${count} items at once (1 to ${max})`);
  }
  checkAddress(address, count);
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(functionCode, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(count, 3);
  return pdu;
}

/** Write one coil (FC 5). */
export function writeCoilRequest(address, on) {
  checkAddress(address, 1);
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FUNCTION.WRITE_SINGLE_COIL, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(on ? 0xff00 : 0x0000, 3);
  return pdu;
}

/** Write one holding register (FC 6). */
export function writeRegisterRequest(address, word) {
  checkAddress(address, 1);
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FUNCTION.WRITE_SINGLE_REGISTER, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(word & 0xffff, 3);
  return pdu;
}

/** Write consecutive holding registers (FC 16). */
export function writeRegistersRequest(address, words) {
  checkAddress(address, words.length);
  const pdu = Buffer.alloc(6 + words.length * 2);
  pdu.writeUInt8(FUNCTION.WRITE_MULTIPLE_REGISTERS, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(words.length, 3);
  pdu.writeUInt8(words.length * 2, 5);
  words.forEach((word, index) => pdu.writeUInt16BE(word & 0xffff, 6 + index * 2));
  return pdu;
}

function checkAddress(address, count) {
  if (!Number.isInteger(address) || address < 0 || address + count - 1 > 0xffff) {
    throw new RangeError(`Address ${address} is out of range (0 to 65535)`);
  }
}

/**
 * Check a response PDU against its request and extract the values.
 * @param {Buffer} request the request PDU
 * @param {Buffer} response the response PDU
 * @returns {number[]} registers (0..65535) or bits (0/1) read; [] for a write
 * @throws {ModbusException} on an exception response
 */
export function parseResponse(request, response) {
  const functionCode = request[0];
  if (response.length < 2) {
    throw new Error('Truncated Modbus response');
  }
  if (response[0] === (functionCode | 0x80)) {
    throw new ModbusException(functionCode, response[1]);
  }
  if (response[0] !== functionCode) {
    throw new Error(`Unexpected function code ${response[0]} (expected ${functionCode})`);
  }
  const count = request.readUInt16BE(3);
  switch (functionCode) {
    case FUNCTION.READ_HOLDING_REGISTERS:
    case FUNCTION.READ_INPUT_REGISTERS: {
      const byteCount = response[1];
      if (byteCount !== count * 2 || response.length < 2 + byteCount) {
        throw new Error(`Expected ${count} register(s), got ${byteCount} byte(s)`);
      }
      const words = [];
      for (let i = 0; i < count; i += 1) {
        words.push(response.readUInt16BE(2 + i * 2));
      }
      return words;
    }
    case FUNCTION.READ_COILS:
    case FUNCTION.READ_DISCRETE_INPUTS: {
      const byteCount = response[1];
      if (byteCount !== Math.ceil(count / 8) || response.length < 2 + byteCount) {
        throw new Error(`Expected ${count} bit(s), got ${byteCount} byte(s)`);
      }
      const bits = [];
      for (let i = 0; i < count; i += 1) {
        bits.push((response[2 + (i >> 3)] >> (i & 7)) & 1);
      }
      return bits;
    }
    default:
      // A write answers an echo of its address (and value or quantity).
      if (response.length < 5 || response.readUInt16BE(1) !== request.readUInt16BE(1)) {
        throw new Error('The device did not confirm the write');
      }
      return [];
  }
}

// --- Modbus TCP (MBAP header) --------------------------------------------------

export const MBAP_LENGTH = 7;

/** Wrap a PDU in the MBAP header. */
export function encodeTcp(transactionId, unitId, pdu) {
  const frame = Buffer.alloc(MBAP_LENGTH + pdu.length);
  frame.writeUInt16BE(transactionId & 0xffff, 0);
  frame.writeUInt16BE(0, 2); // protocol identifier: Modbus
  frame.writeUInt16BE(pdu.length + 1, 4);
  frame.writeUInt8(unitId, 6);
  pdu.copy(frame, MBAP_LENGTH);
  return frame;
}

/**
 * Take the first complete MBAP frame out of a receive buffer.
 * @param {Buffer} buffer
 * @returns {{ frame?: { transactionId, unitId, pdu }, rest: Buffer }}
 */
export function decodeTcp(buffer) {
  if (buffer.length < MBAP_LENGTH) {
    return { rest: buffer };
  }
  const length = buffer.readUInt16BE(4);
  if (length < 2 || length > 254) {
    // Not Modbus TCP (a gateway in RTU mode, garbage): drop it all.
    throw new Error(`Invalid Modbus TCP length ${length}`);
  }
  const total = 6 + length;
  if (buffer.length < total) {
    return { rest: buffer };
  }
  return {
    frame: {
      transactionId: buffer.readUInt16BE(0),
      unitId: buffer[6],
      pdu: buffer.subarray(MBAP_LENGTH, total),
    },
    rest: buffer.subarray(total),
  };
}

// --- RTU framing ---------------------------------------------------------------

/** CRC-16/MODBUS (polynomial 0xA001 reflected, initial value 0xFFFF). */
export function crc16(buffer) {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc;
}

/** Unit id + PDU + CRC (low byte first). */
export function encodeRtu(unitId, pdu) {
  const body = Buffer.concat([Buffer.from([unitId]), pdu]);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(crc16(body), 0);
  return Buffer.concat([body, crc]);
}

/**
 * Length of the RTU response to a request, once its first bytes arrived —
 * RTU has no length field: it follows from the function code.
 * @returns {number|undefined} undefined while too few bytes are there
 */
export function expectedRtuLength(buffer) {
  if (buffer.length < 2) {
    return undefined;
  }
  const functionCode = buffer[1];
  if (functionCode & 0x80) {
    return 5; // unit, function, exception code, CRC
  }
  if (functionCode <= FUNCTION.READ_INPUT_REGISTERS) {
    return buffer.length < 3 ? undefined : 3 + buffer[2] + 2;
  }
  return 8; // writes echo address + value/quantity
}

/**
 * Take the first complete RTU frame out of a receive buffer.
 * @returns {{ frame?: { unitId, pdu }, rest: Buffer }}
 * @throws on a CRC error
 */
export function decodeRtu(buffer) {
  const length = expectedRtuLength(buffer);
  if (length === undefined || buffer.length < length) {
    return { rest: buffer };
  }
  const body = buffer.subarray(0, length - 2);
  if (crc16(body) !== buffer.readUInt16LE(length - 2)) {
    throw new Error('CRC error in the RTU response');
  }
  return {
    frame: { unitId: buffer[0], pdu: body.subarray(1) },
    rest: buffer.subarray(length),
  };
}
