// Portions Copyright 2023 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT


import assert from 'assert';
import { mashString } from 'glov/common/rand_alea';

import type { Mexchange } from './exchange';

const { floor } = Math;

type MexchangeFunction = (id: string, ...args: unknown[]) => void;
type MexchangeFKey = keyof Mexchange;
const function_names: readonly MexchangeFKey[] =
  ['register', 'replaceMessageHandler', 'subscribe', 'unregister', 'publish'] as const;

export function exchangeHashedCreate(exchange_list: Mexchange[]): Mexchange {
  assert(exchange_list);
  assert(exchange_list.length);
  // Hash comparison and performance: https://gist.github.com/Jimbly/328387ec1623909af935e133850e9ed6
  let mult = 1 / 0xFFFFFFFF * exchange_list.length;
  function hasher(str: string): number {
    assert(str && typeof str === 'string');
    let ret = mashString(str);
    return floor(ret * mult);
  }
  let ret: Partial<Mexchange> = {};
  function_names.forEach((api: keyof Mexchange) => {
    (ret as Record<string, MexchangeFunction>)[api] = function (id, ...args) {
      let hash = hasher(id);
      return (exchange_list[hash][api] as MexchangeFunction)(id, ...args);
    };
  });
  return ret as Mexchange;
}
