// -----------------------------------------------------------------------------
// One TCP connection to a Modbus gateway or device, shared by every device
// behind it (several unit ids on one RS-485 gateway, a Victron GX...).
//
// - Requests run one at a time: RS-485 is a half-duplex bus, and many devices
//   (Huawei inverters, cheap gateways) mishandle concurrent requests.
// - The connection opens on the first request and stays open; a request that
//   finds it closed (the device dropped an idle connection) reopens it, and
//   one that fails because a reused connection was reset is retried once on a
//   fresh one.
// - A refused connection is not retried at every request: the next attempts
//   wait 1 s, 2 s, 4 s... up to a minute, and the requests in between fail at
//   once with the last error, so a device that is off costs nothing.
// - A request that gets no answer fails after `timeoutMs`; with RTU framing,
//   which has no transaction id, the next request waits a quarter of a second
//   and drops what arrived meanwhile, so that a late answer is not taken for
//   its own.
// -----------------------------------------------------------------------------

import net from 'node:net';
import {
  ModbusException,
  decodeRtu,
  decodeTcp,
  encodeRtu,
  encodeTcp,
  isBitTable,
  parseResponse,
  readRequest,
  writeCoilRequest,
  writeRegisterRequest,
  writeRegistersRequest,
} from './frames.js';

export const FRAMINGS = ['tcp', 'rtu_over_tcp'];

const MAX_BACKOFF_MS = 60_000;
const RTU_QUIET_MS = 250;
const BUSY_RETRY_MS = 500;

/** The connection failed or timed out: the device is not reachable. */
export class ModbusConnectionError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'ModbusConnectionError';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ModbusConnection {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} [options.framing] tcp | rtu_over_tcp
   * @param {number} [options.timeoutMs] per request, and to connect
   * @param {number} [options.waitAfterConnectMs] some devices (Huawei) need a pause before the first request
   * @param {Function} [options.createSocket] test seam, net.createConnection by default
   * @param {() => number} [options.now]
   */
  constructor({
    host,
    port,
    framing = 'tcp',
    timeoutMs = 3000,
    waitAfterConnectMs = 0,
    createSocket = (options) => net.createConnection(options),
    now = () => Date.now(),
  }) {
    if (!FRAMINGS.includes(framing)) {
      throw new Error(`Unknown framing ${framing}`);
    }
    this.host = host;
    this.port = port;
    this.framing = framing;
    this.timeoutMs = timeoutMs;
    this.waitAfterConnectMs = waitAfterConnectMs;
    this.createSocket = createSocket;
    this.now = now;

    this.socket = null;
    this.connecting = null;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.transactionId = 0;
    this.queue = Promise.resolve();
    this.closed = false;
    this.connectFailures = 0;
    this.retryAt = 0;
    this.lastConnectError = null;
    this.dropUntil = 0;
  }

  get label() {
    return `${this.host}:${this.port}`;
  }

  /** Whether a socket is open right now. */
  get isOpen() {
    return this.socket !== null;
  }

  /**
   * Read registers or bits.
   * @param {number} unitId
   * @param {string} table holding | input | coil | discrete
   * @param {number} address
   * @param {number} count
   * @returns {Promise<number[]>} registers (0..65535) or bits (0/1)
   */
  read(unitId, table, address, count) {
    return this.request(unitId, readRequest(table, address, count));
  }

  writeCoil(unitId, address, on) {
    return this.request(unitId, writeCoilRequest(address, on));
  }

  /** Writes one register with FC 6, several with FC 16. */
  writeRegisters(unitId, address, words) {
    return this.request(
      unitId,
      words.length === 1
        ? writeRegisterRequest(address, words[0])
        : writeRegistersRequest(address, words),
    );
  }

  /**
   * Queue a request: it runs once the previous ones are done.
   * @param {number} unitId
   * @param {Buffer} pdu
   */
  request(unitId, pdu) {
    const run = this.queue.then(() => this.exchange(unitId, pdu));
    this.queue = run.catch(() => {});
    return run;
  }

  async exchange(unitId, pdu, { retried = false } = {}) {
    if (this.closed) {
      throw new ModbusConnectionError(`Connection to ${this.label} closed`);
    }
    const reused = this.socket !== null;
    const socket = await this.open();
    if (this.framing === 'rtu_over_tcp' && this.now() < this.dropUntil) {
      // A late answer to the request that timed out may still be on its way:
      // let it arrive, it is dropped before sending.
      await sleep(this.dropUntil - this.now());
    }
    try {
      const response = await this.send(socket, unitId, pdu);
      return parseResponse(pdu, response);
    } catch (err) {
      if (err instanceof ModbusException && (err.code === 5 || err.code === 6) && !retried) {
        // Acknowledge / busy: the device asks to come back a bit later.
        await sleep(BUSY_RETRY_MS);
        return this.exchange(unitId, pdu, { retried: true });
      }
      if (err.reset && reused && !retried) {
        // The device dropped the idle connection: once more on a fresh one.
        return this.exchange(unitId, pdu, { retried: true });
      }
      throw err;
    }
  }

  /** The open socket, connecting first when needed. */
  async open() {
    if (this.socket) {
      return this.socket;
    }
    if (this.connecting) {
      return this.connecting;
    }
    if (this.now() < this.retryAt && this.lastConnectError) {
      throw this.lastConnectError;
    }
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        fail(new Error(`no answer within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      const fail = (err) => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.on('error', () => {});
        socket.destroy();
        this.connectFailures += 1;
        this.retryAt =
          this.now() + Math.min(1000 * 2 ** (this.connectFailures - 1), MAX_BACKOFF_MS);
        this.lastConnectError = new ModbusConnectionError(
          `Cannot connect to ${this.label}: ${describe(err)}`,
          { cause: err },
        );
        reject(this.lastConnectError);
      };
      socket.once('error', fail);
      socket.once('connect', async () => {
        clearTimeout(timer);
        socket.removeListener('error', fail);
        socket.setNoDelay?.(true);
        socket.setKeepAlive?.(true, 30_000);
        this.connectFailures = 0;
        this.retryAt = 0;
        this.lastConnectError = null;
        this.buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (err) => this.onClose(err));
        socket.on('close', () => this.onClose());
        this.socket = socket;
        if (this.waitAfterConnectMs > 0) {
          await sleep(this.waitAfterConnectMs);
        }
        if (this.socket !== socket) {
          reject(new ModbusConnectionError(`Connection to ${this.label} closed`));
          return;
        }
        resolve(socket);
      });
    });
  }

  /** Send one frame and wait for its answer (the response PDU). */
  send(socket, unitId, pdu) {
    return new Promise((resolve, reject) => {
      this.transactionId = (this.transactionId + 1) & 0xffff;
      const transactionId = this.transactionId;
      const timer = setTimeout(() => {
        this.pending = null;
        if (this.framing === 'rtu_over_tcp') {
          this.buffer = Buffer.alloc(0);
          this.dropUntil = this.now() + RTU_QUIET_MS;
        }
        reject(
          new ModbusConnectionError(
            `No answer from ${this.label} (unit ${unitId}) within ${this.timeoutMs} ms`,
          ),
        );
      }, this.timeoutMs);
      this.pending = {
        unitId,
        functionCode: pdu[0],
        transactionId,
        resolve: (response) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(response);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        },
      };
      if (this.framing === 'rtu_over_tcp') {
        // Whatever is left in the buffer belongs to a request that timed out.
        this.buffer = Buffer.alloc(0);
      }
      socket.write(
        this.framing === 'tcp' ? encodeTcp(transactionId, unitId, pdu) : encodeRtu(unitId, pdu),
      );
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (;;) {
        const { frame, rest } =
          this.framing === 'tcp' ? decodeTcp(this.buffer) : decodeRtu(this.buffer);
        this.buffer = rest;
        if (!frame) {
          return;
        }
        this.deliver(frame);
      }
    } catch (err) {
      // Garbage or CRC error: resynchronize on the next answer.
      this.buffer = Buffer.alloc(0);
      this.pending?.reject(new ModbusConnectionError(`${this.label}: ${err.message}`));
    }
  }

  deliver(frame) {
    const pending = this.pending;
    if (!pending) {
      return; // a late answer to a request that timed out
    }
    if (this.framing === 'tcp' && frame.transactionId !== pending.transactionId) {
      return;
    }
    const functionCode = frame.pdu[0] & 0x7f;
    if (frame.unitId !== pending.unitId && this.framing === 'rtu_over_tcp') {
      return;
    }
    if (functionCode !== pending.functionCode) {
      return;
    }
    pending.resolve(frame.pdu);
  }

  onClose(err) {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.on('error', () => {});
      this.socket.destroy();
    }
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    if (this.pending) {
      const error = new ModbusConnectionError(
        `Connection to ${this.label} lost${err ? `: ${describe(err)}` : ''}`,
        { cause: err },
      );
      error.reset = true;
      this.pending.reject(error);
    }
  }

  /** Close for good: pending and future requests fail. */
  close() {
    this.closed = true;
    this.onClose();
  }
}

/** A short, secret-free description of a socket error. */
function describe(err) {
  return err?.code ?? err?.message ?? String(err);
}

/** Whether an error means "nothing answers there" rather than "bad request". */
export function isUnreachable(err) {
  if (err instanceof ModbusConnectionError) {
    return true;
  }
  // 10/11: the gateway answered, but not the device behind it.
  return err instanceof ModbusException && (err.code === 10 || err.code === 11);
}

/**
 * The connections, one per gateway (host, port and framing). Devices sharing
 * a gateway share its connection, and so its queue.
 */
export class ConnectionPool {
  constructor({ createSocket, now } = {}) {
    this.createSocket = createSocket;
    this.now = now;
    this.connections = new Map();
  }

  /**
   * @param {object} target { host, port, framing, timeoutMs, waitAfterConnectMs }
   * @returns {ModbusConnection}
   */
  get({ host, port, framing = 'tcp', timeoutMs, waitAfterConnectMs = 0 }) {
    const key = `${host}:${port}:${framing}`;
    let connection = this.connections.get(key);
    if (!connection) {
      connection = new ModbusConnection({
        host,
        port,
        framing,
        timeoutMs,
        waitAfterConnectMs,
        ...(this.createSocket ? { createSocket: this.createSocket } : {}),
        ...(this.now ? { now: this.now } : {}),
      });
      this.connections.set(key, connection);
    }
    // The strictest needs of the devices sharing it win.
    connection.waitAfterConnectMs = Math.max(connection.waitAfterConnectMs, waitAfterConnectMs);
    if (timeoutMs !== undefined) {
      connection.timeoutMs = timeoutMs;
    }
    return connection;
  }

  closeAll() {
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
  }
}

export { isBitTable };
