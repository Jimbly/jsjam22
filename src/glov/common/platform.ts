import assert from 'assert';

import type { DataObject } from './types';

export type PlatformID = string;

export type PlatformDef = {
  // devmode: if `auto`, will enable MODE_DEVELOPMENT if the host starts with `localhost`
  devmode: 'auto' | 'on' | 'off';
  // reload: whether or not we can call document.reload() to reload the page
  reload: boolean;
  // reload_updates: whether or not calling document.reload() will cause us to get an updated version of the client
  reload_updates: boolean;
};

let platforms: Partial<Record<PlatformID, PlatformDef>> = Object.create(null);

let too_late_to_register = false;

export function platformRegister(id: PlatformID, def: PlatformDef): void {
  assert(!too_late_to_register);
  assert(!platforms[id]);
  platforms[id] = def;
}

export function platformGetValidIDs(): PlatformID[] {
  return Object.keys(platforms);
}
export function platformIsValid(v: string | undefined | null): boolean {
  too_late_to_register = true; // all registering must be done before the first querying
  return Boolean(typeof v === 'string' && platforms[v]);
}
let parameter_overrides: DataObject = Object.create(null);
export function platformParameter<T extends keyof PlatformDef>(platform: PlatformID, parameter: T): PlatformDef[T];
export function platformParameter(platform: PlatformID, parameter: string): unknown {
  let override = parameter_overrides[parameter];
  if (override !== undefined) {
    return override;
  }
  let platdef = platforms[platform];
  assert(platdef);
  return (platdef as DataObject)[parameter];
}

export function platformOverrideParameter<T extends keyof PlatformDef>(parameter: T, value: PlatformDef[T]): void;
export function platformOverrideParameter(parameter: string, value: unknown): void {
  parameter_overrides[parameter] = value;
}

platformRegister('web', {
  devmode: 'auto',
  reload: true,
  reload_updates: true,
});
