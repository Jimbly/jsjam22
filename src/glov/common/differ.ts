import assert from 'assert';
import { DataObject, isDataObject } from 'glov/common/types';
import { clone } from 'glov/common/util';
import { dotPropDelete, dotPropSet } from './dot-prop';
import { Packet } from './packet';

const { max } = Math;

export type DiffElem = [string, unknown?];
export type Diff = DiffElem[];

export function typeof2(obj: unknown): 'null' | 'undefined' | 'number' | 'string' | 'object' | 'array' | 'boolean' {
  if (obj === null) {
    return 'null';
  }
  let plain = typeof obj;
  assert(plain !== 'bigint' && plain !== 'symbol' && plain !== 'function');
  if (!obj) {
    return plain; // undefined, number, string, boolean
  }
  if (plain === 'object' && Array.isArray(obj)) {
    return 'array';
  }
  return plain; // object, number, string, boolean
}

function path(path_pre: string, key: string | number): string {
  return path_pre ? `${path_pre}.${key}` : String(key);
}

// Fills in Diffs
// Returns a new object that is either references to `data_old` or a _clone_
//   of `data_new`, there will be no persistent references to any member of
//   data_new.
function walk(diff: Diff, path_pre: string, data_old: unknown, data_new: unknown): unknown {
  let type = typeof2(data_old);
  if (type !== typeof2(data_new)) {
    // Types changed, probably one is now undefined
    if (data_new === undefined) {
      diff.push([path_pre]);
    } else {
      data_new = clone(data_new);
      diff.push([path_pre, data_new]);
    }
    return data_new;
  }

  let diff_start = diff.length;
  if (type === 'object') {
    assert(isDataObject(data_old));
    assert(isDataObject(data_new));
    let seen = Object.create(null);
    let ret: Partial<Record<string, unknown>> = {};
    for (let key in data_old) {
      seen[key] = true;
      // deletes, modifications
      let new_value = walk(diff, path(path_pre, key), data_old[key], data_new[key]);
      if (new_value !== undefined) {
        ret[key] = new_value;
      }
    }
    for (let key in data_new) {
      if (!seen[key]) {
        // additions
        ret[key] = walk(diff, path(path_pre, key), data_old[key], data_new[key]);
      }
    }
    return diff_start === diff.length ? data_old : ret;
  } else if (type === 'array') {
    assert(Array.isArray(data_old));
    assert(Array.isArray(data_new));
    let maxlen = max(data_old.length, data_new.length);
    let ret: unknown[] = new Array(data_new.length);
    for (let ii = 0; ii < maxlen; ++ii) {
      let new_value = walk(diff, path(path_pre, ii), data_old[ii], data_new[ii]);
      if (ii < data_new.length) {
        ret[ii] = new_value;
      } else {
        assert.equal(new_value, undefined);
      }
    }
    if (data_new.length < data_old.length) {
      diff.push([path(path_pre, 'length'), data_new.length]);
    }
    return diff_start === diff.length ? data_old : ret;
  } else {
    // string, number, boolean (value change)
    if (data_old !== data_new) {
      diff.push([path_pre, data_new]);
      return data_new;
    }
    return data_old;
  }
}

export type DifferOpts = {
  history_size?: number;
};
export type Differ = DifferImpl;
class DifferImpl {
  data_last: unknown;
  history_size: number;
  history: unknown[] = [];
  history_idx = 0; // where the next state will be placed
  history_max = -1; // last filled history slot
  constructor(data: unknown, opts: DifferOpts) {
    this.data_last = clone(data);
    this.history_size = opts.history_size || 0;
    if (this.data_last) {
      this.historyPush();
    }
  }
  private historyPush(): void {
    if (this.history_size) {
      this.history_max = this.history_idx;
      this.history[(this.history_idx++) % this.history_size] = this.data_last;
    }
  }
  update(data: unknown): Diff {
    let diff: Diff = [];
    let data_next = walk(diff, '', this.data_last, data);
    if (diff.length) {
      this.data_last = data_next;
      this.historyPush();
    }
    // extra verification:
    // assert(deepEqual(this.data_last, data));
    // assert(deepEqual(this.history[(this.history_idx - 1) % this.history_size], data));
    return diff;
  }

  canUndo(): boolean {
    return this.history_idx > 1 && this.history_max - this.history_idx < this.history_size - 2;
  }
  canRedo(): boolean {
    return this.history_idx <= this.history_max;
  }
  undo(): [Diff, unknown] {
    assert(this.canUndo());
    --this.history_idx;
    let ret = this.history[(this.history_idx - 1) % this.history_size];
    let diff: Diff = [];
    walk(diff, '', this.data_last, ret);
    assert(diff.length);
    this.data_last = ret;
    return [diff, clone(ret)];
  }
  redo(): [Diff, unknown] {
    assert(this.canRedo());
    ++this.history_idx;
    let ret = this.history[(this.history_idx - 1) % this.history_size];
    let diff: Diff = [];
    walk(diff, '', this.data_last, ret);
    assert(diff.length);
    this.data_last = ret;
    return [diff, clone(ret)];
  }
}

export function differCreate(data: DataObject, opts: DifferOpts): Differ {
  return new DifferImpl(data, opts);
}

export function diffApply(data: DataObject, diff: Diff): void {
  for (let ii = 0; ii < diff.length; ++ii) {
    let [key, value] = diff[ii];
    if (value === undefined) {
      dotPropDelete(data, key);
    } else {
      dotPropSet(data, key, value);
    }
  }
}

export function diffPacketWrite(pak: Packet, diff: Diff): void {
  for (let ii = 0; ii < diff.length; ++ii) {
    let elem = diff[ii];
    pak.writeAnsiString(elem[0]);
    pak.writeJSON(elem[1]);
  }
  pak.writeAnsiString('');
}

export function diffPacketRead(pak: Packet): Diff {
  let ret: Diff = [];
  let key;
  while ((key = pak.readAnsiString())) {
    let value = pak.readJSON();
    if (value === undefined) {
      ret.push([key]);
    } else {
      ret.push([key, value]);
    }
  }
  return ret;
}
