// -----------------------------------------------------------------------------
// What a value is, in Gladys terms: the "kinds" a custom register declares
// (temperature, power, energy...), each with its feature category and type,
// its default unit and the units it accepts.
//
// Choices worth knowing (see CLAUDE.md):
// - `energy` is an `energy-sensor/index` in kWh: the core then derives the
//   30-minute consumption and its cost by itself (energy tracking). A value
//   read in Wh or MWh is converted.
// - A writable on/off (`switch`) is an `input/binary`, not a `switch/binary`:
//   the voice assistants and HomeKit expose `switch` and `thermostat`
//   features, and a Modbus coil may start a heat pump or open a valve.
//   `input/binary` keeps the on/off toggle in the dashboard, without voice.
// - A writable number (`setpoint`) is a `water-heater/target-temperature`:
//   the one setpoint control of the core that is neither a room thermostat
//   (averaged into the room temperature, exposed to the assistants) nor
//   bound to a vehicle. Temperatures only.
// -----------------------------------------------------------------------------

/** Unit symbols the user may write, and the Gladys unit each one is. */
export const UNIT_SYMBOLS = {
  '°c': 'celsius',
  c: 'celsius',
  degc: 'celsius',
  celsius: 'celsius',
  '°f': 'fahrenheit',
  f: 'fahrenheit',
  fahrenheit: 'fahrenheit',
  k: 'kelvin',
  kelvin: 'kelvin',
  '%': 'percent',
  percent: 'percent',
  w: 'watt',
  kw: 'kilowatt',
  wh: 'watt-hour',
  kwh: 'kilowatt-hour',
  mwh: 'megawatt-hour',
  v: 'volt',
  mv: 'millivolt',
  a: 'ampere',
  ma: 'milliampere',
  va: 'volt-ampere',
  var: 'volt-ampere-reactive',
  bar: 'bar',
  mbar: 'milli-bar',
  hpa: 'hPa',
  kpa: 'kPa',
  pa: 'pascal',
  psi: 'psi',
  l: 'liter',
  ml: 'milliliter',
  m3: 'cubicmeter',
  'm³': 'cubicmeter',
  'm3/h': 'cubic-meter-per-hour',
  ms: 'milliseconds',
  s: 'seconds',
  min: 'minutes',
  h: 'hours',
  d: 'days',
  lux: 'lux',
  ppm: 'ppm',
};

/** Energy values are published in kWh: factor from the unit read. */
const TO_KWH = { 'watt-hour': 0.001, 'kilowatt-hour': 1, 'megawatt-hour': 1000 };

const BIG = 1_000_000;

/**
 * The kinds. `units`: the Gladys units accepted (first = default); `publish`:
 * a fixed published unit, the value being converted (energy).
 */
export const KINDS = {
  temperature: {
    category: 'temperature-sensor',
    type: 'decimal',
    units: ['celsius', 'fahrenheit', 'kelvin'],
    min: -50,
    max: 150,
  },
  humidity: {
    category: 'humidity-sensor',
    type: 'decimal',
    units: ['percent'],
    min: 0,
    max: 100,
  },
  pressure: {
    category: 'pressure-sensor',
    type: 'decimal',
    units: ['bar', 'milli-bar', 'hPa', 'kPa', 'pascal', 'psi'],
    min: 0,
    max: 10000,
  },
  power: {
    category: 'energy-sensor',
    type: 'power',
    units: ['watt', 'kilowatt'],
    min: -BIG,
    max: BIG,
  },
  energy: {
    category: 'energy-sensor',
    type: 'index',
    units: ['kilowatt-hour', 'watt-hour', 'megawatt-hour'],
    publish: 'kilowatt-hour',
    min: 0,
    max: 1_000_000_000,
  },
  production: {
    category: 'energy-production-sensor',
    type: 'index',
    units: ['kilowatt-hour', 'watt-hour', 'megawatt-hour'],
    publish: 'kilowatt-hour',
    min: 0,
    max: 1_000_000_000,
  },
  solar_power: {
    category: 'energy-production-sensor',
    type: 'power',
    units: ['watt', 'kilowatt'],
    min: 0,
    max: BIG,
  },
  grid_power: {
    category: 'grid-sensor',
    type: 'power',
    units: ['watt', 'kilowatt'],
    min: -BIG,
    max: BIG,
  },
  voltage: {
    category: 'energy-sensor',
    type: 'voltage',
    units: ['volt', 'millivolt'],
    min: 0,
    max: 1000,
  },
  current: {
    category: 'energy-sensor',
    type: 'current',
    units: ['ampere', 'milliampere'],
    min: -1000,
    max: 1000,
  },
  battery: {
    category: 'battery-storage',
    type: 'battery-level',
    units: ['percent'],
    min: 0,
    max: 100,
  },
  volume: {
    category: 'volume-sensor',
    type: 'decimal',
    units: ['liter', 'milliliter', 'cubicmeter'],
    min: 0,
    max: 1_000_000_000,
  },
  duration: {
    category: 'duration',
    type: 'decimal',
    units: ['seconds', 'milliseconds', 'minutes', 'hours', 'days'],
    min: 0,
    max: 1_000_000_000,
  },
  // Anything else: a number Gladys shows as is ("unknown" category), with
  // any known unit.
  value: {
    category: 'unknown',
    type: 'unknown',
    units: [null, ...new Set(Object.values(UNIT_SYMBOLS))],
    min: -BIG,
    max: BIG,
  },
  binary: {
    category: 'input',
    type: 'binary',
    units: [null],
    min: 0,
    max: 1,
    boolean: true,
  },
  switch: {
    category: 'input',
    type: 'binary',
    units: [null],
    min: 0,
    max: 1,
    boolean: true,
    writable: true,
  },
  setpoint: {
    category: 'water-heater',
    type: 'target-temperature',
    units: ['celsius', 'fahrenheit'],
    min: 0,
    max: 100,
    writable: true,
  },
};

/**
 * Turn a value read in `unit` into the value published for the kind.
 * @returns {{ factor: number, unit: string|null }}
 */
export function publishedUnit(kind, unit) {
  const definition = KINDS[kind];
  if (definition.publish) {
    return { factor: TO_KWH[unit] ?? 1, unit: definition.publish };
  }
  return { factor: 1, unit };
}

/** The Gladys unit of a symbol the user wrote, or undefined. */
export function unitOfSymbol(symbol) {
  return UNIT_SYMBOLS[symbol.toLowerCase()];
}

// How each unit is written in the messages.
const UNIT_LABELS = {
  celsius: '°C',
  fahrenheit: '°F',
  kelvin: 'K',
  percent: '%',
  watt: 'W',
  kilowatt: 'kW',
  'watt-hour': 'Wh',
  'kilowatt-hour': 'kWh',
  'megawatt-hour': 'MWh',
  volt: 'V',
  millivolt: 'mV',
  ampere: 'A',
  milliampere: 'mA',
  'volt-ampere': 'VA',
  'volt-ampere-reactive': 'var',
  bar: 'bar',
  'milli-bar': 'mbar',
  hPa: 'hPa',
  kPa: 'kPa',
  pascal: 'Pa',
  psi: 'psi',
  liter: 'L',
  milliliter: 'mL',
  cubicmeter: 'm3',
  'cubic-meter-per-hour': 'm3/h',
  milliseconds: 'ms',
  seconds: 's',
  minutes: 'min',
  hours: 'h',
  days: 'd',
  lux: 'lux',
  ppm: 'ppm',
};

/** "kWh" for "kilowatt-hour". */
export function unitLabel(unit) {
  return UNIT_LABELS[unit] ?? unit;
}
