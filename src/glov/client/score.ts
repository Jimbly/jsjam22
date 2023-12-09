// Portions Copyright 2023 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint-env browser */

import assert from 'assert';
import { executeWithRetry } from 'glov/common/execute_with_retry';
import {
  callEach,
  nop,
} from 'glov/common/util';
import { fetch } from './fetch';

import type {
  ErrorCallback,
  NetErrorCallback,
  VoidFunc,
} from 'glov/common/types';

const PLAYER_NAME_KEY = 'ld.player_name';
const USERID_KEY = 'score.userid';
const SCORE_REFRESH_TIME = 5*60*1000; // also refreshes if we submit a new score, or forceRefreshScores() is called
const SUBMIT_RATELIMIT = 5000; // Only kicks in if two are in-flight at the same time

let player_name: string = '';
let lsd = (function (): Partial<Record<string, string>> {
  try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
    return localStorage;
  } catch (e) {
    return {};
  }
}());

if (lsd[PLAYER_NAME_KEY]) {
  player_name = lsd[PLAYER_NAME_KEY]!;
}

let score_host = 'http://scores.dashingstrike.com';
if (window.location.host.indexOf('localhost') !== -1 ||
  window.location.host.indexOf('staging') !== -1/* ||
  window.location.host.indexOf('pink') !== -1*/
) {
  score_host = 'http://scores.staging.dashingstrike.com';
}
if (window.location.href.startsWith('https://')) {
  score_host = score_host.replace(/^http:/, 'https:');
}
export function scoreGetPlayerName(): string {
  return player_name;
}

function fetchJSON2<T>(url: string, cb: (err: string | undefined, o: T) => void): void {
  fetch({
    url: url,
    response_type: 'json',
  }, (err: string | undefined, resp: unknown) => {
    cb(err, resp as T);
  });
}

function fetchJSON2Timeout<T>(url: string, timeout: number, cb: (err: string | undefined, o: T) => void): void {
  fetch({
    url: url,
    response_type: 'json',
    timeout,
  }, (err: string | undefined, resp: unknown) => {
    cb(err, resp as T);
  });
}


let allocated_user_id: string | null = null;
type UserIDCB = (user_id: string) => void;
let user_id_fetch_cbs: UserIDCB[] | null = null;
type UserAllocResponse = { userid: string };
function withUserID(f: UserIDCB): void {
  if (allocated_user_id === null && lsd[USERID_KEY]) {
    allocated_user_id = lsd[USERID_KEY]!;
    console.log(`Using existing ScoreAPI UserID: "${allocated_user_id}"`);
  }
  if (allocated_user_id !== null) {
    return f(allocated_user_id);
  }
  if (user_id_fetch_cbs !== null) {
    user_id_fetch_cbs.push(f);
    return;
  }
  user_id_fetch_cbs = [f];
  let url = `${score_host}/api/useralloc`;
  function fetchUserID(next: ErrorCallback<string, string>): void {
    fetchJSON2Timeout<UserAllocResponse>(url, 20000, function (err: string | undefined, res: UserAllocResponse) {
      if (err) {
        return next(err);
      }
      assert(res);
      assert(res.userid);
      assert.equal(typeof res.userid, 'string');
      next(null, res.userid);
    });
  }
  function done(err?: string | null, result?: string | null): void {
    assert(!err);
    assert(result);
    allocated_user_id = result;
    lsd[USERID_KEY] = result;
    console.log(`Allocated new ScoreAPI UserID: "${allocated_user_id}"`);
    callEach(user_id_fetch_cbs, user_id_fetch_cbs = null, allocated_user_id);
  }
  executeWithRetry<string, string>(
    fetchUserID, {
      max_retries: Infinity,
      inc_backoff_duration: 250,
      max_backoff: 30000,
      log_prefix: 'ScoreAPI UserID fetch',
    },
    done,
  );
}

export type LevelName = string;
export type LevelDef = {
  name?: LevelName;
};
type ScoreTypeInternal<ScoreType> = ScoreType & {
  submitted?: boolean;
  payload?: string;
};
type LevelDefInternal<ScoreType> = {
  name: LevelName;
  local_score?: ScoreTypeInternal<ScoreType>; // internal to score system
  last_payload?: string;
  last_refresh_time?: number;
  refresh_in_flight?: boolean;
  save_in_flight?: boolean;
};
export type ScoreSystem<T> = ScoreSystemImpl<T>;
export type ScoreSystemParam<ScoreType> = {
  score_to_value: (s: ScoreType) => number;
  value_to_score: (v: number) => ScoreType;
  level_defs: LevelDef[] | number; // List of {name}s or just a number of (numerically indexed) levels
  score_key: string;
  ls_key?: string; // only if different than score_key (for migration)
  asc: boolean;
  rel?: number;
  num_names?: number;
};
type HighScoreListEntryRaw = {
  n?: string | string[]; // representative list of user display names
  s: number; // score value
  c?: number; // count of users at this score
  r?: number; // rank, if not implicit
};
type HighScoreListRaw = {
  total: number;
  my_rank?: number;
  list: HighScoreListEntryRaw[];
};
export type HighScoreListEntry<ScoreType> = {
  names: string[];
  names_str: string;
  count: number;
  rank: number;
  score: ScoreType;
};
export type HighScoreList<ScoreType> = {
  total: number;
  my_rank?: number;
  list: HighScoreListEntry<ScoreType>[];
};
class ScoreSystemImpl<ScoreType> {
  score_to_value: (s: ScoreType) => number;
  value_to_score: (v: number) => ScoreType;
  level_defs: LevelDefInternal<ScoreType>[];
  asc: boolean;
  rel: number;
  num_names: number;
  SCORE_KEY: string;
  LS_KEY: string;
  constructor(param: ScoreSystemParam<ScoreType>) {
    this.score_to_value = param.score_to_value;
    this.value_to_score = param.value_to_score;
    this.asc = param.asc;
    this.rel = param.rel || 20;
    this.num_names = param.num_names || 3;
    let level_defs: LevelDefInternal<ScoreType>[] = [];
    if (typeof param.level_defs === 'number') {
      for (let level_idx = 0; level_idx < param.level_defs; ++level_idx) {
        level_defs.push({
          name: '', // name filled below
        });
      }
    } else {
      for (let ii = 0; ii < param.level_defs.length; ++ii) {
        level_defs.push({
          name: param.level_defs[ii].name || '', // name filled below
        });
      }
    }
    this.level_defs = level_defs;

    this.SCORE_KEY = param.score_key;
    this.LS_KEY = param.ls_key || this.SCORE_KEY.toLowerCase();

    for (let level_idx = 0; level_idx < level_defs.length; ++level_idx) {
      let ld = level_defs[level_idx];
      if (!ld.name) {
        if (level_defs.length === 1) {
          ld.name = 'the';
        } else {
          ld.name = String(level_idx);
        }
      }
      this.getScore(level_idx); // fetch .local_score for updatePlayerName to take advantage of
    }
  }

  high_scores: Partial<Record<number, HighScoreList<ScoreType>>> = {};
  high_scores_raw: Partial<Record<number, HighScoreListRaw>> = {};
  getHighScores(level_idx: number): HighScoreList<ScoreType> | null {
    this.refreshScores(level_idx);
    return this.high_scores[level_idx] || null;
  }

  private handleScoreResp(level_idx: number, scores: HighScoreListRaw): void {
    this.high_scores_raw[level_idx] = scores;
    this.formatScoreResp(level_idx);
  }

  private formatScoreResp(level_idx: number): void {
    let scores = this.high_scores_raw[level_idx];
    assert(scores);

    let ret: HighScoreList<ScoreType> = {
      total: scores.total,
      my_rank: scores.my_rank,
      list: [],
    };
    let rank = 1;
    for (let ii = 0; ii < scores.list.length; ++ii) {
      let entry = scores.list[ii];
      let names = entry.n || [];
      if (typeof names === 'string') {
        names = [names];
      } else {
        names = names.slice(0);
      }
      let count = entry.c || 1;
      let this_rank = entry.r || rank;
      if (this_rank === scores.my_rank) {
        // Ensure own name is in list
        let my_name = scoreGetPlayerName();
        if (my_name && !names.includes(my_name)) {
          names.unshift(my_name);
          if (names.length > this.num_names) {
            names.pop();
          }
        }
      }
      if (!names.length) {
        // If unknown names, add at least one "Anonymous" to the list, so no entry is name-less
        names.push('Anonymous');
      }
      let names_str = names.join(', ');
      if (count > names.length) {
        names_str += `${names_str ? ', ' : ''}${count - names.length} ${names.length ? 'others' : 'users'}`;
      }
      ret.list.push({
        score: this.value_to_score(entry.s),
        names,
        names_str,
        count,
        rank: this_rank,
      });
      rank = this_rank + count;
    }

    this.high_scores[level_idx] = ret;
  }
  private makeURL(api: string, ld: LevelDef): string {
    assert(allocated_user_id);
    let url = `${score_host}/api/${api}?v2&key=${this.SCORE_KEY}.${ld.name}&userid=${allocated_user_id}`;
    if (this.rel) {
      url += `&rel=${this.rel}`;
    }
    if (this.num_names !== 3) {
      url += `&num_names=${this.num_names}`;
    }
    if (this.asc) {
      url += '&asc';
    }
    return url;
  }
  private refreshScores(level_idx: number, changed_cb?: VoidFunc): void {
    let ld = this.level_defs[level_idx];
    if (!ld) {
      ld = this.level_defs[level_idx] = {
        name: String(level_idx),
      };
    }
    if (ld.refresh_in_flight) {
      changed_cb?.();
      return;
    }
    let now = Date.now();
    if (!ld.last_refresh_time || now - ld.last_refresh_time > SCORE_REFRESH_TIME) {
      // do it
    } else {
      changed_cb?.();
      return;
    }
    ld.last_refresh_time = now;
    ld.refresh_in_flight = true;
    // Note: only technically need the `userid` if we have no locally saved
    //   score, are using `rel`, and expect to have a remotely saved score
    //   for our user ID (shouldn't actually ever happen on web)
    withUserID(() => {
      let url = this.makeURL('scoreget', ld);

      let my_score = ld.local_score ? this.score_to_value(ld.local_score) : null;
      if (my_score) {
        url += `&score=${my_score}`;
      }
      fetchJSON2(
        url,
        (err: string | undefined, scores: HighScoreListRaw) => {
          ld.refresh_in_flight = false;
          if (!err) {
            this.handleScoreResp(level_idx, scores);
          }
          changed_cb?.();
        }
      );
    });
  }

  forceRefreshScores(level_idx: number, timeout?: number): void {
    if (timeout === undefined) {
      timeout = 5000;
    }
    let ld = this.level_defs[level_idx];
    if (ld.last_refresh_time && ld.last_refresh_time < Date.now() - timeout) {
      // Old enough we can bump it up now
      ld.last_refresh_time = 0;
    }
    this.refreshScores(level_idx);
  }

  prefetchScores(level_idx: number): void {
    this.refreshScores(level_idx);
  }

  private submitScore(level_idx: number, score: ScoreType, payload?: string, cb?: NetErrorCallback): void {
    let ld = this.level_defs[level_idx];
    let high_score = this.score_to_value(score);
    withUserID(() => {
      let url = this.makeURL('scoreset', ld);
      url += `&score=${high_score}`;
      if (player_name) {
        url += `&name=${encodeURIComponent(player_name)}`;
      }
      if (payload) {
        let payload_part = `&payload=${encodeURIComponent(payload)}`;
        if (url.length + payload_part.length >= 2000) {
          payload_part = '&payload="truncated"';
        }
        url += payload_part;
        // if (payload.includes('ForceNetError')) {
        //   url = 'http://errornow.dashingstrike.com/scoreset/error';
        // }
      }
      fetchJSON2(
        url,
        (err: string | undefined, scores: HighScoreListRaw) => {
          if (!err) {
            this.handleScoreResp(level_idx, scores);
          }
          cb?.(err || null);
        },
      );
    });
  }

  private saveScore(level_idx: number, obj_in: ScoreType, payload?: string): void {
    let ld = this.level_defs[level_idx];
    let obj = obj_in as ScoreTypeInternal<ScoreType>;
    obj.payload = payload;
    ld.local_score = obj;
    let key = `${this.LS_KEY}.score_${ld.name}`;
    lsd[key] = JSON.stringify(obj);
    if (ld.save_in_flight) {
      return;
    }
    let doSubmit = (): void => {
      obj = ld.local_score!;
      this.submitScore(level_idx, obj, obj.payload, (err: string | null) => {
        ld.save_in_flight = false;
        if (!err) {
          obj.submitted = true;
        }
        if (obj === ld.local_score) {
          if (!err) {
            lsd[key] = JSON.stringify(obj);
          }
        } else {
          // new score in the meantime
          ld.save_in_flight = true;
          setTimeout(doSubmit, SUBMIT_RATELIMIT);
        }
      });
    };
    ld.save_in_flight = true;
    doSubmit();
  }

  hasScore(level_idx: number): boolean {
    return Boolean(this.getScore(level_idx));
  }

  getScore(level_idx: number): ScoreType | null {
    let ld = this.level_defs[level_idx];
    if (ld.local_score) {
      return ld.local_score; // allow calling each frame and getting cached version instead of spamming submits
    }
    let key = `${this.LS_KEY}.score_${ld.name}`;
    if (lsd[key]) {
      let ret = JSON.parse(lsd[key]!);
      if (!ret) {
        return null;
      }
      ld.local_score = ret;
      if (!ret.submitted) {
        this.saveScore(level_idx, ret, ret.payload);
      }
      return ret;
    }
    return null;
  }

  setScore(level_idx: number, score: ScoreType, payload?: string): void {
    let ld = this.level_defs[level_idx];
    let encoded = this.score_to_value(score) || 0;
    let encoded_local = ld.local_score && this.score_to_value(ld.local_score) || (this.asc ? Infinity : 0);
    if (this.asc ? encoded < encoded_local : encoded > encoded_local ||
      encoded === encoded_local && !ld.local_score?.submitted
    ) {
      this.saveScore(level_idx, score, payload);
    }
  }

  onUpdatePlayerName(old_name: string): void {
    for (let level_idx in this.high_scores_raw) {
      let level_idx_number = Number(level_idx);
      // Strip my old name from the cached responses
      let scores = this.high_scores_raw[level_idx_number];
      assert(scores);
      if (scores.my_rank) {
        let rank = 1;
        for (let ii = 0; ii < scores.list.length; ++ii) {
          let entry = scores.list[ii];
          let count = entry.c || 1;
          let this_rank = entry.r || rank;
          if (this_rank === scores.my_rank) {
            let n = entry.n;
            if (n) {
              if (typeof n === 'string') {
                n = [n];
              }
              let idx = n.indexOf(old_name);
              if (idx !== -1) {
                n.splice(idx, 1);
                entry.n = n;
              }
            }
          }
          rank = this_rank + count;
        }
      }
      // Reformat and add new name
      this.formatScoreResp(level_idx_number);
    }
  }
}


let all_score_systems: ScoreSystem<any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

export function scoreAlloc<ScoreType>(param: ScoreSystemParam<ScoreType>): ScoreSystem<ScoreType> {
  withUserID(nop);
  let ret = new ScoreSystemImpl(param);
  all_score_systems.push(ret);
  return ret;
}

export function scoreFormatName<ScoreType>(score: HighScoreListEntry<ScoreType>): string {
  return score.names_str;
}

export function scoreUpdatePlayerName(new_player_name: string): void {
  if (new_player_name) {
    new_player_name = new_player_name.trim().slice(0, 64); // same logic as on server
  }
  if (new_player_name === player_name || !new_player_name) {
    return;
  }
  let old_name = player_name;
  lsd[PLAYER_NAME_KEY] = player_name = new_player_name;

  withUserID((user_id: string) => {
    let url = `${score_host}/api/userrename?userid=${user_id}&name=${encodeURIComponent(player_name)}`;
    fetch({
      url,
    }, (err: string | undefined, res: string) => {
      if (err) {
        if (res) {
          try {
            err = JSON.parse(res).err || err;
          } catch (e) {
            // ignoored
          }
        }
        lsd[PLAYER_NAME_KEY] = player_name = old_name;
        alert(`Error updating player name: "${err}"`); // eslint-disable-line no-alert
      } else {
        for (let ii = 0; ii < all_score_systems.length; ++ii) {
          all_score_systems[ii].onUpdatePlayerName(old_name);
        }
      }
    });
  });
}
