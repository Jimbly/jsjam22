import assert from 'assert';

import type { FSAPI, FilewatchCB } from 'glov/common/fsapi';
import type { DataObject } from 'glov/common/types';

export class DummyFS<DataType> implements FSAPI {
  files: Partial<Record<string, DataType>>;
  constructor(files: Partial<Record<string, DataType>>) {
    this.files = files;
  }

  getFileNames(directory: string): string[] {
    let ret = [];
    for (let key in this.files) {
      if (key.startsWith(directory)) {
        ret.push(key);
      }
    }
    return ret;
  }
  getFile<T>(filename: string, encoding: 'jsobj'): T;
  getFile(filename: string, encoding: 'buffer'): Buffer;
  getFile<T=Buffer>(filename: string, encoding: 'jsobj' | 'buffer'): T {
    assert(encoding === 'jsobj');
    let ret = this.files[filename];
    assert(ret);
    return ret as DataObject as T;
  }

  by_ext: Partial<Record<string, FilewatchCB>> = {};
  by_match: [RegExp | string, FilewatchCB][] = [];
  filewatchOn(ext_or_search: RegExp | string, cb: FilewatchCB): void {
    if (typeof ext_or_search === 'string' && ext_or_search[0] === '.') {
      assert(!this.by_ext[ext_or_search]);
      this.by_ext[ext_or_search] = cb;
    } else {
      this.by_match.push([ext_or_search, cb]);
    }
  }

  applyNewFile(filename: string, data: DataType): void {
    this.files[filename] = data;
    let ext_idx = filename.lastIndexOf('.');
    if (ext_idx !== -1) {
      let ext = filename.slice(ext_idx);
      this.by_ext[ext]?.(filename);
    }
    for (let ii = 0; ii < this.by_match.length; ++ii) {
      if (filename.match(this.by_match[ii][0])) {
        this.by_match[ii][1](filename);
      }
    }
  }
}
