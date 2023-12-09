// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import { fontSetReplacementChars } from 'glov/client/font';
import { randFastCreate } from 'glov/client/rand_fast';
import { getURLBase } from 'glov/client/urlhash';
import { webFSGetFile } from 'glov/client/webfs';
import { mashString } from 'glov/common/rand_alea';
import {
  profanityCommonStartup,
  profanityFilterCommon,
  profanitySetReplacementChars,
} from 'glov/common/words/profanity_common';

let non_profanity;

export function profanityStartup() {
  non_profanity = webFSGetFile('words/replacements.txt', 'text').split('\n').filter((a) => a);
  profanityCommonStartup(webFSGetFile('words/filter.gkg', 'text'),
    webFSGetFile('words/exceptions.txt', 'text'));

}

export function profanityStartupLate() {
  // Async load of (potentially large) unicode replacement data, after all other loading is finished
  let scriptTag = document.createElement('script');
  scriptTag.src = `${getURLBase()}replacement_chars.min.js`;
  scriptTag.onload = function () {
    if (window.unicode_replacement_chars) {
      profanitySetReplacementChars(window.unicode_replacement_chars);
      fontSetReplacementChars(window.unicode_replacement_chars);
    }
  };
  document.getElementsByTagName('head')[0].appendChild(scriptTag);
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
