// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { abs, floor, min, max, random, round, pow, sqrt } = Math;

export function nop() {
  // empty
}

export function identity(a) {
  return a;
}

export function once(fn) {
  let called = false;
  return function (...args) {
    if (called) {
      return;
    }
    called = true;
    fn(...args);
  };
}

export function empty(obj) {
  for (let key in obj) {
    return false;
  }
  return true;
}

export function easeInOut(v, a) {
  let va = pow(v, a);
  return va / (va + pow(1 - v, a));
}

export function easeIn(v, a) {
  return 2 * easeInOut(0.5 * v, a);
}

export function easeOut(v, a) {
  return 2 * easeInOut(0.5 + 0.5 * v, a) - 1;
}

export function clone(obj) {
  if (!obj) { // handle undefined
    return obj;
  }
  return JSON.parse(JSON.stringify(obj));
}

export function merge(dest, src) {
  for (let f in src) {
    dest[f] = src[f];
  }
  return dest;
}

export function has(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field);
}

export function defaults(dest, src) {
  for (let f in src) {
    if (!has(dest, f)) {
      dest[f] = src[f];
    }
  }
  return dest;
}

export function defaultsDeep(dest, src) {
  for (let f in src) {
    if (!has(dest, f)) {
      dest[f] = src[f];
    } else if (typeof dest[f] === 'object') {
      defaultsDeep(dest[f], src[f]);
    }
  }
  return dest;
}

export function cloneShallow(src) {
  return merge({}, src);
}

export function deepEqual(a, b) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let ii = 0; ii < a.length; ++ii) {
      if (!deepEqual(a[ii], b[ii])) {
        return false;
      }
    }
    return true;
  } else if (typeof a === 'object') {
    if (typeof b !== 'object') {
      return false;
    }
    if (!a || !b) { // at least one is null
      return !a && !b; // equal if both are null
    }
    for (let key in a) {
      // b must have key, or both a[key] and b[key] are undefined
      if (!deepEqual(a[key], b[key])) {
        return false;
      }
    }
    for (let key in b) {
      // if b has key and it's defined, a must also be defined (and would have checked equality above)
      if (b[key] !== undefined && a[key] === undefined) {
        return false;
      }
    }
    return true;
  }
  return a === b;
}

export function deepAdd(dest, src) {
  assert(dest && src);
  for (let key in src) {
    let value = src[key];
    if (typeof value === 'object') {
      let dest_sub = dest[key] = dest[key] || {};
      assert.equal(typeof dest_sub, 'object');
      deepAdd(dest_sub, value);
    } else {
      dest[key] = (dest[key] || 0) + value;
    }
  }
}

export function clamp(v, mn, mx) {
  return min(max(mn, v), mx);
}

export function lerp(a, v0, v1) {
  return (1 - a) * v0 + a * v1;
}

export function mix(v0, v1, a) { // GLSL semantics
  return (1 - a) * v0 + a * v1;
}

export function map01(number,in_min, in_max) {
  return (number - in_min) / (in_max - in_min);
}

export function sign(a) {
  return a < 0 ? -1 : a > 0 ? 1 : 0;
}

export function mod(a, n) {
  return ((a % n) + n) % n;
}

// log2 rounded up to nearest integer
export function log2(val) {
  for (let ii=1, jj=0; ; ii <<= 1, ++jj) {
    if (ii >= val) {
      return jj;
    }
  }
}

export function ridx(arr, idx) {
  arr[idx] = arr[arr.length - 1];
  arr.pop();
}

export function round100(a) {
  return round(a * 100) / 100;
}

export function round1000(a) {
  return round(a * 1000) / 1000;
}

export function fract(a) {
  return a - floor(a);
}

export function nearSame(a, b, tol) {
  return abs(b - a) <= tol;
}

export function titleCase(str) {
  return str.split(' ').map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

const EPSILON = 0.00001;

// http://local.wasp.uwa.edu.au/~pbourke/geometry/sphereline/
export function lineCircleIntersect(p1, p2, pCircle, radius) {
  let dp = [
    p2[0] - p1[0],
    p2[1] - p1[1]
  ];
  let a = dp[0] * dp[0] + dp[1] * dp[1];
  let b = 2 * (dp[0] * (p1[0] - pCircle[0]) + dp[1] * (p1[1] - pCircle[1]));
  let c = pCircle[0] * pCircle[0] + pCircle[1] * pCircle[1];
  c += p1[0] * p1[0] + p1[1] * p1[1];
  c -= 2 * (pCircle[0] * p1[0] + pCircle[1] * p1[1]);
  c -= radius * radius;
  let bb4ac = b * b - 4 * a * c;
  if (abs(a) < EPSILON || bb4ac < 0) {
    return false;
  }

  let mu1 = (-b + sqrt(bb4ac)) / (2 * a);
  let mu2 = (-b - sqrt(bb4ac)) / (2 * a);
  if (mu1 >= 0 && mu1 <= 1 || mu2 >= 0 && mu2 <= 1) {
    return true;
  }

  return false;
}

export function inherits(ctor, superCtor) {
  // From Node.js
  assert(typeof superCtor === 'function');
  let ctor_proto_orig = ctor.prototype;
  // not needed? ctor.super_ = superCtor; // eslint-disable-line no-underscore-dangle
  // second parameter also not actually needed, just defines new Foo().constructor === Foo?
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
  // If anything had been added to the prototype (only in the case of late/double
  //   inheritance), add it
  for (let key in ctor_proto_orig) {
    ctor.prototype[key] = ctor_proto_orig[key];
  }
}

export function isPowerOfTwo(n) {
  return ((n & (n - 1)) === 0);
}

export function nextHighestPowerOfTwo(x) {
  --x;
  for (let i = 1; i < 32; i <<= 1) {
    x |= x >> i;
  }
  return x + 1;
}

export function logdata(data) {
  if (data === undefined) {
    return '';
  }
  let r = JSON.stringify(data);
  if (r.length < 120) {
    return r;
  }
  return `${r.slice(0, 120-3)}...(${r.length})`;
}

export function isInteger(v) {
  return typeof v === 'number' && isFinite(v) && floor(v) === v;
}

export function toNumber(v) {
  return Number(v);
}

export function randomNot(not_value, max_value) {
  let new_value;
  do {
    new_value = floor(random() * max_value);
  } while (new_value === not_value);
  return new_value;
}

export function toArray(array_like) {
  return Array.prototype.slice.call(array_like);
}

export function arrayToSet(array) {
  let ret = Object.create(null);
  for (let ii = 0; ii < array.length; ++ii) {
    ret[array[ii]] = true;
  }
  return ret;
}

export function matchAll(str, re) {
  let ret = [];
  let m;
  do {
    m = re.exec(str);
    if (m) {
      ret.push(m[1]);
    }
  } while (m);
  return ret;
}

export function callEach(arr, pre_clear, ...args) {
  if (arr && arr.length) {
    for (let ii = 0; ii < arr.length; ++ii) {
      arr[ii](...args);
    }
  }
}

// The characters cause problems with lower level systems (Google Firestore)
// that presumably try to convert to UTF-16.
// const utf16_surrogates = /[\uD800-\uDFFF]/g;

// "Bad" whitespace characters not caught by .trim()
// Found by running:
//   require('somefont.json').char_infos.filter(a=>String.fromCharCode(a.c).trim()).filter(a=>!a.w).map(a=a.c)
// const bad_whitespace = /[\x00-\x1F\x7F\u1D54\u1D55\u2000-\u200F\u205F-\u206F\uFE00]/g;

// eslint-disable-next-line no-control-regex, no-misleading-character-class
const sanitize_regex = /[\uD800-\uDFFF\x00-\x1F\x7F\u1D54\u1D55\u2000-\u200F\u205F-\u206F\uFE00]/g;
export function sanitize(str) {
  return (str || '').replace(sanitize_regex, '');
}

export function plural(number, label) {
  return `${label}${number === 1 ? '' : 's'}`;
}

export function secondsToFriendlyString(seconds, force_include_seconds) {
  let days = floor(seconds / (60*60*24));
  seconds -= days * 60*60*24;
  let hours = floor(seconds / (60*60));
  seconds -= hours * 60*60;
  let minutes = floor(seconds / 60);
  seconds -= minutes * 60;
  let resp = [];
  if (days) {
    let years = floor(days / 365.25);
    if (years) {
      days -= floor(years * 365.25);
      resp.push(`${years} ${plural(years, 'year')}`);
    }
    resp.push(`${days} ${plural(days, 'day')}`);
  }
  if (hours) {
    resp.push(`${hours} ${plural(hours, 'hour')}`);
  }
  if (minutes || !resp.length) {
    resp.push(`${minutes} ${plural(minutes, 'minute')}`);
  }
  if (force_include_seconds) {
    resp.push(`${seconds} ${plural(seconds, 'second')}`);
  }
  return resp.join(', ');
}

export function secondsSince2020() {
  // Seconds since Jan 1st, 2020
  return floor(Date.now() / 1000) - 1577836800;
}

export function dateToSafeLocaleString(date) {
  // Uses toString as a fallback since some browsers do not properly detect default locale.
  let date_text;
  try {
    date_text = date.toLocaleString();
  } catch (e) {
    console.error(e, '(Using toString as fallback)');
    date_text = date.toString();
  }
  return date_text;
}

let sw = {}; // Stop words map
sw.am = sw.an = sw.and = sw.as = sw.at = sw.be = sw.by = sw.el =
  sw.for = sw.in = sw.is = sw.la = sw.las = sw.los = sw.of = sw.on =
  sw.or = sw.the = sw.that = sw.this = sw.to = sw.with = true;
/**
 * Removes single char and stop words from the string array.
 * @param {string[]} string_array Array of strings to filter out single char
 * @returns {string[]} Filter string array with single char and stop words removed
 */
export function cleanupStringArray(string_array) {
  return string_array.filter((s) => (s.length > 1) && (s.length <= 32) && !sw[s]);
}

/**
 * Return an array of the string splits after transforming to lowercase and trimming whitespaces on each of the split.
 * Punctuations and symbols are also filtered.
 * Also removes single char and stopwords via cleanupStringArray.
 * @param {string[]} string String to use to form the string split result
 * @param {string} pattern String pattern to divide the string on
 * @returns {string[]} String split result
 */
export function cleanStringSplit(string, pattern) {
  // remove punctuations and symbols; e.g., 'In!@£$%^&*()_+sane Wo`{}[]|/?\'"rld;:<>s,.' = 'Insane Worlds'
  const base = sanitize(string).replace(/[.,/\\@#£!$%^&*;:<>{}|?=\-+_`'"~[\]()]/g,'').replace(/\s{1,}/g,' ');
  return cleanupStringArray(base.toLowerCase().split(pattern).map((s) => s.trim()));
}

export function eatPossiblePromise(p) {
  // On some browsers, some APIs return Promises where they did not before,
  //   wrap in this to discard any exceptions / rejections from these.
  //   For example, pointerLockEnter, throws "Uncaught UnknownError" on Chrome on
  //   Android, as well as triggering pointerlockerror.
  if (p && p.catch) {
    p.catch(nop);
  }
}

export function errorString(e) { // function errorString(e : Error | object | string) : string {
  let msg = String(e);
  if (msg === '[object Object]') {
    try {
      msg = JSON.stringify(e);
    } catch (ignored) {
      // ignored
    }
  }
  if (e && e.stack && e.message) {
    // Error object or similar
    // Just grabbing the message, but could do something with the stack similar to error handler in bootstrap.js
    msg = String(e.message);
  }
  msg = msg.slice(0, 600); // Not too huge
  return msg;
}

export function deprecate(exports, field, replacement) {
  Object.defineProperty(exports, field, {
    get: function () {
      assert(false, `${field} is deprecated, use ${replacement} instead`);
      return undefined;
    }
  });
}
