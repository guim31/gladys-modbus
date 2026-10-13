// -----------------------------------------------------------------------------
// The "Modbus device" dashboard widget: one device at a glance — its main
// values as live tiles (an inverter's power and yield, a meter's power and
// indexes, a Victron system's grid, house, solar and battery), and the health
// of its link: answering or not, the last read, the inverter state, the last
// error. What a plain device box cannot say.
//
// Budget of the core: 8 components at most, 6 tiles, 1 status list.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { pick } from './i18n.js';
import { STATES } from './names.js';

export const WIDGET_KEY = 'device_overview';
const MAX_TILES = 6;

export const TEXT = {
  pick: {
    en: 'Choose a Modbus device in the widget settings.',
    fr: 'Choisissez un appareil Modbus dans les réglages du widget.',
    de: 'Wähle ein Modbus-Gerät in den Einstellungen des Widgets.',
    es: 'Elija un dispositivo Modbus en los ajustes del widget.',
  },
  unknown: {
    en: 'This device is no longer in the integration configuration.',
    fr: "Cet appareil n'est plus dans la configuration de l'intégration.",
    de: 'Dieses Gerät ist nicht mehr in der Konfiguration der Integration.',
    es: 'Este dispositivo ya no está en la configuración de la integración.',
  },
  link: { en: 'Link', fr: 'Liaison', de: 'Verbindung', es: 'Enlace' },
  answers: { en: 'Answers', fr: 'Répond', de: 'Antwortet', es: 'Responde' },
  silent: { en: 'Not answering', fr: 'Ne répond pas', de: 'Antwortet nicht', es: 'No responde' },
  waiting: {
    en: 'Not read yet',
    fr: 'Pas encore lu',
    de: 'Noch nicht gelesen',
    es: 'Aún no leído',
  },
  lastRead: { en: 'Last read', fr: 'Dernière lecture', de: 'Letzte Abfrage', es: 'Última lectura' },
  never: { en: 'Never', fr: 'Jamais', de: 'Nie', es: 'Nunca' },
  state: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
};

/**
 * The content of the widget for one device.
 * @param {import('./hub.js').ModbusHub} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function overviewContent(hub, { settings = {}, language = 'en' } = {}) {
  const lang = ['en', 'fr', 'de', 'es'].includes(language) ? language : 'en';
  if (!settings.device) {
    return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text: TEXT.pick }] };
  }
  const runtime = hub.runtimeOf(settings.device);
  if (!runtime) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: TEXT.unknown }],
    };
  }
  const created = (hub.gladys.devices ?? []).find(
    (device) => device.external_id === settings.device,
  );
  const known = new Set((created?.features ?? []).map((feature) => feature.external_id));
  const numeric = runtime.features.filter((feature) => feature.category !== 'text');
  const ordered = [
    ...numeric.filter((feature) => feature.main),
    ...numeric.filter((feature) => !feature.main),
  ].filter((feature) => known.size === 0 || known.has(runtime.ids.feature(feature.key)));
  const tiles = ordered.slice(0, Math.max(3, numeric.filter((feature) => feature.main).length));
  const components = tiles.slice(0, MAX_TILES).map((feature) => ({
    type: 'value',
    device_feature: runtime.ids.feature(feature.key),
  }));

  const { status } = runtime;
  const items = [
    {
      label: TEXT.link,
      value:
        status.reachable === true
          ? pick(TEXT.answers, lang)
          : status.reachable === false
            ? pick(TEXT.silent, lang)
            : pick(TEXT.waiting, lang),
      color:
        status.reachable === true
          ? WIDGET_COLORS.SUCCESS
          : status.reachable === false
            ? WIDGET_COLORS.DANGER
            : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: TEXT.lastRead,
      value: status.lastReadAt ? clock(status.lastReadAt, lang) : pick(TEXT.never, lang),
    },
  ];
  const stateFeature = runtime.features.find((feature) => feature.category === 'text');
  const state = stateFeature && runtime.lastValues?.get(stateFeature.key);
  if (state && typeof state === 'object') {
    items.push({
      label: TEXT.state,
      value: (STATES[lang] ?? STATES.en)[state.state] ?? STATES.en.unknown,
    });
  }
  if (status.reachable === false && status.error) {
    items.push({ label: TEXT.error, value: truncate(pick(status.error, lang), 40) });
  }
  components.push({ type: 'status', items });
  return { ttl_seconds: 30, components };
}

/** "14:32:05" in the time zone of Gladys (the supervisor sets TZ). */
function clock(timestamp, lang) {
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
