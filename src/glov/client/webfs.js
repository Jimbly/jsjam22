import assert from 'assert';
import {
  callEach,
  clone,
  deepEqual,
} from 'glov/common/util';
import {
  filewatchOn,
  filewatchTriggerChange,
} from './filewatch';

let fs;
let decoded = {};
let used = {};
let active_reload = false; // after an active reload, do data cloning to better detect which files changed
// export function webFSReady() {
//   // TODO: async ready state?
// }

let on_ready = [];
// Will always be synchronous in the main thread, may be async in the WebWorker
export function webFSOnReady(cb) {
  if (fs) {
    cb();
  } else {
    on_ready.push(cb);
  }
}

function decode(data) {
  let len = data[0];
  let str = data[1];
  let u8 = new Uint8Array(len);
  let idxo = 0;
  let idxi = 0;
  while (idxo < len) {
    let byte = str.charCodeAt(idxi++);
    if (byte === 126) {
      byte = 0;
    } else if (byte === 27) {
      byte = str.charCodeAt(idxi++);
    }
    u8[idxo++] = byte;
  }
  assert.equal(idxi, str.length);
  assert.equal(idxo, len);
  return u8;
}

export function webFSGetFileNames(directory) {
  assert(fs);
  let ret = [];
  for (let filename in fs) {
    if (filename.startsWith(directory)) {
      ret.push(filename);
    }
  }
  return ret;
}

export function webFSGetFile(filename, encoding) {
  assert(fs);
  let ret = decoded[filename];
  if (ret) {
    return ret;
  }
  used[filename] = true;
  let data = fs[filename];
  assert(data, `Error loading file: ${filename}`);
  if (encoding === 'jsobj') {
    assert(!Array.isArray(data) || !(data.length === 2 && typeof data[0] === 'number' && typeof data[1] === 'string'));
    ret = active_reload ? clone(data) : data;
  } else {
    assert(Array.isArray(data));
    if (encoding === 'text') {
      ret = data[1];
    } else {
      ret = decode(data);
    }
  }
  decoded[filename] = ret;
  return ret;
}

export function webFSExists(filename) {
  assert(fs);
  return Boolean(fs[filename]);
}

export function webFSReportUnused(ignore_regex) {
  // Don't report on files we know are loaded dynamically, and are small
  ignore_regex = ignore_regex || /\.(fp|vp)$/;
  let tot_size = 0;
  for (let filename in fs) {
    if (!used[filename] && !filename.match(ignore_regex)) {
      console.warn(`WebFS file bundled but unreferenced: ${filename}`);
      tot_size += fs[filename][0];
    }
  }
  if (tot_size) {
    console.warn(`WebFS wasting ${tot_size} bytes`);
  }
}

let webfs_to_worker_cb;
export function webFSSetToWorkerCB(cb) {
  webfs_to_worker_cb = cb;
}
export function webFSGetData() {
  return fs;
}

export function webFSApplyReload(fs_in) {
  let old_fs = fs;
  fs = fs_in;

  // First, send to worker(s), before any changes might be triggered
  if (webfs_to_worker_cb) {
    webfs_to_worker_cb(fs);
  }

  // Then, reload and fire changes
  decoded = {};
  used = {};
  for (let key in fs) {
    let old_value = old_fs[key];
    let new_value = fs[key];
    if (Array.isArray(old_value)) {
      for (let ii = 0; ii < new_value.length; ++ii) {
        if (!old_value || new_value[ii] !== old_value[ii]) {
          filewatchTriggerChange(key);
          break;
        }
      }
    } else {
      // Raw object
      if (!deepEqual(old_value, new_value)) {
        filewatchTriggerChange(key);
      }
    }
  }
}

let base_url_for_reload;
function webFSReload() {
  // Note: only called in main thread, not in workers
  active_reload = true;
  window.glov_webfs = null;
  let scriptTag = document.createElement('script');
  scriptTag.src = `${base_url_for_reload}fsdata.js?rl=${Date.now()}`;
  scriptTag.onload = function () {
    if (window.glov_webfs) {
      webFSApplyReload(window.glov_webfs);
    }
  };
  document.head.appendChild(scriptTag);
}

export function webFSStartup(fs_in, base_url_for_reload_in) {
  fs = fs_in || {};
  if (base_url_for_reload_in) {
    base_url_for_reload = base_url_for_reload_in;
    filewatchOn('fsdata.js', webFSReload);
  }
  if (webfs_to_worker_cb) {
    webfs_to_worker_cb(fs);
  }
  callEach(on_ready, on_ready = null);
}

export function webFSAPI() {
  return {
    getFileNames: webFSGetFileNames,
    getFile: webFSGetFile,
    filewatchOn: filewatchOn,
  };
}
