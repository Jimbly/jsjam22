/* eslint-disable import/order */
const assert = require('assert');
const { filewatchOn, filewatchTriggerChange } = require('./filewatch.js');
const urlhash = require('./urlhash.js');
const { clone, deepEqual } = require('glov/common/util.js');

let fs = window.glov_webfs || {};
let decoded = {};
let used = {};
let active_reload = false; // after an active reload, do data cloning to better detect which files changed
// export function webFSReady() {
//   // TODO: async ready state?
// }

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
  let ret = [];
  for (let filename in fs) {
    if (filename.startsWith(directory)) {
      ret.push(filename);
    }
  }
  return ret;
}

export function webFSGetFile(filename, encoding) {
  let ret = decoded[filename];
  if (ret) {
    return ret;
  }
  used[filename] = true;
  assert(window.glov_webfs, 'Failed to load fsdata.js');
  let data = fs[filename];
  assert(data, `Error loading file: ${filename}`);
  if (encoding === 'jsobj') {
    assert(!Array.isArray(data));
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

function webFSReload() {
  active_reload = true;
  window.glov_webfs = null;
  let scriptTag = document.createElement('script');
  scriptTag.src = `${urlhash.getURLBase()}fsdata.js?rl=${Date.now()}`;
  scriptTag.onload = function () {
    if (window.glov_webfs) {
      let old_fs = fs;
      fs = window.glov_webfs;
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
  };
  document.getElementsByTagName('head')[0].appendChild(scriptTag);
}

filewatchOn('fsdata.js', webFSReload);
