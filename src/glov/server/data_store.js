// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export let ds_stats = {
  set: 0,
  get: 0,
  inflight_set: 0,
};

/* eslint-disable import/order */
const assert = require('assert');
const fs = require('fs');
const FileStore = require('fs-store').FileStore;
const { createFileStore } = require('fs-store-async');
const mkdirp = require('mkdirp');
const path = require('path');
const { callEach, clone } = require('glov/common/util.js');

// Shuffles the ordering of the keys in an Object, to simulate saving to data
//   stores that do not use JavaScript Objects (which retain order) as a backing
//   store.
let do_shuffle = true;

export function dataStoreDoShuffle(value) {
  do_shuffle = value;
}


function shuffle(obj) {
  if (!obj) {
    return obj;
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  let ret = {};
  let keys = Object.keys(obj);
  for (let ii = 0; ii < keys.length; ++ii) {
    let idx = ii + Math.floor(Math.random() * (keys.length - ii));
    let key = keys[idx];
    keys[idx] = keys[ii];
    ret[key] = shuffle(obj[key]);
  }
  return ret;
}

class DataStoreOneFile {
  constructor(store_path) {
    this.root_store = new FileStore(store_path);
  }
  setAsync(obj_name, value, cb) {
    ++ds_stats.set;
    setImmediate(() => {
      let obj;
      if (Buffer.isBuffer(value)) {
        obj = value.toString('utf8');
      } else {
        obj = value;
      }
      this.root_store.set(obj_name, obj);
      cb();
    });
  }
  getAsync(obj_name, default_value, cb) {
    ++ds_stats.get;
    setImmediate(() => {
      let obj = this.root_store.get(obj_name, default_value);
      if (do_shuffle) {
        obj = shuffle(obj);
      }
      cb(null, obj);
    });
  }
  getAsyncBuffer(obj_name, cb) {
    ++ds_stats.get;
    this.getAsync(obj_name, '', null, function (err, value) {
      if (!err && value !== null) {
        value = Buffer.from(JSON.stringify(value), 'utf8');
      }
      return cb(err, value);
    });
  }
  unload(obj_name) {
    // doing nothing, as we're not loading individual files
  }
}

class DataStore {
  constructor(store_path) {
    this.path = store_path;
    this.stores = {};
    this.bin_queue = {};
    this.mkdirs = {};
    this.mkdir(store_path);
  }
  mkdir(store_path) {
    if (this.mkdirs[store_path]) {
      return;
    }
    if (!fs.existsSync(store_path)) {
      mkdirp.sync(store_path);
    }
    this.mkdirs[store_path] = true;
  }
  getStore(obj_name, cb) {
    assert.equal(typeof cb, 'function');
    let store = this.stores[obj_name];
    if (store) {
      if (Array.isArray(store)) {
        // still loading
        store.push(cb);
        return;
      }
      cb(store);
      return;
    }
    let store_path = path.join(this.path, `${obj_name}.json`);
    this.mkdir(path.dirname(store_path));
    this.stores[obj_name] = [cb];
    createFileStore(store_path, (err, my_store) => {
      assert(!err); // not possible
      callEach(this.stores[obj_name], this.stores[obj_name] = my_store, my_store);
    });
  }
  unload(obj_name) {
    let store = this.stores[obj_name];
    assert(store);
    delete this.stores[obj_name];
  }

  setAsyncBufferInternal(obj_name, value, cb) {
    if (this.bin_queue[obj_name]) {
      this.bin_queue[obj_name].value = value;
      this.bin_queue[obj_name].cbs.push(cb);
      return;
    }
    ++ds_stats.inflight_set;
    this.bin_queue[obj_name] = { cbs: [] };
    this.getStore(obj_name, (store) => {
      let onFinish;
      let startWrite = () => {
        // save separately, update reference
        let old_ext = store.get('bin');
        let bin_ext = old_ext && old_ext === 'b1' ? 'b2' : 'b1';
        let path_base = path.join(this.path, obj_name);
        let bin_path = `${path_base}.${bin_ext}`;
        fs.writeFile(bin_path, value, function (err) {
          if (err) {
            // Shouldn't ever happen, out of disk space, maybe?
            return void onFinish(err);
          }
          store.set('bin', bin_ext);
          store.set('data', null);
          // Could also delete the old bin file after the flush, but safer to keep it around
          store.onFlush(onFinish);
        });
      };
      let cur_cbs = [cb];
      onFinish = (err) => {
        let queued = this.bin_queue[obj_name];
        let { cbs } = queued;
        delete this.bin_queue[obj_name];
        callEach(cur_cbs, null, err);
        if (cbs.length) {
          value = queued.value;
          cur_cbs = cbs;
          this.bin_queue[obj_name] = { cbs: [] };
          startWrite();
        } else {
          --ds_stats.inflight_set;
        }
      };
      startWrite();
    });
  }

  setAsync(obj_name, value, cb) {
    ++ds_stats.set;
    assert.equal(typeof cb, 'function');
    setImmediate(() => {
      if (Buffer.isBuffer(value)) {
        return void this.setAsyncBufferInternal(obj_name, value, cb);
      }
      this.getStore(obj_name, (store) => {
        assert(!store.get('bin'));
        store.set('data', clone(value), cb);
      });
    });
  }
  getAsync(obj_name, default_value, cb) {
    ++ds_stats.get;
    setImmediate(() => {
      this.getStore(obj_name, (store) => {
        if (store.get('bin')) {
          // someone saved to this store as binary unexpectedly (e.g. tools/put.js, or code rollback?)
          // try to load it as a string and parse it
          let bin_ext = store.get('bin');
          let path_base = path.join(this.path, `${obj_name}.${bin_ext}`);
          return void fs.readFile(path_base, 'utf8', function (err, buf) {
            if (err) {
              return void cb(err);
            }
            let obj = JSON.parse(buf);
            if (do_shuffle) {
              obj = shuffle(obj);
            }
            cb(null, obj);
          });
        }
        let obj = store.get('data', default_value);
        if (obj && obj !== default_value) {
          obj = clone(obj);
          if (do_shuffle) {
            obj = shuffle(obj);
          }
        }
        cb(null, obj);
      });
    });
  }
  getAsyncBuffer(obj_name, cb) {
    ++ds_stats.get;
    assert(!this.bin_queue[obj_name]); // Currently being set
    setImmediate(() => {
      this.getStore(obj_name, (store) => {
        let bin_ext = store.get('bin');
        if (bin_ext) {
          let path_base = path.join(this.path, `${obj_name}.${bin_ext}`);
          return void fs.readFile(path_base, cb);
        }
        // No binary file, is there an old text object stored here?
        let obj = store.get('data', null);
        if (obj !== null) {
          if (typeof obj === 'string') {
            return void cb(null, Buffer.from(obj, 'utf8'));
          } else {
            // This gets hit when reading a local data store's object-format contents as type buffer (e.g. tools/get.js)
            return void cb(null, Buffer.from(JSON.stringify(obj), 'utf8'));
          }
        }
        cb(null, null);
      });
    });
  }

  // Buffer or string, for migration utilities
  getAsyncAuto(obj_name, cb) {
    ++ds_stats.get;
    assert(!this.bin_queue[obj_name]); // Currently being set
    setImmediate(() => {
      this.getStore(obj_name, (store) => {
        let bin_ext = store.get('bin');
        if (bin_ext) {
          let path_base = path.join(this.path, `${obj_name}.${bin_ext}`);
          return void fs.readFile(path_base, cb);
        }
        // No binary file
        cb(null, store.get('data', null));
      });
    });
  }

}

let all_stores = [];

// Init the type of datastore system
export function dataStoreCreate(store_path, one_file) {
  if (one_file) {
    return new DataStoreOneFile(store_path);
  }

  // Defaults to FileStore (this will be the behaviour in local environment)
  console.info('[DATASTORE] Local FileStore in use');
  let ret = new DataStore(store_path);
  all_stores.push(ret);
  return ret;
}
exports.create = dataStoreCreate; // legacy API

function finishFlush() {
  --ds_stats.inflight_set;
}

// Monitors the flushing of all data stores, `ds_stats.inflight_set` should get
//   to 0 (through this and/or buffer writes above) when all writes are finished
export function dataStoreMonitorFlush() {
  for (let ii = 0; ii < all_stores.length; ++ii) {
    let ds = all_stores[ii];
    for (let key in ds.stores) {
      let store = ds.stores[key];
      ++ds_stats.inflight_set;
      store.onFlush(finishFlush);
    }
  }
}
