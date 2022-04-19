const assert = require('assert');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');

const valid_path_regex = /[a-zA-Z0-9.-_]+/;
class DataStoreImage {
  constructor(store_path, subdir) {
    this.path = path.join(store_path, subdir).replace(/\\/g, '/');
    this.subdir = subdir;
    mkdirp.sync(this.path);
  }

  // cb(err, url)
  set(key, buffer, mime_type, cb) {
    assert(buffer instanceof Uint8Array); // Probably Uint8Array or Buffer
    assert(key.match(valid_path_regex));
    let disk_path = path.join(this.path, key);
    let serve_path = `${this.subdir}/${key}`;
    fs.writeFile(disk_path, buffer, function (err) {
      cb(err, serve_path);
    });
  }

  delete(key, cb) {
    let disk_path = path.join(this.path, key);
    fs.unlink(disk_path, cb);
  }
}

export function create(serve_root, subdir) {
  console.info('[DATASTORE] Local Image FileStore in use');
  return new DataStoreImage(serve_root, subdir);
}
