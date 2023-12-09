// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export const PRESENCE_OFFLINE = 0; // for invisible, etc
export const PRESENCE_ACTIVE = 1;
export const PRESENCE_INACTIVE = 2;

export type NumberEnum<K extends string, V extends number> = Record<K, V> & Partial<Record<string, V | string>>;
export type StringEnum<K extends string, V extends string> = Record<K, V>;

export function getStringEnumValues<K extends string, V extends string>(e: StringEnum<K, V>): V[] {
  return Object.values(e);
}
export function isValidNumberEnumKey<K extends string, V extends number>(e: NumberEnum<K, V>, k: string): k is K {
  return typeof e[k] === 'number';
}
export function isValidStringEnumKey<K extends string, V extends string>(e: StringEnum<K, V>, k: string): k is K {
  return k in e;
}
export function isValidStringEnumValue<K extends string, V extends string>(
  e: StringEnum<K, V>,
  v: string | undefined | null,
): v is V {
  for (let key in e) {
    if (e[key] === v) {
      return true;
    }
  }
  return false;
}
