// -----------------------------------------------------------------------------
// The profiles, by the id stored in the configuration (never renamed: a user's
// configuration keeps it), and the features of custom registers.
// -----------------------------------------------------------------------------

import { KINDS, publishedUnit } from '../kinds.js';
import { entryValue, registerCount } from '../registers.js';
import { sdm120, sdm630 } from './eastron.js';
import { huaweiSun2000 } from './huawei.js';
import { sunspec } from './sunspec.js';
import { victronGx } from './victron.js';

/** Registers only, no profile. */
export const custom = {
  id: 'custom',
  label: 'Modbus',
  readOptions: { maxRegisters: 64, maxGap: 0 },
  features: () => [],
};

export const PROFILES = Object.fromEntries(
  [custom, sdm630, sdm120, sunspec, huaweiSun2000, victronGx].map((profile) => [
    profile.id,
    profile,
  ]),
);

export const PROFILE_IDS = Object.keys(PROFILES);

/**
 * The feature of a custom register entry (see src/registers.js).
 * @param {object} entry
 */
export function customFeature(entry) {
  const kind = KINDS[entry.kind];
  const { unit } = publishedUnit(entry.kind, entry.unit);
  const points = [{ table: entry.table, address: entry.address, count: registerCount(entry) }];
  return {
    key: entry.key,
    label: entry.name, // typed by the user: never translated
    category: kind.category,
    type: kind.type,
    ...(unit ? { unit } : {}),
    min: entry.min,
    max: entry.max,
    // entryValue already rounds to the entry's precision.
    precision: 6,
    points,
    entry,
    writable: entry.writable,
    value: (get) => {
      const words = get(points[0]);
      return Array.isArray(words) ? entryValue(entry, words) : undefined;
    },
  };
}
