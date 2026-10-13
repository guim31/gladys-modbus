// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the pieces, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ACTION_KEYS, checkConfig, testRead } from './actions.js';
import { normalizeConfig } from './config.js';
import { ModbusHub } from './hub.js';
import { STATUS } from './messages.js';
import { createPoller } from './poller.js';
import { Store } from './store.js';
import { WIDGET_KEY, overviewContent } from './widgets.js';

const logger = createLogger({ name: 'modbus-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, createSocket, timers, now
 */
export function registerHandlers(gladys, options = {}) {
  const refreshWidget = () => gladys.requestWidgetRefresh(WIDGET_KEY);
  const hub = new ModbusHub({
    gladys,
    store: options.store ?? new Store(),
    createSocket: options.createSocket,
    now: options.now,
    // A device that stops or starts answering changes the widget.
    onReachabilityChange: refreshWidget,
  });
  const poller = createPoller({
    gladys,
    hub,
    timers: options.timers ?? true,
    now: options.now,
    // A device just added: its tiles exist now, the open widgets re-pull.
    onDeviceRead: refreshWidget,
  });

  // Resolved once the first configuration is applied: a command arriving
  // during the first probes waits for it instead of finding no device.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      await hub.configure(normalizeConfig(await gladys.getConfig()));
      await poller.restart();
      refreshWidget();
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, STATUS.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.on('disconnected', () => {
    poller.stop();
  });

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      poller.stop();
      await hub.configure(normalizeConfig(newConfig));
      await poller.restart();
      refreshWidget();
    }),
  );

  gladys.onScanRequest(whenReady(() => hub.rescan()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // onPoll (fallback), onDeviceCreated, onDeviceUpdated.
  poller.register();

  gladys.onAction(
    ACTION_KEYS.TEST_READ,
    whenReady((fields) => testRead(hub, fields)),
  );
  gladys.onAction(
    ACTION_KEYS.CHECK_CONFIG,
    whenReady(() => checkConfig(hub)),
  );

  gladys.onWidgetGet(
    WIDGET_KEY,
    whenReady(async (request) => overviewContent(hub, request)),
  );

  return {
    hub,
    poller,
    ready,
    async stop() {
      poller.stop();
      hub.stop();
      await hub.store.flush?.();
    },
  };
}
