// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export let PRESENCE_OFFLINE = 0; // for invisible, etc
export let PRESENCE_ACTIVE = 1;
export let PRESENCE_INACTIVE = 2;

export const ID_PROVIDER_APPLE = 'apl';
export const ID_PROVIDER_FB_GAMING = 'fbg';
export const ID_PROVIDER_FB_INSTANT = 'fbi';

function getStringEnumValues<T extends string>(e: Record<string, T>) {
  return Object.values(e);
}
function isValidStringEnumValue<T extends string>(e: Record<string, T>, v: string | undefined | null): boolean {
  for (let key in e) {
    if (e[key] === v) {
      return true;
    }
  }
  return false;
}

export enum Platform {
  Android = 'android',
  FBInstant = 'fbinstant',
  IOS = 'ios',
  Web = 'web',
  Yandex = 'yandex',
  Crazy = 'crazy',
  Itch = 'itch',
}
export function getPlatformValues(): Platform[] {
  return getStringEnumValues(Platform);
}
export function isValidPlatform(v: string | undefined | null): boolean {
  return isValidStringEnumValue(Platform, v);
}
