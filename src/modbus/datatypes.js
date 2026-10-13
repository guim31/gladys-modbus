// -----------------------------------------------------------------------------
// Register words <-> values.
//
// A Modbus register is a 16-bit word sent big-endian on the wire. Wider values
// span several registers, and the protocol says nothing about their order:
// every manufacturer picks one. The four orders are named as Home Assistant's
// `modbus` integration names them (its `swap` option), so a register table
// written for Home Assistant reads the same here:
//
//   none       ABCD  most significant register first, bytes as sent (default)
//   byte       BADC  bytes swapped inside each register
//   word       CDAB  registers in reverse order ("little-endian words")
//   word_byte  DCBA  both
// -----------------------------------------------------------------------------

/** Data types and the number of registers each one spans. */
export const DATA_TYPES = {
  int16: 1,
  uint16: 1,
  int32: 2,
  uint32: 2,
  float32: 2,
  int64: 4,
  uint64: 4,
  float64: 4,
};

export const SWAPS = ['none', 'byte', 'word', 'word_byte'];

/** Types a write can produce (64-bit values are read-only here). */
export const WRITABLE_TYPES = ['int16', 'uint16', 'int32', 'uint32', 'float32'];

/**
 * Lay the registers out as the big-endian bytes of the value.
 * @param {number[]} words registers as read, 0..65535 each
 * @param {string} swap one of SWAPS
 * @returns {Buffer}
 */
export function wordsToBuffer(words, swap = 'none') {
  const ordered = swap === 'word' || swap === 'word_byte' ? [...words].reverse() : words;
  const buffer = Buffer.alloc(ordered.length * 2);
  ordered.forEach((word, index) => {
    if (swap === 'byte' || swap === 'word_byte') {
      buffer.writeUInt16LE(word & 0xffff, index * 2);
    } else {
      buffer.writeUInt16BE(word & 0xffff, index * 2);
    }
  });
  return buffer;
}

/**
 * The inverse of wordsToBuffer: the registers to write for these bytes.
 * @param {Buffer} buffer big-endian bytes of the value
 * @param {string} swap
 * @returns {number[]}
 */
export function bufferToWords(buffer, swap = 'none') {
  const words = [];
  for (let offset = 0; offset < buffer.length; offset += 2) {
    words.push(
      swap === 'byte' || swap === 'word_byte'
        ? buffer.readUInt16LE(offset)
        : buffer.readUInt16BE(offset),
    );
  }
  return swap === 'word' || swap === 'word_byte' ? words.reverse() : words;
}

/**
 * Decode registers into a number.
 * @param {number[]} words exactly DATA_TYPES[type] registers
 * @param {string} type one of DATA_TYPES
 * @param {string} [swap]
 * @returns {number} NaN stays NaN (an unset float register)
 */
export function decodeWords(words, type, swap = 'none') {
  const size = DATA_TYPES[type];
  if (size === undefined) {
    throw new Error(`Unknown data type ${type}`);
  }
  if (words.length !== size) {
    throw new Error(`${type} spans ${size} register(s), got ${words.length}`);
  }
  const buffer = wordsToBuffer(words, swap);
  switch (type) {
    case 'int16':
      return buffer.readInt16BE(0);
    case 'uint16':
      return buffer.readUInt16BE(0);
    case 'int32':
      return buffer.readInt32BE(0);
    case 'uint32':
      return buffer.readUInt32BE(0);
    case 'float32':
      return buffer.readFloatBE(0);
    case 'int64':
      return Number(buffer.readBigInt64BE(0));
    case 'uint64':
      return Number(buffer.readBigUInt64BE(0));
    default:
      return buffer.readDoubleBE(0);
  }
}

/**
 * Encode a number into the registers to write.
 * @param {number} value already scaled back to the raw unit
 * @param {string} type one of WRITABLE_TYPES
 * @param {string} [swap]
 * @returns {number[]}
 * @throws when the value does not fit the type
 */
export function encodeValue(value, type, swap = 'none') {
  if (!WRITABLE_TYPES.includes(type)) {
    throw new Error(`Writing ${type} is not supported`);
  }
  const buffer = Buffer.alloc(DATA_TYPES[type] * 2);
  if (type === 'float32') {
    buffer.writeFloatBE(value, 0);
    return bufferToWords(buffer, swap);
  }
  const integer = Math.round(value);
  const [min, max] = INTEGER_RANGES[type];
  if (!Number.isFinite(integer) || integer < min || integer > max) {
    throw new RangeError(`${value} does not fit in ${type} (${min} to ${max})`);
  }
  if (type === 'int16') buffer.writeInt16BE(integer, 0);
  else if (type === 'uint16') buffer.writeUInt16BE(integer, 0);
  else if (type === 'int32') buffer.writeInt32BE(integer, 0);
  else buffer.writeUInt32BE(integer, 0);
  return bufferToWords(buffer, swap);
}

const INTEGER_RANGES = {
  int16: [-32768, 32767],
  uint16: [0, 65535],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
};

/**
 * One bit of a register (0 = least significant).
 * @param {number} word
 * @param {number} bit 0..15
 */
export function bitOf(word, bit) {
  return (word >> bit) & 1;
}

/**
 * Decode a string spread over registers (two ASCII characters per register,
 * first character in the high byte), as SunSpec and Huawei store them.
 * Trailing NULs and spaces are dropped.
 * @param {number[]} words
 */
export function decodeString(words) {
  const buffer = wordsToBuffer(words, 'none');
  const end = buffer.indexOf(0);
  return buffer
    .subarray(0, end === -1 ? buffer.length : end)
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
}

/** "0x00E1" — how the raw registers are shown to the user. */
export function hexWord(word) {
  return `0x${word.toString(16).toUpperCase().padStart(4, '0')}`;
}
