// -----------------------------------------------------------------------------
// The buttons of the Configuration screen.
//
// - test_read  "Test a read": reads one register of a configured device and
//   shows the raw words and what they read as in every common data type —
//   the tool to find the type, the word order and the scale of an unknown
//   register before declaring it. `sunspec` instead of a register lists the
//   SunSpec models the device announces.
// - check_config  "Check the configuration": every mistake, entry by entry,
//   and whether each device answers.
//
// A result is shown in green, a thrown error in red. A thrown error carries a
// single text: it is written in the language of the configuration (the
// container does not know the user's).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { byLanguage, formatNumber, joinLines, localize, pick } from './i18n.js';
import { DEVICE_LABEL, SLOT_LABEL, configErrorText, registerErrorText } from './messages.js';
import { DATA_TYPES, decodeWords, hexWord } from './modbus/datatypes.js';
import { ModbusException, EXCEPTION_NAMES, isBitTable } from './modbus/frames.js';
import { KINDS, publishedUnit, unitLabel } from './kinds.js';
import { PROFILES } from './profiles/index.js';
import { scanSunSpec, supportedModels } from './profiles/sunspec.js';
import { ProfileError } from './profiles/common.js';
import { entryValue, parseEntry, registerCount } from './registers.js';
import { errorText } from './hub.js';

const logger = createLogger({ name: 'modbus-actions' });

export const ACTION_KEYS = { TEST_READ: 'test_read', CHECK_CONFIG: 'check_config' };

export const ACTION_TEXT = {
  noDevice: {
    en: (n) =>
      `${DEVICE_LABEL.en(n)} has no valid address, port and unit id in the configuration (save it first).`,
    fr: (n) =>
      `${DEVICE_LABEL.fr(n)} n'a pas d'adresse, de port et d'identifiant d'esclave valables dans la configuration (enregistrez-la d'abord).`,
    de: (n) =>
      `${DEVICE_LABEL.de(n)} hat keine gültige Adresse, keinen Port und keine Unit-ID in der Konfiguration (speichere sie zuerst).`,
    es: (n) =>
      `${DEVICE_LABEL.es(n)} no tiene dirección, puerto e identificador válidos en la configuración (guárdela primero).`,
  },
  noRegister: {
    en: 'Type the register to read, e.g. holding 100 int16 scale=0.1, or sunspec.',
    fr: 'Saisissez le registre à lire, par ex. holding 100 int16 scale=0.1, ou sunspec.',
    de: 'Gib das zu lesende Register ein, z. B. holding 100 int16 scale=0.1, oder sunspec.',
    es: 'Escriba el registro que leer, p. ej. holding 100 int16 scale=0.1, o sunspec.',
  },
  badCount: {
    en: 'count= takes a number from 1 to 125.',
    fr: 'count= prend un nombre de 1 à 125.',
    de: 'count= nimmt eine Zahl von 1 bis 125.',
    es: 'count= toma un número de 1 a 125.',
  },
  read: {
    en: (label, what) => `${label}, ${what}:`,
    fr: (label, what) => `${label}, ${what} :`,
    de: (label, what) => `${label}, ${what}:`,
    es: (label, what) => `${label}, ${what}:`,
  },
  raw: {
    en: (list) => `Raw: ${list}`,
    fr: (list) => `Brut : ${list}`,
    de: (list) => `Roh: ${list}`,
    es: (list) => `En bruto: ${list}`,
  },
  value: {
    en: (how, value) => `Value (${how}): ${value}`,
    fr: (how, value) => `Valeur (${how}) : ${value}`,
    de: (how, value) => `Wert (${how}): ${value}`,
    es: (how, value) => `Valor (${how}): ${value}`,
  },
  nan: {
    en: 'not a number',
    fr: 'pas un nombre',
    de: 'keine Zahl',
    es: 'no es un número',
  },
  readings: {
    en: 'The same registers read as:',
    fr: 'Les mêmes registres lus comme :',
    de: 'Dieselben Register gelesen als:',
    es: 'Los mismos registros leídos como:',
  },
  exception: {
    en: (code, name) =>
      `The device answered Modbus exception ${code} (${name}).${code === 2 ? ' This address does not exist in this table: check the table (holding or input) and the address (some documents count from 1, or add 30001/40001).' : ''}`,
    fr: (code, name) =>
      `L'appareil a répondu l'exception Modbus ${code} (${name}).${code === 2 ? " Cette adresse n'existe pas dans cette table : vérifiez la table (holding ou input) et l'adresse (certains documents comptent à partir de 1, ou ajoutent 30001/40001)." : ''}`,
    de: (code, name) =>
      `Das Gerät antwortete mit der Modbus-Ausnahme ${code} (${name}).${code === 2 ? ' Diese Adresse gibt es in dieser Tabelle nicht: Prüfe die Tabelle (holding oder input) und die Adresse (manche Unterlagen zählen ab 1 oder addieren 30001/40001).' : ''}`,
    es: (code, name) =>
      `El dispositivo respondió la excepción Modbus ${code} (${name}).${code === 2 ? ' Esta dirección no existe en esta tabla: compruebe la tabla (holding o input) y la dirección (algunos documentos cuentan desde 1, o suman 30001/40001).' : ''}`,
  },
  failed: {
    en: (label, error) => `${label}: ${error}`,
    fr: (label, error) => `${label} : ${error}`,
    de: (label, error) => `${label}: ${error}`,
    es: (label, error) => `${label}: ${error}`,
  },
  sunspec: {
    en: (base, identity) => `SunSpec map at ${base}${identity ? `: ${identity}` : ''}. Models:`,
    fr: (base, identity) =>
      `Table SunSpec en ${base}${identity ? ` : ${identity}` : ''}. Modèles :`,
    de: (base, identity) =>
      `SunSpec-Tabelle bei ${base}${identity ? `: ${identity}` : ''}. Modelle:`,
    es: (base, identity) => `Tabla SunSpec en ${base}${identity ? `: ${identity}` : ''}. Modelos:`,
  },
  model: {
    en: (id, address, length, used) =>
      `- ${id} at ${address}, ${length} registers${used ? ' (read by the integration)' : ''}`,
    fr: (id, address, length, used) =>
      `- ${id} en ${address}, ${length} registres${used ? " (lu par l'intégration)" : ''}`,
    de: (id, address, length, used) =>
      `- ${id} bei ${address}, ${length} Register${used ? ' (von der Integration gelesen)' : ''}`,
    es: (id, address, length, used) =>
      `- ${id} en ${address}, ${length} registros${used ? ' (leído por la integración)' : ''}`,
  },
  configOk: {
    en: 'The configuration has no mistake.',
    fr: "La configuration ne contient pas d'erreur.",
    de: 'Die Konfiguration enthält keinen Fehler.',
    es: 'La configuración no contiene errores.',
  },
  configMistakes: {
    en: (count) => `${count} mistake(s) in the configuration:`,
    fr: (count) => `${count} erreur(s) dans la configuration :`,
    de: (count) => `${count} Fehler in der Konfiguration:`,
    es: (count) => `${count} error(es) en la configuración:`,
  },
  deviceLine: {
    en: (label, profile, features, answer) =>
      `${label}, ${profile}: ${features} feature(s), ${answer}`,
    fr: (label, profile, features, answer) =>
      `${label}, ${profile} : ${features} fonctionnalité(s), ${answer}`,
    de: (label, profile, features, answer) =>
      `${label}, ${profile}: ${features} Funktion(en), ${answer}`,
    es: (label, profile, features, answer) =>
      `${label}, ${profile}: ${features} función(es), ${answer}`,
  },
  answers: { en: 'answers', fr: 'répond', de: 'antwortet', es: 'responde' },
  notAnswering: {
    en: (error) => `does not answer (${error})`,
    fr: (error) => `ne répond pas (${error})`,
    de: (error) => `antwortet nicht (${error})`,
    es: (error) => `no responde (${error})`,
  },
  notAdded: {
    en: 'to add from the Discovery tab',
    fr: "à ajouter depuis l'onglet Découverte",
    de: 'im Tab „Entdecken“ hinzuzufügen',
    es: 'por añadir desde la pestaña Descubrimiento',
  },
};

/** An error whose message is in the configuration language. */
function failure(text, lang) {
  return new Error(pick(text, lang));
}

/**
 * "Test a read".
 * @param {import('./hub.js').ModbusHub} hub
 * @param {{ device?: string, register?: string }} fields
 */
export async function testRead(hub, fields = {}) {
  const lang = hub.config.language;
  const n = Number(fields.device);
  const target = hub.targets.get(n);
  if (!target) {
    throw failure(localize(ACTION_TEXT.noDevice, fields.device ?? '?'), lang);
  }
  let text = String(fields.register ?? '').trim();
  if (text === '') {
    throw failure(ACTION_TEXT.noRegister, lang);
  }
  logger.info(`Action test_read <- device ${n}: ${text}`);
  const connection = hub.pool.get({
    host: target.host,
    port: target.port,
    framing: target.framing,
    timeoutMs: hub.config.timeout * 1000,
    waitAfterConnectMs: PROFILES[target.profileId]?.waitAfterConnectMs ?? 0,
  });
  const label = localize(SLOT_LABEL, target);

  if (text.toLowerCase() === 'sunspec') {
    try {
      const layout = await scanSunSpec(connection, target.unitId);
      const used = new Set(supportedModels(layout).map((model) => model.address));
      const identity = [layout.manufacturer, layout.model, layout.version]
        .filter(Boolean)
        .join(' ');
      return joinLines([
        localize(ACTION_TEXT.sunspec, layout.base, identity),
        ...layout.models.map((model) =>
          localize(
            ACTION_TEXT.model,
            model.id,
            model.address,
            model.length,
            used.has(model.address),
          ),
        ),
      ]);
    } catch (err) {
      throw failure(readFailure(label, err), lang);
    }
  }

  // count=N reads more registers than the type needs (to look around).
  let count;
  text = text.replace(/(^|\s)count=(\S*)/i, (_, space, value) => {
    count = Number(value);
    return space;
  });
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 125)) {
    throw failure(ACTION_TEXT.badCount, lang);
  }
  const parsed = parseEntry(`test: ${text}`, 1);
  if (parsed.error) {
    throw failure(registerErrorText({ ...parsed.error, name: '' }), lang);
  }
  const entry = parsed.entry;
  const size = Math.max(registerCount(entry), count ?? 0);
  const bits = isBitTable(entry.table);
  let words;
  try {
    words = await connection.read(target.unitId, entry.table, entry.address, size);
  } catch (err) {
    throw failure(readFailure(label, err), lang);
  }
  const what = `${entry.table} ${entry.address}${size > 1 ? `-${entry.address + size - 1}` : ''}`;
  const lines = [byLanguage((lang2) => ACTION_TEXT.read[lang2](label[lang2], what))];
  lines.push(
    localize(
      ACTION_TEXT.raw,
      bits ? words.join(' ') : `${words.map(hexWord).join(' ')} (${words.join(', ')})`,
    ),
  );
  const value = entryValue(entry, words.slice(0, registerCount(entry)));
  const how = [
    bits ? entry.table : entry.dataType === 'bit' ? `bit${entry.bit}` : entry.dataType,
    entry.swap !== 'none' ? `swap=${entry.swap}` : null,
    entry.scale !== 1 ? `×${entry.scale}` : null,
    entry.offset !== 0 ? `+${entry.offset}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const { unit } = publishedUnit(entry.kind, entry.unit);
  lines.push(
    byLanguage((lang2) =>
      ACTION_TEXT.value[lang2](
        how,
        value === undefined
          ? ACTION_TEXT.nan[lang2]
          : `${formatNumber(value, lang2, 6)}${unit && !KINDS[entry.kind].boolean ? ` ${unitLabel(unit)}` : ''}`,
      ),
    ),
  );
  if (!bits) {
    lines.push(ACTION_TEXT.readings, ...interpretations(words));
  }
  return joinLines(lines);
}

/** The first registers read as every common type and order. */
function interpretations(words) {
  const lines = [];
  for (const [type, size] of Object.entries(DATA_TYPES)) {
    if (words.length < size) {
      continue;
    }
    const slice = words.slice(0, size);
    const orders = size === 1 ? ['none', 'byte'] : ['none', 'word', 'byte', 'word_byte'];
    const values = orders.map((swap) => {
      const value = decodeWords(slice, type, swap);
      const shown = Number.isFinite(value)
        ? type.startsWith('float')
          ? Number(value.toPrecision(7)).toString()
          : String(value)
        : 'NaN';
      return swap === 'none' ? shown : `${shown} (swap=${swap})`;
    });
    lines.push(localize({ en: `- ${type}: ${values.join(' · ')}` }));
  }
  return lines;
}

function readFailure(label, err) {
  if (err instanceof ModbusException) {
    return localize(
      {
        en: (code, name) => ACTION_TEXT.failed.en(label.en, ACTION_TEXT.exception.en(code, name)),
        fr: (code, name) => ACTION_TEXT.failed.fr(label.fr, ACTION_TEXT.exception.fr(code, name)),
        de: (code, name) => ACTION_TEXT.failed.de(label.de, ACTION_TEXT.exception.de(code, name)),
        es: (code, name) => ACTION_TEXT.failed.es(label.es, ACTION_TEXT.exception.es(code, name)),
      },
      err.code,
      EXCEPTION_NAMES[err.code] ?? 'unknown',
    );
  }
  const reason = err instanceof ProfileError ? errorText(err) : localize({ en: err.message });
  return byLanguage((lang) => ACTION_TEXT.failed[lang](label[lang], reason[lang]));
}

/**
 * "Check the configuration": throws (red) the mistakes, or resolves (green)
 * the state of every device.
 * @param {import('./hub.js').ModbusHub} hub
 */
export async function checkConfig(hub) {
  logger.info('Action check_config');
  const lang = hub.config.language;
  const runtimes = [...hub.runtimes.values()];
  const errors = [...hub.errors, ...runtimes.flatMap((runtime) => runtime.featureErrors ?? [])];
  const created = new Set((hub.gladys.devices ?? []).map((device) => device.external_id));
  const deviceLines = runtimes.map((runtime) => {
    const { status } = runtime;
    const label = localize(SLOT_LABEL, runtime.slot);
    return byLanguage((language) => {
      let answer =
        status.reachable === false
          ? ACTION_TEXT.notAnswering[language](status.error?.[language] ?? '')
          : ACTION_TEXT.answers[language];
      if (!created.has(runtime.ids.device)) {
        answer = `${answer}, ${ACTION_TEXT.notAdded[language]}`;
      }
      return ACTION_TEXT.deviceLine[language](
        label[language],
        runtime.profile.label,
        runtime.features.length,
        answer,
      );
    });
  });
  if (errors.length > 0) {
    throw failure(
      joinLines([
        localize(ACTION_TEXT.configMistakes, errors.length),
        ...errors.map(configErrorText),
        ...deviceLines,
      ]),
      lang,
    );
  }
  return joinLines([ACTION_TEXT.configOk, ...deviceLines]);
}
