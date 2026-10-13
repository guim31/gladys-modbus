// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { DEFAULT_CONFIG, POLL_INTERVALS, SLOT_COUNT } from '../src/config.js';
import { TRIGGERS } from '../src/hub.js';
import { LANGUAGES } from '../src/i18n.js';
import { FRAMINGS } from '../src/modbus/connection.js';
import { PROFILE_IDS } from '../src/profiles/index.js';
import { MemoryStore } from '../src/store.js';
import { WIDGET_KEY } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const registered = createFakeGladys();
const app = registerHandlers(registered, { store: new MemoryStore(), timers: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the identity of the integration', () => {
  assert.equal(manifest.name, 'Modbus TCP');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['protocols', 'energy']);
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-modbus:${manifest.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-modbus/main/cover.png',
  );
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('widgets and scene triggers require Gladys >= 5.1.0, categories >= 4.86.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
  // No widget button opens a form (that needs 5.2.0, #3168).
  for (const widget of manifest.widgets) {
    assert.equal(widget.action_timeout_seconds, undefined, 'no widget action');
  }
});

test('every action of the manifest has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every widget has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widgetAction:'), []);
});

test('the scene triggers the code fires are the declared ones, and there is no scene action', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  assert.equal(manifest.scene_actions, undefined);
  for (const trigger of manifest.scene_triggers) {
    // The filter field matches the `device` key of the event data.
    assert.deepEqual(keysOf(trigger.fields), ['device']);
    assert.ok(keysOf(trigger.variables).includes('device_name'));
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `DEFAULT_CONFIG.${entry.key}`);
    }
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(field(key), `DEFAULT_CONFIG.${key} is not in the manifest`);
  }
});

test('the select options are the values the code knows', () => {
  const values = (key) => field(key).options.map((option) => option.value);
  assert.deepEqual(values('language'), LANGUAGES);
  assert.deepEqual(values('poll_interval'), POLL_INTERVALS);
  for (let n = 1; n <= SLOT_COUNT; n += 1) {
    assert.deepEqual(values(`device_${n}_profile`), PROFILE_IDS);
    assert.deepEqual(values(`device_${n}_framing`), FRAMINGS);
    for (const suffix of ['host', 'port', 'unit_id', 'registers']) {
      assert.ok(field(`device_${n}_${suffix}`), `device_${n}_${suffix}`);
    }
  }
  assert.equal(field(`device_${SLOT_COUNT + 1}_host`), undefined);
  const testRead = manifest.actions.find((action) => action.key === 'test_read');
  assert.deepEqual(
    testRead.fields[0].options.map((option) => option.value),
    Array.from({ length: SLOT_COUNT }, (_, i) => String(i + 1)),
  );
});

test('number fields: integer bounds and defaults (the form renders them without a step)', () => {
  for (const entry of allFields.filter((candidate) => candidate.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `${entry.key}.${key}`);
      }
    }
  }
});

test('writing is off by default, and nothing secret is asked', () => {
  assert.equal(field('allow_write').default, false);
  assert.ok(!allFields.some((entry) => entry.type === 'secret'));
});

test('actions rely on no default (older cores do not apply them)', () => {
  for (const action of manifest.actions) {
    for (const entry of action.fields ?? []) {
      assert.equal(entry.default, undefined, `${action.key}.${entry.key}`);
    }
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((entry) => entry.type === 'section');
  assert.equal(sections.length, 1 + SLOT_COUNT);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.equal(dynamic.length, 3); // two trigger filters, the widget setting
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined);
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((entry) => entry.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0);
  for (const entry of withPlaceholder) {
    assert.equal(typeof entry.placeholder, 'object', `field "${entry.key}": placeholder`);
  }
});
