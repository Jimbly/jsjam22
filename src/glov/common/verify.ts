// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Like assert(0), but return the value, so the throw can be disabled if the
// calling code handles failure.  Can replace `verify(foo)` with `(foo)` at
// build time in production builds.

let should_throw = true;

function verify<T>(exp: T | undefined | null | false, msg?: string): T {
  if (!exp && should_throw) {
    throw new Error(`Assertion failed${msg ? `: ${msg}` : ''}`);
  }
  return exp as T;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace verify {
  export const ok = verify;

  export function equal<T>(a: T, b: T): boolean {
    if (a === b) {
      return true;
    }
    if (should_throw) {
      throw new Error(`Assertion failed: "${a}"==="${b}"`);
    }
    return false;
  }

  export function dothrow(doit: boolean): void {
    should_throw = doit;
  }

  export function shouldThrow(): boolean {
    return should_throw;
  }
}

export = verify;
