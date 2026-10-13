// -----------------------------------------------------------------------------
// The container's own polling timer.
//
// The devices are published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll: Gladys
// 5.2.0 skips devices created without `should_poll`, and a device keeps the
// polling fields it was created with, even once the core is fixed
// (GladysAssistant/Gladys#3198). So the container reads the devices by itself,
// at the configured pace (5 s to 5 min), and the core's onPoll stays as a
// fallback.
//
// No double work: the timer skips a device read less than half a period ago,
// and the core's onPoll skips one read less than 90 % of a period ago — while
// the timer runs, the core's poll (once a minute) never reaches the device.
//
// Only the devices the user added to Gladys are read (`gladys.devices`): the
// core drops the states of a device it does not know.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'modbus-poller' });

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {import('./hub.js').ModbusHub} options.hub
 * @param {boolean} [options.timers] run the periodic timer (tests may turn it off)
 * @param {() => void} [options.onDeviceRead] called after a device just added was read
 * @param {() => number} [options.now]
 */
export function createPoller({ gladys, hub, timers = true, onDeviceRead, now = () => Date.now() }) {
  /** When each device was last read (start of the read), by slot. */
  const lastPolledAt = new Map();
  /** Reads in progress, by slot: a second caller waits for the same one. */
  const inFlight = new Map();
  let timer = null;
  let stopped = false;

  const periodMs = () => hub.effectiveIntervalMs();

  async function pollRuntime(runtime, { force = false, minGap = 0.5 } = {}) {
    const key = runtime.slot.index;
    const running = inFlight.get(key);
    if (running) {
      await running;
      if (!force) {
        return;
      }
    }
    const last = lastPolledAt.get(key);
    if (!force && last !== undefined && now() - last < periodMs() * minGap) {
      logger.debug(`Device ${key}: read ${now() - last} ms ago, skipped`);
      return;
    }
    lastPolledAt.set(key, now());
    const run = hub.poll(runtime).catch((err) => {
      logger.error(`Device ${key}: read failed (${err.message})`);
    });
    inFlight.set(key, run);
    try {
      await run;
    } finally {
      inFlight.delete(key);
    }
  }

  /** One cycle: every device added to Gladys, in parallel (one queue per gateway). */
  async function cycle({ force = false } = {}) {
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: cycle skipped');
      return;
    }
    await Promise.all(hub.createdRuntimes().map((runtime) => pollRuntime(runtime, { force })));
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        await cycle();
      } catch (err) {
        logger.error(`Polling cycle failed (${err.message})`);
      } finally {
        schedule();
      }
    }, periodMs());
  }

  const api = {
    /** Register the core's onPoll (fallback) and the reads of a device just added. */
    register() {
      gladys.onPoll((device) => api.pollFromCore(device));
      gladys.onDeviceCreated((device) => api.pollDevice(device));
      gladys.onDeviceUpdated((device) => api.pollDevice(device));
    },

    /** (Re)start: a new configuration, a (re)connection. Reads every device now. */
    async restart() {
      stopped = false;
      lastPolledAt.clear();
      schedule();
      await cycle({ force: true });
    },

    /** One cycle now, as the timer runs it (tests). */
    cycle,

    /** The core's onPoll: reads the device unless the timer just did. */
    async pollFromCore(device) {
      const runtime = hub.runtimeOf(device.external_id);
      if (!runtime) {
        logger.debug(`onPoll ignored for ${device.external_id}`);
        return;
      }
      await pollRuntime(runtime, { minGap: 0.9 });
    },

    /**
     * A device was just added (or updated) in Gladys: the SDK forgot what it
     * had published for it, every value is sent again now.
     */
    async pollDevice(device) {
      const runtime = hub.runtimeOf(device.external_id);
      if (!runtime) {
        return;
      }
      await pollRuntime(runtime, { force: true });
      onDeviceRead?.(device);
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
  return api;
}
