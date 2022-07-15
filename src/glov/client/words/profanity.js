// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Originally from Splody, used with permission
/* eslint no-multi-spaces:off, array-bracket-spacing:off */

/* eslint-disable import/order */
const { mashString } = require('glov/common/rand_alea.js');
const { randFastCreate } = require('glov/client/rand_fast.js');
const { profanityFilterCommon, profanityCommonStartup } = require('glov/common/words/profanity_common.js');
const { webFSGetFile } = require('glov/client/webfs.js');

let non_profanity;

export function profanityStartup() {
  non_profanity = webFSGetFile('words/replacements.txt', 'text').split('\n').filter((a) => a);
  profanityCommonStartup(webFSGetFile('words/filter.gkg', 'text'),
    webFSGetFile('words/exceptions.txt', 'text'));
}

let rand = randFastCreate();

let last_word;
function randWord() {
  if (last_word === -1 || non_profanity.length === 1) {
    last_word = rand.range(non_profanity.length);
  } else {
    let choice = rand.range(non_profanity.length - 1);
    last_word = choice < last_word ? choice : choice + 1;
  }
  return non_profanity[last_word];
}

export function profanityFilter(user_str) {
  last_word = -1;
  rand.seed = mashString(user_str);
  return profanityFilterCommon(user_str, randWord);
}
