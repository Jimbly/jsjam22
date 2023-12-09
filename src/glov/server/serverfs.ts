import assert from 'assert';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { serverFilewatchOn } from './server_filewatch';

import type { FSAPI } from 'glov/common/fsapi';
import type { DataObject } from 'glov/common/types';

const FS_BASEPATH1 = '../../server/';
const FS_BASEPATH2 = '../../client/';

export function serverFSGetFileNames(directory: string): string[] {
  let path1 = path.join(__dirname, FS_BASEPATH1, directory);
  let path2 = path.join(__dirname, FS_BASEPATH2, directory);
  let ret;
  if (existsSync(path1)) {
    ret = readdirSync(path1);
    if (existsSync(path2)) {
      ret = ret.concat(readdirSync(path2));
    }
  } else {
    // will throw exception here if neither path exists
    ret = readdirSync(path2);
  }
  ret = ret.filter((filename) => (!filename.endsWith('.br') && !filename.endsWith('.gz')));
  ret = ret.map((filename) => `${directory}/${filename}`);
  return ret;
}

type ServerFSEntry = DataObject | Buffer;
let serverfs_cache: Partial<Record<string, ServerFSEntry>> = {};

export function serverFSGetFile<T extends ServerFSEntry>(filename: string, encoding?: string): T {
  let cached = serverfs_cache[filename];
  if (cached) {
    return cached as T;
  }
  let path1 = path.join(__dirname, FS_BASEPATH1, filename);
  let path2 = path.join(__dirname, FS_BASEPATH2, filename);
  let data;
  if (existsSync(path1)) {
    data = readFileSync(path1);
  } else {
    // Will throw exception here if neither exist
    data = readFileSync(path2);
  }
  assert(data, `Error loading file: ${filename}`);
  let ret;
  if (encoding === 'jsobj') {
    ret = JSON.parse(data.toString());
  } else {
    ret = data;
  }
  serverfs_cache[filename] = ret;
  return ret;
}

export function serverFSdeleteCached(filename: string): void {
  delete serverfs_cache[filename];
}

export function serverFSAPI(): FSAPI {
  return {
    getFileNames: serverFSGetFileNames,
    getFile: serverFSGetFile,
    filewatchOn: serverFilewatchOn,
  };
}
