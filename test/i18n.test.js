// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, the four documentations. German says "du", never
// the polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/i18n.js';
import { NAMES, STATES } from '../src/names.js';
import {
  CONFIG_ERRORS,
  DEVICE_LABEL,
  PROFILE_ERRORS,
  REGISTER_ERRORS,
  SLOT_LABEL,
  STATUS,
  WRITE_ERRORS,
} from '../src/messages.js';
import { ACTION_TEXT } from '../src/actions.js';
import { ALL_REFUSED } from '../src/hub.js';
import { TEXT as WIDGET_TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 70,
  description: 700,
  message: 400,
  featureName: 40,
  widgetItem: 40,
};

const sorted = (keys) => [...keys].sort();

/** Any argument a message template may take: renders as "7". */
const ANY = new Proxy(
  {},
  {
    get: (_, prop) => (prop === Symbol.toPrimitive ? () => '7' : '7'),
  },
);
const render = (value) => (typeof value === 'function' ? value(ANY, ANY, ANY, ANY) : value);

/** Checks one multi-language object (strings or templates); returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(render(text), `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(value, `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

const messageTable = (table, name, max = MAX.message) =>
  Object.entries(table).flatMap(([key, value]) => problems(value, `${name}.${key}`, max));

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(
    manifest.config_schema.find((field) => field.key === 'language').options.map((o) => o.value),
    LANGS,
  );
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 100, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message table of the code has the four languages', () => {
  const found = [
    ...messageTable(REGISTER_ERRORS, 'REGISTER_ERRORS'),
    ...messageTable(CONFIG_ERRORS, 'CONFIG_ERRORS'),
    ...messageTable(STATUS, 'STATUS'),
    ...messageTable(PROFILE_ERRORS, 'PROFILE_ERRORS'),
    ...messageTable(WRITE_ERRORS, 'WRITE_ERRORS'),
    ...messageTable(ACTION_TEXT, 'ACTION_TEXT'),
    ...messageTable(WIDGET_TEXT, 'WIDGET_TEXT', MAX.message),
    ...problems(DEVICE_LABEL, 'DEVICE_LABEL', MAX.featureName),
    ...problems(SLOT_LABEL, 'SLOT_LABEL', MAX.message),
    ...problems(ALL_REFUSED, 'ALL_REFUSED', MAX.message),
  ];
  assert.deepEqual(found, []);
  // The widget's status labels and values fit a status row.
  for (const key of [
    'link',
    'answers',
    'silent',
    'waiting',
    'lastRead',
    'never',
    'state',
    'error',
  ]) {
    assert.deepEqual(problems(WIDGET_TEXT[key], `WIDGET_TEXT.${key}`, MAX.widgetItem), []);
  }
});

test('the feature names and inverter states exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(STATES, 'STATES', MAX.widgetItem), []);
  // The occurrence number still fits ("Meter energy exported 2").
  for (const lang of LANGS) {
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(`${name} 9`.length <= MAX.featureName, `${lang}: ${name}`);
    }
  }
});

test('the four documentations have the same sections', async () => {
  const outlines = {};
  for (const lang of LANGS) {
    const text = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
    assert.ok(text.length >= 300, `docs/${lang}.md is too short`);
    outlines[lang] = text
      .split('\n')
      .filter((line) => /^#{1,3} /.test(line))
      .map((line) => line.match(/^#+/)[0].length);
    if (lang === 'de') {
      const polite = text.split('\n').filter((line) => POLITE_GERMAN.test(line));
      assert.deepEqual(polite, [], 'docs/de.md uses the polite form');
    }
    assert.match(text, lang === 'en' ? /Developed without the hardware/ : /./);
  }
  assert.ok(outlines.en.length >= 12, `only ${outlines.en.length} headings in docs/en.md`);
  for (const lang of LANGS) {
    assert.deepEqual(
      outlines[lang],
      outlines.en,
      `docs/${lang}.md has other sections than docs/en.md`,
    );
  }
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Gerät',
    'Ihre IP',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.actions[0].fields[1].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.actions[0].fields[1].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
