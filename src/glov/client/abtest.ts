import assert from 'assert';
import { mashString } from 'glov/common/rand_alea';
import { TSMap } from 'glov/common/types';
import { platformGetID } from './client_config';
import {
  localStorageGet,
  localStorageSet,
} from './local_storage';
import {
  netPostInit,
  netSubs,
  netUserId,
} from './net';
import { wsclientSetExtraParam } from './wsclient';

const { floor } = Math;

const KEY_LOCAL_ID = 'abtests_id';
const KEY_TEST_PREFIX = 'abtest.';

export type ABTestDef = {
  name: string;
  values: string[];
  allowed_values?: string[]; // optional set of (not current) values still allowed, if permanent
  scope: 'user' | 'client';
  permanent: boolean;
  metrics?: string;
  cb?: (value: string) => void;
};

type ABTestState = ABTestDef & {
  value: string | null;
};

function evaluateSplitGroup(state: ABTestState, id: string): void {
  const { values, name } = state;
  let local_key = `${KEY_TEST_PREFIX}${state.name}`;
  let new_value: string | null = null;
  if (state.permanent) {
    let stored_value = localStorageGet(local_key);
    if (stored_value && (
      state.values.includes(stored_value) ||
      state.allowed_values?.includes(stored_value)
    )) {
      new_value = stored_value;
    }
  }
  if (!new_value) {
    let idx = floor(mashString(`${name}:${id}`) / 0x100000000 * values.length);
    new_value = values[idx];
  }
  state.value = new_value;
  state.cb?.(state.value);
  if (state.scope === 'client') {
    // Store in case currently or future flagged as permanent
    localStorageSet(local_key, state.value);
  }
}

let abtest_defs: TSMap<ABTestState> = {};

let metrics_string = '';
let metrics_and_platform_string = '';
export function abTestGetMetrics(): string {
  return metrics_string;
}
export function abTestGetMetricsAndPlatform(): string {
  return metrics_and_platform_string;
}
function updateMetricsString(): void {
  let data: string[] = [];
  for (let key in abtest_defs) {
    let def = abtest_defs[key]!;
    if (def.metrics && def.value) {
      data.push(`${def.metrics}${def.value}`);
    }
  }
  metrics_string = data.join(',');
  data.push(platformGetID());
  metrics_and_platform_string = data.join(',');
}

function updateWSClient(): void {
  let data = [];
  for (let key in abtest_defs) {
    let def = abtest_defs[key]!;
    if (def.scope === 'client' && def.metrics) {
      data.push(`${def.metrics}${def.value}`);
    }
  }
  wsclientSetExtraParam('abt', data.join(','));
}

let user_id: string | null = null;

function evaluatePerUserABTests(): void {
  assert(user_id);
  for (let key in abtest_defs) {
    let state = abtest_defs[key]!;
    if (state.scope !== 'user') {
      continue;
    }
    evaluateSplitGroup(state, user_id);
  }
  updateMetricsString();
}

function abTestPostNetInit(): void {
  netSubs().on('login', function () {
    user_id = netUserId();
    evaluatePerUserABTests();
  });
  netSubs().on('logout', function () {
    user_id = null;
  });
}

let local_id: string;

let did_startup = false;
function abTestStartup(): void {
  if (did_startup) {
    return;
  }
  did_startup = true;

  local_id = localStorageGet(KEY_LOCAL_ID) || '';
  if (!local_id) {
    local_id = `id${Math.random()}`;
    localStorageSet(KEY_LOCAL_ID, local_id);
  }

  netPostInit(abTestPostNetInit);
}

export function abTestRegister(def: ABTestDef): void {
  abTestStartup();
  let state: ABTestState = {
    ...def,
    value: null,
  };
  abtest_defs[state.name] = state;
  if (state.scope === 'client') {
    evaluateSplitGroup(state, local_id);
  }
  if (state.scope === 'client' && state.metrics) {
    // Should be registered _before_ initial connection/netInit, so connection metrics are counted
    assert(!netSubs());
    updateWSClient();
    updateMetricsString();
  }
  if (state.scope === 'user') {
    assert(!state.permanent); // user ids are already "permanent", just manage your split groups carefully
    // Before first login, so it gets applied, and sends metrics
    assert(!netSubs() || !netUserId());
  }
}
export function abTestGet(name: string): string {
  let def = abtest_defs[name];
  assert(def);
  assert(def.value !== null);
  return def.value;
}
