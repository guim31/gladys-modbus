// -----------------------------------------------------------------------------
// Languages of the texts the container produces: feature names, widget and
// scene texts, messages. The four of the Gladys interface; German says "du",
// Spanish "usted" (Guilhem's choice for all his integrations).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const DEFAULT_LANGUAGE = 'fr';

/**
 * Build a multi-language object from a table of per-language templates.
 * @param {Record<string, string | Function>} table { en, fr, de, es }
 * @param {...unknown} args passed to the templates that are functions
 * @returns {{ en: string, fr: string, de: string, es: string }}
 */
export function localize(table, ...args) {
  return Object.fromEntries(
    LANGUAGES.map((lang) => {
      const template = table[lang] ?? table.en;
      return [lang, typeof template === 'function' ? template(...args) : template];
    }),
  );
}

/** A multi-language object built language by language. */
export function byLanguage(build) {
  return Object.fromEntries(LANGUAGES.map((lang) => [lang, build(lang)]));
}

/** The text of one language, English when missing. */
export function pick(text, lang) {
  if (typeof text === 'string') {
    return text;
  }
  return text?.[lang] ?? text?.en ?? '';
}

/** Join multi-language objects line by line, per language. */
export function joinLines(texts) {
  return Object.fromEntries(
    LANGUAGES.map((lang) => [lang, texts.map((text) => pick(text, lang)).join('\n')]),
  );
}

/** A number written the way the language writes it (decimal comma in fr/de/es). */
export function formatNumber(value, lang, maximumFractionDigits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return String(value);
  }
  return new Intl.NumberFormat(lang, { maximumFractionDigits, useGrouping: false }).format(value);
}
