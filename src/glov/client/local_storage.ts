// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint-env browser */

import assert from 'assert';

// Old API exports
exports.get = localStorageGet; // eslint-disable-line no-use-before-define
exports.set = localStorageSet; // eslint-disable-line no-use-before-define
exports.setJSON = localStorageSetJSON; // eslint-disable-line no-use-before-define
exports.getJSON = localStorageGetJSON; // eslint-disable-line no-use-before-define
exports.clearAll = localStorageClearAll; // eslint-disable-line no-use-before-define

let storage_prefix = 'demo';

let is_set = false;
export function setStoragePrefix(prefix: string): void {
  if (is_set) {
    return;
  }
  is_set = true;
  storage_prefix = prefix;
}
export function getStoragePrefix(): string {
  assert(is_set);
  return storage_prefix;
}

let lsd = (function () {
  try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
    return localStorage;
  } catch (e) {
    return null; // Use lsd_overlay only instead
  }
}());

// Overlay to use if we lose access to localStorage at run-time (Firefox "quota exceeded" error)
let lsd_overlay: Partial<Record<string, string>> = {};

export function localStorageGet(key: string): string | undefined {
  assert(is_set);
  key = `${storage_prefix}_${key}`;
  let ret: string | null | undefined = lsd_overlay[key] || (lsd && lsd.getItem(key));
  if (ret === 'undefined') {
    ret = undefined;
  } else if (ret === null) {
    ret = undefined;
  }
  return ret;
}

export function localStorageSet(key: string, value: unknown): void {
  assert(is_set);
  key = `${storage_prefix}_${key}`;
  if (value === undefined || value === null) {
    if (lsd) {
      lsd.removeItem(key);
    }
    delete lsd_overlay[key];
  } else {
    let str = String(value);
    lsd_overlay[key] = str;
    try {
      if (lsd) {
        lsd.setItem(key, str);
      }
    } catch (e) {
      // ignored, it's in the overlay for the current session at least
      // FireFox throws "The quota has been exceeded" errors here
    }
  }
}

export function localStorageSetJSON(key: string, value: unknown): void {
  localStorageSet(key, JSON.stringify(value));
}

export function localStorageGetJSON<T = unknown>(key: string, def?: T): T | undefined {
  let value = localStorageGet(key);
  if (value === undefined) {
    return def;
  }
  try {
    return JSON.parse(value);
  } catch (e) {
    // ignore
  }
  return def;
}

export function localStorageClearAll(key_prefix?: string): void {
  let prefix = new RegExp(`^${storage_prefix}_${key_prefix || ''}`, 'u');
  if (lsd) {
    let keysToRemove = [];
    for (let i = 0; i < lsd.length; i++) {
      let key = lsd.key(i);
      assert(key);
      if (key.match(prefix)) {
        keysToRemove.push(key);
      }
    }
    for (let i = 0; i < keysToRemove.length; i++) {
      lsd.removeItem(keysToRemove[i]);
    }
  }
  for (let key in lsd_overlay) {
    if (key.match(prefix)) {
      delete lsd_overlay[key];
    }
  }
}

export function localStorageExportAll(): string {
  let obj: Partial<Record<string, unknown>> = {};
  let prefix = new RegExp(`^${storage_prefix}_(.*)`, 'u');
  if (lsd) {
    for (let i = 0; i < lsd.length; i++) {
      let key = lsd.key(i);
      assert(key);
      let m = key.match(prefix);
      if (m) {
        let v = lsd.getItem(key);
        if (v !== 'undefined') {
          obj[m[1]] = v;
        }
      }
    }
  }
  for (let key in lsd_overlay) {
    let m = key.match(prefix);
    if (m) {
      obj[m[1]] = lsd_overlay[key];
    }
  }
  return JSON.stringify(obj);
}

export function localStorageImportAll(serialized: string): void {
  let obj = JSON.parse(serialized);
  localStorageClearAll();
  for (let key in obj) {
    localStorageSet(key, obj[key]);
  }
}
