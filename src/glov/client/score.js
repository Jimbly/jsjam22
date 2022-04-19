// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint-env browser */

const assert = require('assert');
const PLAYER_NAME_KEY = 'ld.player_name';

export let need_update = false;

export let player_name;
if (localStorage[PLAYER_NAME_KEY]) {
  player_name = localStorage[PLAYER_NAME_KEY];
} else {
  // eslint-disable-next-line newline-per-chained-call
  localStorage[PLAYER_NAME_KEY] = player_name = `Anonymous ${Math.random().toString().slice(2, 8)}`;
}

let score_host = 'http://scores.dashingstrike.com';
if (window.location.host.indexOf('localhost') !== -1 ||
  window.location.host.indexOf('staging') !== -1) {
  score_host = 'http://scores.staging.dashingstrike.com';
}
if (window.location.href.startsWith('https://')) {
  score_host = score_host.replace(/^http:/, 'https:');
}
let parseHighScore;
let encodeScore;
let level_defs;
let SCORE_KEY;
let LS_KEY;
export function init(scoreToValue, valueToScore, lds, score_key) {
  parseHighScore = valueToScore;
  encodeScore = scoreToValue;
  level_defs = lds;
  SCORE_KEY = score_key;
  LS_KEY = SCORE_KEY.toLowerCase();

  for (let level_idx in level_defs) {
    // eslint-disable-next-line no-use-before-define
    getScore(level_idx); // fetch .local_score for updatePlayerName to take advantage of
  }
}
export function formatName(score) {
  if (score.name.indexOf('Anonymous') === 0) {
    return score.name.slice(0, 'Anonymous'.length);
  }
  return score.name;
}

function fetchJSON(param) {
  assert(param.url);
  let xhr = new XMLHttpRequest();
  xhr.open('GET', param.url, true);
  xhr.responseType = 'json';
  if (param.success) {
    xhr.onload = () => {
      param.success(xhr.response);
    };
  }
  if (param.error) {
    xhr.onerror = param.error;
  }
  xhr.send(null);

}

let num_highscores = 20000;
let score_update_time = 0;
export let high_scores = {};
function refreshScores(level, changed_cb) {
  fetchJSON({
    url: `${score_host}/api/scoreget?key=${SCORE_KEY}.${level}&limit=${num_highscores}`,
    success: function (scores) {
      let list = [];
      scores.forEach(function (score) {
        score.score = parseHighScore(score.score);
        list.push(score);
      });
      high_scores[level] = list;
      if (changed_cb) {
        changed_cb();
      }
    }
  });
}


function clearScore(level, old_player_name, cb) {
  if (!old_player_name) {
    return;
  }
  fetchJSON({ url: `${score_host}/api/scoreclear?key=${SCORE_KEY}.${level}&name=${old_player_name}`, success: cb });
}

function submitScore(level, score, cb) {
  let high_score = encodeScore(score);
  if (!player_name) {
    return;
  }
  fetchJSON({
    url: `${score_host}/api/scoreset?key=${SCORE_KEY}.${level}&name=${player_name}&score=${high_score}`,
    success: function (scores) {
      let list = [];
      scores.forEach(function (score_it) {
        score_it.score = parseHighScore(score_it.score);
        list.push(score_it);
      });
      high_scores[level] = list;
      if (cb) {
        cb();
      }
    }
  });
}

export function updateHighScores(changed_cb) {
  let now = Date.now();
  if (now - score_update_time > 5*60*1000 || need_update) {
    need_update = false;
    score_update_time = now;
    for (let level_idx in level_defs) {
      refreshScores(level_defs[level_idx].name, changed_cb);
    }
  } else {
    if (changed_cb) {
      changed_cb();
    }
  }
}


function saveScore(ld, obj, cb) {
  ld.local_score = obj;
  let key = `${LS_KEY}.score_${ld.name}`;
  localStorage[key] = JSON.stringify(obj);
  submitScore(ld.name, obj, function () {
    obj.submitted = true;
    if (obj === ld.local_score) {
      localStorage[key] = JSON.stringify(obj);
    }
    if (cb) {
      cb();
    }
  });
}

export function getScore(level_idx) {
  let ld = level_defs[level_idx];
  if (ld.local_score) {
    return ld.local_score; // allow calling each frame and getting cached version instead of spamming submits
  }
  let key = `${LS_KEY}.score_${ld.name}`;
  if (localStorage && localStorage[key]) {
    let ret = JSON.parse(localStorage[key]);
    if (!ret) {
      return null;
    }
    ld.local_score = ret;
    if (!ret.submitted) {
      saveScore(ld, ret);
    }
    return ret;
  }
  return null;
}

export function setScore(level_idx, score, cb) {
  let ld = level_defs[level_idx];
  let encoded = encodeScore(score) || 0;
  let encoded_local = ld.local_score && encodeScore(ld.local_score) || 0;
  if (encoded > encoded_local) {
    saveScore(ld, score, cb);
  }
}

export function updatePlayerName(new_player_name) {
  if (new_player_name === player_name) {
    return;
  }
  let old_name = player_name;
  localStorage[PLAYER_NAME_KEY] = player_name = new_player_name;

  function update(ld) {
    if (ld.local_score) {
      if (old_name.indexOf('Anonymous') === 0) {
        // Only wiping old scores if anonymous, so we can't delete other people's scores!
        clearScore(ld.name, old_name, function () {
          saveScore(ld, ld.local_score, function () {
            need_update = true;
          });
        });
      }
    }
  }
  for (let level_idx in level_defs) {
    update(level_defs[level_idx]);
  }
}
