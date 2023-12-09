// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Originally from Splody, used with permission
/* eslint no-multi-spaces:off, array-bracket-spacing:off */

const assert = require('assert');
const { max } = Math;

const trans_src = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+';
const trans_dst = '4bcd3fgh1jk1mn0pqr57uvwxy24bcd3fgh1jk1mn0pqr57uvwxy201234567897';
const trans_src_regex = /\S+/g;
let trans_lookup = {};
const unicode_replacement_chars = {};
function cannonizeCharacter(c) {
  c = unicode_replacement_chars[c] || c;
  return trans_lookup[c] || '';
}
function canonize(str) {
  return str.split('').map(cannonizeCharacter).join('');
}

function rot13(str) {
  return str.split('').map((c) => {
    c = c.charCodeAt(0);
    if (c >= 97/*a*/ && c <= 122/*z*/) {
      c = 97 + (((c - 97) + 13) % 26);
    } else if (c >= 65/*A*/ && c <= 90/*Z*/) {
      c = 65 + (((c - 65) + 13) % 26);
    }
    return String.fromCharCode(c);
  }).join('');
}

let profanity = {};
let reserved = {};

// shorter first, if substrings (just 's' and 'es'/'ers')
let suffixes =           [ '', 's',  's', 'in', 'ing', 'er', 'ers', 'ed', 'y' ];
let suffixes_canonized = [ '', '5', '35', '1n', '1ng', '3r', '3r5', '3d', 'y' ];

let max_len = 0;
let inited = false;
// filter_gkg is rot13 of (singular) words to filter
// exceptions_txt is includes specific words that should not be filtered (e.g.
//   a common word that looks like a plural of a filtered word)
export function profanityCommonStartup(filter_gkg, exceptions_txt) {
  assert(!inited);
  inited = true;
  for (let ii = 0; ii < trans_src.length; ++ii) {
    trans_lookup[trans_src[ii]] = trans_dst[ii];
  }
  let data = filter_gkg.split('\n').filter((a) => a);
  for (let ii = 0; ii < data.length; ++ii) {
    let s = rot13(data[ii]);
    let start_len = s.length;
    s = canonize(s);
    assert.equal(start_len, s.length); // Otherwise got a bad character in the source data?
    for (let jj = 0; jj < suffixes_canonized.length; ++jj) {
      let str = s + suffixes_canonized[jj];
      let existing = profanity[str];
      if (!existing || existing > jj) {
        max_len = max(max_len, str.length);
        profanity[str] = jj + 1;
      }
    }
  }
  data = exceptions_txt.split('\n').filter((a) => a);
  for (let ii = 0; ii < data.length; ++ii) {
    delete profanity[canonize(data[ii])];
  }
}

export function profanitySetReplacementChars(replacement_chars) {
  assert(replacement_chars);
  for (let char_code_str in replacement_chars) {
    let target = replacement_chars[char_code_str];
    target = String.fromCharCode(target);
    let source = String.fromCharCode(Number(char_code_str));
    if (target === ' ') {
      if (source.trim() !== '') {
        // Replacing with space, but Javascript does not treat it as whitespace, do not allow
        console.log(`Invalid whitespace replacement character: ${char_code_str}`);
        continue;
      }
    }
    unicode_replacement_chars[source] = target;
  }
}

let reserved_substrings = [];
export function reservedStartup(reserved_txt, reserved_substrings_in) {
  let data = reserved_txt.split('\n').filter((a) => a);
  for (let i = 0; i < data.length; ++i) {
    let string = canonize(data[i]);
    reserved[string] = 1;
  }
  for (let ii = 0; ii < reserved_substrings_in.length; ++ii) {
    reserved_substrings.push(canonize(reserved_substrings_in[ii]));
  }
}

let randWord;
function filterWord(word_src) {
  if (word_src.length >= max_len) {
    return word_src;
  }

  let is_uppercase = word_src[0].toUpperCase() === word_src[0];
  let word_canon = canonize(word_src);
  let suffix_idx = profanity[word_canon];
  // do lookup, replace
  if (!suffix_idx) {
    return word_src;
  }
  --suffix_idx;
  let word = randWord();
  if (is_uppercase) {
    word = word[0].toUpperCase() + word.slice(1);
  }
  let suffix = suffixes[suffix_idx];
  if (word[word.length - 1] === suffix[0]) { // e.g. replacement word ends in an 'e'
    suffix = suffix.slice(1);
  }
  if (word.endsWith('e') && suffix[0] === 'i') {
    word = word.slice(0, -1);
  }
  word += suffix;
  return word;
}

let is_profane;
function checkWord(word_src) {
  if (word_src.length >= max_len) {
    return;
  }

  if (profanity[canonize(word_src)]) {
    is_profane = true;
  }
}

export function profanityFilterCommon(user_str, rand_word_fn) {
  assert(inited);
  randWord = rand_word_fn;
  return user_str.replace(trans_src_regex, filterWord);
}

export function isProfane(user_str) {
  assert(inited);
  is_profane = false;
  user_str.replace(trans_src_regex, checkWord);
  return is_profane;
}

let is_reserved;
function checkReserved(word_src) {
  word_src = canonize(word_src);
  if (reserved[word_src]) {
    is_reserved = true;
  }
  for (let ii = 0; ii < reserved_substrings.length; ++ii) {
    if (word_src.includes(reserved_substrings[ii])) {
      is_reserved = true;
    }
  }
}

export function isReserved(user_str) {
  assert(inited);
  is_reserved = false;
  user_str.replace(trans_src_regex, checkReserved);
  let no_whitespace = canonize(user_str.replace(/[\s_.]/g, ''));
  for (let ii = 0; ii < reserved_substrings.length; ++ii) {
    if (no_whitespace.includes(reserved_substrings[ii])) {
      is_reserved = true;
    }
  }
  return is_reserved;
}
