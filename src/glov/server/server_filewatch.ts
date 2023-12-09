import assert from 'assert';
import { serverFSdeleteCached } from './serverfs';

type FilewatchCB = (filename: string) => void;

let always: FilewatchCB[] = [];
let by_ext: Partial<Record<string, FilewatchCB>> = {};
let by_match: [RegExp | string, FilewatchCB][] = [];

// cb(filename)
export function serverFilewatchOn(ext_or_search: RegExp | string, cb: FilewatchCB): void {
  if (!ext_or_search) {
    always.push(cb); // also guaranteed to run first
  } else if (typeof ext_or_search === 'string' && ext_or_search[0] === '.') {
    assert(!by_ext[ext_or_search]);
    by_ext[ext_or_search] = cb;
  } else {
    by_match.push([ext_or_search, cb]);
  }
}

function serverOnFileChange(filename: string): void {
  console.log(`Server FileWatch change: ${filename}`);
  for (let ii = 0; ii < always.length; ++ii) {
    always[ii](filename);
  }
  let ext_idx = filename.lastIndexOf('.');
  if (ext_idx !== -1) {
    let cb = by_ext[filename.slice(ext_idx)];
    if (cb) {
      cb(filename);
    }
  }
  for (let ii = 0; ii < by_match.length; ++ii) {
    if (filename.match(by_match[ii][0])) {
      by_match[ii][1](filename);
    }
  }
}

export function serverFilewatchTriggerChange(filename: string): void {
  serverOnFileChange(filename);
}

serverFilewatchOn('', serverFSdeleteCached);
