// -----------------------------------------------------------------------------
// Grouped reads.
//
// A device is read in as few requests as possible: the points (one value
// each: a register, a run of registers, a bit) of the same table that follow
// each other are read in one request, up to `maxRegisters` registers.
//
// Many devices refuse a read that covers an address they do not implement
// (Modbus exception 2, "illegal data address"), even between two that they
// do. So a grouped read that fails that way is split: its points are read one
// by one, now and in the next cycles (the split is remembered), and only the
// points that fail on their own are reported missing.
// -----------------------------------------------------------------------------

import { ModbusException, isBitTable } from './frames.js';
import { isUnreachable } from './connection.js';

/** Exceptions that mean "not here" rather than "the device is down". */
const ADDRESS_EXCEPTIONS = new Set([1, 2, 3, 4]);

/**
 * Group points into reads.
 * @param {Array<{ id, table, address, count }>} points count in registers or bits
 * @param {object} [options]
 * @param {number} [options.maxRegisters] registers per request
 * @param {number} [options.maxBits] bits per request
 * @param {number} [options.maxGap] unused addresses a read may span between two points
 * @returns {Array<{ table, address, count, points }>}
 */
export function planReads(points, { maxRegisters = 64, maxBits = 512, maxGap = 0 } = {}) {
  const sorted = [...points].sort(
    (a, b) => a.table.localeCompare(b.table) || a.address - b.address || b.count - a.count,
  );
  const blocks = [];
  let current = null;
  for (const point of sorted) {
    const max = isBitTable(point.table) ? maxBits : maxRegisters;
    const end = point.address + point.count - 1;
    if (
      current &&
      current.table === point.table &&
      point.address <= current.address + current.count + maxGap &&
      Math.max(end, current.address + current.count - 1) - current.address + 1 <= max
    ) {
      current.count = Math.max(end, current.address + current.count - 1) - current.address + 1;
      current.points.push(point);
      continue;
    }
    current = { table: point.table, address: point.address, count: point.count, points: [point] };
    blocks.push(current);
  }
  return blocks;
}

export class BlockReader {
  constructor() {
    /** Blocks known to fail as a whole, by unit, table, address and length. */
    this.splitBlocks = new Set();
  }

  /** Forget the splits (new configuration, device replaced). */
  reset() {
    this.splitBlocks.clear();
  }

  /**
   * Read every point.
   * @param {import('./connection.js').ModbusConnection} connection
   * @param {number} unitId
   * @param {Array<{ id, table, address, count }>} points
   * @param {object} [options] planReads options
   * @returns {Promise<Map<string, number[] | Error>>} the words (or bits) of each point, or why it failed
   * @throws when the device does not answer at all
   */
  async readPoints(connection, unitId, points, options) {
    const results = new Map();
    for (const block of planReads(points, options)) {
      const key = `${unitId}:${block.table}:${block.address}:${block.count}`;
      if (block.points.length > 1 && this.splitBlocks.has(key)) {
        await this.readOneByOne(connection, unitId, block.points, results);
        continue;
      }
      try {
        const words = await connection.read(unitId, block.table, block.address, block.count);
        for (const point of block.points) {
          const start = point.address - block.address;
          results.set(point.id, words.slice(start, start + point.count));
        }
      } catch (err) {
        if (isUnreachable(err) || !isAddressError(err)) {
          throw err;
        }
        if (block.points.length > 1) {
          this.splitBlocks.add(key);
          await this.readOneByOne(connection, unitId, block.points, results);
        } else {
          results.set(block.points[0].id, err);
        }
      }
    }
    return results;
  }

  async readOneByOne(connection, unitId, points, results) {
    for (const point of points) {
      try {
        results.set(
          point.id,
          await connection.read(unitId, point.table, point.address, point.count),
        );
      } catch (err) {
        if (isUnreachable(err) || !isAddressError(err)) {
          throw err;
        }
        results.set(point.id, err);
      }
    }
  }
}

function isAddressError(err) {
  return err instanceof ModbusException && ADDRESS_EXCEPTIONS.has(err.code);
}
