// -----------------------------------------------------------------------------
// Every message the container shows the user, in the four languages of the
// Gladys interface. German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

import { localize, joinLines } from './i18n.js';

const q = {
  en: (text) => `"${text}"`,
  fr: (text) => `« ${text} »`,
  de: (text) => `„${text}“`,
  es: (text) => `«${text}»`,
};

/** "Device 2" — the slots are numbered like the sections of the form. */
export const DEVICE_LABEL = {
  en: (n) => `Device ${n}`,
  fr: (n) => `Appareil ${n}`,
  de: (n) => `Gerät ${n}`,
  es: (n) => `Dispositivo ${n}`,
};

// --- Custom registers syntax -----------------------------------------------------

const EXAMPLE = 'Flow: holding 100 int16 scale=0.1 temperature';

export const REGISTER_ERRORS = {
  tooMany: {
    en: ({ max }) => `more than ${max} registers: split them over another device slot.`,
    fr: ({ max }) => `plus de ${max} registres : répartissez-les sur un autre appareil.`,
    de: ({ max }) => `mehr als ${max} Register: verteile sie auf ein weiteres Gerät.`,
    es: ({ max }) => `más de ${max} registros: repártalos en otro dispositivo.`,
  },
  missingColon: {
    en: () => `the name must be followed by a colon, e.g. ${EXAMPLE}.`,
    fr: () => `le nom doit être suivi de deux-points, par ex. ${EXAMPLE}.`,
    de: () => `auf den Namen muss ein Doppelpunkt folgen, z. B. ${EXAMPLE}.`,
    es: () => `el nombre debe ir seguido de dos puntos, p. ej. ${EXAMPLE}.`,
  },
  emptyName: {
    en: () => 'the name before the colon is empty.',
    fr: () => 'le nom avant les deux-points est vide.',
    de: () => 'der Name vor dem Doppelpunkt ist leer.',
    es: () => 'el nombre antes de los dos puntos está vacío.',
  },
  nameTooLong: {
    en: ({ max }) => `the name is longer than ${max} characters.`,
    fr: ({ max }) => `le nom dépasse ${max} caractères.`,
    de: ({ max }) => `der Name ist länger als ${max} Zeichen.`,
    es: ({ max }) => `el nombre supera los ${max} caracteres.`,
  },
  badAddress: {
    en: ({ word }) => `the address ${q.en(word)} is above 65535.`,
    fr: ({ word }) => `l'adresse ${q.fr(word)} dépasse 65535.`,
    de: ({ word }) => `die Adresse ${q.de(word)} ist größer als 65535.`,
    es: ({ word }) => `la dirección ${q.es(word)} supera 65535.`,
  },
  unknownOption: {
    en: ({ word }) =>
      `unknown option ${q.en(word)}: expected scale, offset, unit, swap, min, max, precision, on or off.`,
    fr: ({ word }) =>
      `option inconnue ${q.fr(word)} : attendu scale, offset, unit, swap, min, max, precision, on ou off.`,
    de: ({ word }) =>
      `unbekannte Option ${q.de(word)}: erwartet scale, offset, unit, swap, min, max, precision, on oder off.`,
    es: ({ word }) =>
      `opción desconocida ${q.es(word)}: se espera scale, offset, unit, swap, min, max, precision, on u off.`,
  },
  unknownWord: {
    en: ({ word }) =>
      `unknown word ${q.en(word)}: expected a data type (int16, uint16, int32, uint32, float32, int64, uint64, float64, bit0-bit15), a kind (temperature, power, energy...) or an option like scale=0.1.`,
    fr: ({ word }) =>
      `mot inconnu ${q.fr(word)} : attendu un type (int16, uint16, int32, uint32, float32, int64, uint64, float64, bit0-bit15), une nature (temperature, power, energy...) ou une option comme scale=0.1.`,
    de: ({ word }) =>
      `unbekanntes Wort ${q.de(word)}: erwartet ein Datentyp (int16, uint16, int32, uint32, float32, int64, uint64, float64, bit0-bit15), eine Art (temperature, power, energy...) oder eine Option wie scale=0.1.`,
    es: ({ word }) =>
      `palabra desconocida ${q.es(word)}: se espera un tipo (int16, uint16, int32, uint32, float32, int64, uint64, float64, bit0-bit15), una naturaleza (temperature, power, energy...) o una opción como scale=0.1.`,
  },
  missingTable: {
    en: () => 'say which table to read: holding, input, coil or discrete.',
    fr: () => 'indiquez la table à lire : holding, input, coil ou discrete.',
    de: () => 'gib die Tabelle an: holding, input, coil oder discrete.',
    es: () => 'indique la tabla que leer: holding, input, coil o discrete.',
  },
  missingAddress: {
    en: () => 'the register address is missing (a number, or 0x... in hexadecimal).',
    fr: () => "l'adresse du registre manque (un nombre, ou 0x... en hexadécimal).",
    de: () => 'die Registeradresse fehlt (eine Zahl, oder 0x... hexadezimal).',
    es: () => 'falta la dirección del registro (un número, o 0x... en hexadecimal).',
  },
  typeOnBits: {
    en: ({ table }) => `a ${table} is one bit: it takes no data type.`,
    fr: ({ table }) => `un ${table} est un bit : il ne prend pas de type de donnée.`,
    de: ({ table }) => `ein ${table} ist ein Bit: Es braucht keinen Datentyp.`,
    es: ({ table }) => `un ${table} es un bit: no lleva tipo de dato.`,
  },
  badNumber: {
    en: ({ word }) => `${q.en(word)} is not a valid number here.`,
    fr: ({ word }) => `${q.fr(word)} n'est pas un nombre valable ici.`,
    de: ({ word }) => `${q.de(word)} ist hier keine gültige Zahl.`,
    es: ({ word }) => `${q.es(word)} no es un número válido aquí.`,
  },
  badSwap: {
    en: ({ word }) => `swap=${word} is unknown: expected none, byte, word or word_byte.`,
    fr: ({ word }) => `swap=${word} est inconnu : attendu none, byte, word ou word_byte.`,
    de: ({ word }) => `swap=${word} ist unbekannt: erwartet none, byte, word oder word_byte.`,
    es: ({ word }) => `swap=${word} es desconocido: se espera none, byte, word o word_byte.`,
  },
  badUnit: {
    en: ({ word, kind, allowed }) => `unit=${word} does not fit ${kind}: use ${allowed}.`,
    fr: ({ word, kind, allowed }) =>
      `unit=${word} ne convient pas à ${kind} : utilisez ${allowed}.`,
    de: ({ word, kind, allowed }) => `unit=${word} passt nicht zu ${kind}: nimm ${allowed}.`,
    es: ({ word, kind, allowed }) => `unit=${word} no corresponde a ${kind}: use ${allowed}.`,
  },
  booleanNeedsRegister: {
    en: ({ kind }) => `${kind} reads a coil, a discrete input, a bitN or a 16-bit register.`,
    fr: ({ kind }) => `${kind} lit un coil, un discrete, un bitN ou un registre de 16 bits.`,
    de: ({ kind }) => `${kind} liest ein coil, ein discrete, ein bitN oder ein 16-Bit-Register.`,
    es: ({ kind }) => `${kind} lee un coil, un discrete, un bitN o un registro de 16 bits.`,
  },
  bitsAreBinary: {
    en: ({ table }) => `a ${table} is on or off: use binary, or switch to write it.`,
    fr: ({ table }) =>
      `un ${table} vaut marche ou arrêt : utilisez binary, ou switch pour l'écrire.`,
    de: ({ table }) => `ein ${table} ist an oder aus: nimm binary, oder switch zum Schreiben.`,
    es: ({ table }) =>
      `un ${table} vale encendido o apagado: use binary, o switch para escribirlo.`,
  },
  readOnlyTable: {
    en: ({ table, kind }) => `${kind} writes, but a ${table} is read-only: use holding or coil.`,
    fr: ({ table, kind }) =>
      `${kind} écrit, mais un ${table} est en lecture seule : utilisez holding ou coil.`,
    de: ({ table, kind }) =>
      `${kind} schreibt, aber ein ${table} ist schreibgeschützt: nimm holding oder coil.`,
    es: ({ table, kind }) =>
      `${kind} escribe, pero un ${table} es de solo lectura: use holding o coil.`,
  },
  noBitWrite: {
    en: () => 'one bit of a register cannot be written: use a coil or the whole register.',
    fr: () =>
      "un bit d'un registre ne peut pas être écrit : utilisez un coil ou le registre entier.",
    de: () =>
      'ein einzelnes Bit eines Registers lässt sich nicht schreiben: nimm ein coil oder das ganze Register.',
    es: () => 'un bit de un registro no se puede escribir: use un coil o el registro completo.',
  },
  noWideWrite: {
    en: ({ type }) => `${type} cannot be written: int16, uint16, int32, uint32 or float32 only.`,
    fr: ({ type }) =>
      `${type} ne peut pas être écrit : int16, uint16, int32, uint32 ou float32 seulement.`,
    de: ({ type }) =>
      `${type} lässt sich nicht schreiben: nur int16, uint16, int32, uint32 oder float32.`,
    es: ({ type }) => `${type} no se puede escribir: solo int16, uint16, int32, uint32 o float32.`,
  },
  setpointBounds: {
    en: () => 'a setpoint needs its bounds, e.g. min=20 max=55: nothing outside is written.',
    fr: () => "une consigne exige ses bornes, par ex. min=20 max=55 : rien n'est écrit en dehors.",
    de: () =>
      'ein Sollwert braucht seine Grenzen, z. B. min=20 max=55: außerhalb wird nichts geschrieben.',
    es: () =>
      'una consigna necesita sus límites, p. ej. min=20 max=55: no se escribe nada fuera de ellos.',
  },
  badBounds: {
    en: () => 'min must be lower than max.',
    fr: () => 'min doit être inférieur à max.',
    de: () => 'min muss kleiner als max sein.',
    es: () => 'min debe ser menor que max.',
  },
  duplicate: {
    en: ({ other }) => `same register as entry ${other}.`,
    fr: ({ other }) => `même registre que l'entrée ${other}.`,
    de: ({ other }) => `gleiches Register wie Eintrag ${other}.`,
    es: ({ other }) => `mismo registro que la entrada ${other}.`,
  },
  profileName: {
    en: () => 'a feature of the profile already has this name: choose another one.',
    fr: () => 'une fonctionnalité du profil porte déjà ce nom : choisissez-en un autre.',
    de: () => 'eine Funktion des Profils trägt schon diesen Namen: wähle einen anderen.',
    es: () => 'una función del perfil ya tiene este nombre: elija otro.',
  },
  duplicateName: {
    en: ({ other }) => `same name as entry ${other}.`,
    fr: ({ other }) => `même nom que l'entrée ${other}.`,
    de: ({ other }) => `gleicher Name wie Eintrag ${other}.`,
    es: ({ other }) => `mismo nombre que la entrada ${other}.`,
  },
};

const ENTRY = {
  en: (entry, name) => `entry ${entry}${name ? ` ${q.en(name)}` : ''}`,
  fr: (entry, name) => `entrée ${entry}${name ? ` ${q.fr(name)}` : ''}`,
  de: (entry, name) => `Eintrag ${entry}${name ? ` ${q.de(name)}` : ''}`,
  es: (entry, name) => `entrada ${entry}${name ? ` ${q.es(name)}` : ''}`,
};

/** One mistake in a custom register entry, without the device. */
export function registerErrorText({ entry, name, code, params }) {
  const table = REGISTER_ERRORS[code];
  return Object.fromEntries(
    ['en', 'fr', 'de', 'es'].map((lang) => [
      lang,
      `${ENTRY[lang](entry, name)}${lang === 'fr' ? ' : ' : ': '}${table[lang](params ?? {})}`,
    ]),
  );
}

// --- Configuration ------------------------------------------------------------------

export const CONFIG_ERRORS = {
  registersWithoutHost: {
    en: () => 'registers are filled in, but the address is empty.',
    fr: () => "des registres sont saisis, mais l'adresse est vide.",
    de: () => 'Register sind eingetragen, aber die Adresse ist leer.',
    es: () => 'hay registros, pero la dirección está vacía.',
  },
  badHost: {
    en: ({ host }) =>
      `the address ${q.en(host)} is not valid: an IP address or a host name only (no http://, no port).`,
    fr: ({ host }) =>
      `l'adresse ${q.fr(host)} n'est pas valable : une adresse IP ou un nom d'hôte seulement (sans http://, sans port).`,
    de: ({ host }) =>
      `die Adresse ${q.de(host)} ist ungültig: nur eine IP-Adresse oder ein Hostname (ohne http://, ohne Port).`,
    es: ({ host }) =>
      `la dirección ${q.es(host)} no es válida: solo una dirección IP o un nombre de host (sin http://, sin puerto).`,
  },
  badPort: {
    en: ({ port }) => `the port ${port} is not between 1 and 65535.`,
    fr: ({ port }) => `le port ${port} n'est pas entre 1 et 65535.`,
    de: ({ port }) => `der Port ${port} liegt nicht zwischen 1 und 65535.`,
    es: ({ port }) => `el puerto ${port} no está entre 1 y 65535.`,
  },
  badUnitId: {
    en: ({ unitId }) => `the unit id ${unitId} is not between 0 and 255.`,
    fr: ({ unitId }) => `l'identifiant d'esclave ${unitId} n'est pas entre 0 et 255.`,
    de: ({ unitId }) => `die Unit-ID ${unitId} liegt nicht zwischen 0 und 255.`,
    es: ({ unitId }) => `el identificador de esclavo ${unitId} no está entre 0 y 255.`,
  },
  badProfile: {
    en: ({ profile }) => `unknown profile ${q.en(profile)}.`,
    fr: ({ profile }) => `profil inconnu ${q.fr(profile)}.`,
    de: ({ profile }) => `unbekanntes Profil ${q.de(profile)}.`,
    es: ({ profile }) => `perfil desconocido ${q.es(profile)}.`,
  },
  badFraming: {
    en: ({ framing }) => `unknown framing ${q.en(framing)}.`,
    fr: ({ framing }) => `trame inconnue ${q.fr(framing)}.`,
    de: ({ framing }) => `unbekanntes Framing ${q.de(framing)}.`,
    es: ({ framing }) => `trama desconocida ${q.es(framing)}.`,
  },
  duplicateSlot: {
    en: ({ other }) => `same address, port and unit id as device ${other}.`,
    fr: ({ other }) => `même adresse, port et identifiant d'esclave que l'appareil ${other}.`,
    de: ({ other }) => `gleiche Adresse, gleicher Port und gleiche Unit-ID wie Gerät ${other}.`,
    es: ({ other }) => `misma dirección, puerto e identificador que el dispositivo ${other}.`,
  },
  nothingToRead: {
    en: () => 'no profile and no register: choose a profile or describe the registers to read.',
    fr: () => 'ni profil ni registre : choisissez un profil ou décrivez les registres à lire.',
    de: () => 'weder Profil noch Register: wähle ein Profil oder beschreibe die Register.',
    es: () => 'ni perfil ni registro: elija un perfil o describa los registros que leer.',
  },
};

/** One configuration mistake, with its device: "Device 2, entry 3 "Pump": ..." */
export function configErrorText({ slot, code, params }) {
  if (code === 'register') {
    const inner = registerErrorText(params);
    return localize({
      en: () => `${DEVICE_LABEL.en(slot)}, ${inner.en}`,
      fr: () => `${DEVICE_LABEL.fr(slot)}, ${inner.fr}`,
      de: () => `${DEVICE_LABEL.de(slot)}, ${inner.de}`,
      es: () => `${DEVICE_LABEL.es(slot)}, ${inner.es}`,
    });
  }
  const table = CONFIG_ERRORS[code];
  return localize({
    en: () => `${DEVICE_LABEL.en(slot)}: ${table.en(params ?? {})}`,
    fr: () => `${DEVICE_LABEL.fr(slot)} : ${table.fr(params ?? {})}`,
    de: () => `${DEVICE_LABEL.de(slot)}: ${table.de(params ?? {})}`,
    es: () => `${DEVICE_LABEL.es(slot)}: ${table.es(params ?? {})}`,
  });
}

// --- Connection status --------------------------------------------------------------

export const STATUS = {
  notConfigured: {
    en: 'Fill in the address of a device (or of its Modbus TCP gateway) to start.',
    fr: "Renseignez l'adresse d'un appareil (ou de sa passerelle Modbus TCP) pour commencer.",
    de: 'Gib die Adresse eines Geräts (oder seines Modbus-TCP-Gateways) ein, um zu beginnen.',
    es: 'Introduzca la dirección de un dispositivo (o de su pasarela Modbus TCP) para empezar.',
  },
  configErrors: {
    en: 'The configuration has mistakes, the devices concerned are not read:',
    fr: 'La configuration contient des erreurs, les appareils concernés ne sont pas lus :',
    de: 'Die Konfiguration enthält Fehler, die betroffenen Geräte werden nicht gelesen:',
    es: 'La configuración contiene errores, los dispositivos afectados no se leen:',
  },
  answering: {
    en: (count, total) => `${count} of ${total} device(s) answering.`,
    fr: (count, total) => `${count} appareil(s) sur ${total} répond(ent).`,
    de: (count, total) => `${count} von ${total} Gerät(en) antworten.`,
    es: (count, total) => `${count} de ${total} dispositivo(s) responden.`,
  },
  notAnswering: {
    en: (label, error) => `${label} does not answer: ${error}`,
    fr: (label, error) => `${label} ne répond pas : ${error}`,
    de: (label, error) => `${label} antwortet nicht: ${error}`,
    es: (label, error) => `${label} no responde: ${error}`,
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  writeDisabled: {
    en: 'Writing is off: the switches and setpoints you declared refuse every change.',
    fr: 'Écriture désactivée : les interrupteurs et consignes déclarés refusent toute modification.',
    de: 'Schreiben ist aus: Die deklarierten Schalter und Sollwerte lehnen jede Änderung ab.',
    es: 'Escritura desactivada: los interruptores y consignas declarados rechazan cualquier cambio.',
  },
  writeEnabled: {
    en: 'Writing is enabled: the switches and setpoints you declared can be changed from Gladys.',
    fr: 'Écriture activée : les interrupteurs et consignes déclarés peuvent être modifiés depuis Gladys.',
    de: 'Schreiben ist aktiviert: Die deklarierten Schalter und Sollwerte lassen sich aus Gladys ändern.',
    es: 'Escritura activada: los interruptores y consignas declarados se pueden cambiar desde Gladys.',
  },
};

/** "Device 2 (192.0.2.10:502, unit 1)" */
export const SLOT_LABEL = {
  en: (slot) => `${DEVICE_LABEL.en(slot.index)} (${slot.host}:${slot.port}, unit ${slot.unitId})`,
  fr: (slot) =>
    `${DEVICE_LABEL.fr(slot.index)} (${slot.host}:${slot.port}, esclave ${slot.unitId})`,
  de: (slot) => `${DEVICE_LABEL.de(slot.index)} (${slot.host}:${slot.port}, Unit ${slot.unitId})`,
  es: (slot) =>
    `${DEVICE_LABEL.es(slot.index)} (${slot.host}:${slot.port}, esclavo ${slot.unitId})`,
};

// --- Why a device does not answer, or is not recognized -------------------------------

export const PROFILE_ERRORS = {
  sunspecNotFound: {
    en: 'no SunSpec map at 40000, 0 or 50000: check the unit id (SMA: 126, SolarEdge and Fronius: 1) and that Modbus TCP is enabled with the SunSpec register set.',
    fr: "aucune table SunSpec en 40000, 0 ou 50000 : vérifiez l'identifiant d'esclave (SMA : 126, SolarEdge et Fronius : 1) et que Modbus TCP est activé avec la table SunSpec.",
    de: 'keine SunSpec-Tabelle bei 40000, 0 oder 50000: Prüfe die Unit-ID (SMA: 126, SolarEdge und Fronius: 1) und ob Modbus TCP mit dem SunSpec-Registersatz aktiviert ist.',
    es: 'ninguna tabla SunSpec en 40000, 0 o 50000: compruebe el identificador de esclavo (SMA: 126, SolarEdge y Fronius: 1) y que Modbus TCP esté activado con la tabla SunSpec.',
  },
};

// --- Writes --------------------------------------------------------------------------

export const WRITE_ERRORS = {
  disabled: {
    en: 'Writing is disabled: turn on "Allow writing" in the integration configuration.',
    fr: "L'écriture est désactivée : activez « Autoriser l'écriture » dans la configuration de l'intégration.",
    de: 'Schreiben ist deaktiviert: Schalte „Schreiben erlauben“ in der Konfiguration der Integration ein.',
    es: 'La escritura está desactivada: active «Permitir la escritura» en la configuración de la integración.',
  },
  notWritable: {
    en: 'This feature is read-only.',
    fr: 'Cette fonctionnalité est en lecture seule.',
    de: 'Diese Funktion ist schreibgeschützt.',
    es: 'Esta función es de solo lectura.',
  },
  outOfBounds: {
    en: (value, min, max) =>
      `${value} is outside the declared bounds (${min} to ${max}): not written.`,
    fr: (value, min, max) =>
      `${value} est hors des bornes déclarées (${min} à ${max}) : rien n'est écrit.`,
    de: (value, min, max) =>
      `${value} liegt außerhalb der deklarierten Grenzen (${min} bis ${max}): nicht geschrieben.`,
    es: (value, min, max) =>
      `${value} está fuera de los límites declarados (${min} a ${max}): no se escribe.`,
  },
};

/** The English text of a write refusal (the command result Gladys logs). */
export function writeError(code, ...args) {
  const text = localize(WRITE_ERRORS[code], ...args);
  const error = new Error(text.en);
  error.texts = text;
  return error;
}

export { joinLines };
