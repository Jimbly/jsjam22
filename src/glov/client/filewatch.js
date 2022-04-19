const assert = require('assert');

let by_ext = {};
let by_match = [];

// cb(filename)
export function filewatchOn(ext_or_search, cb) {
  if (ext_or_search[0] === '.') {
    assert(!by_ext[ext_or_search]);
    by_ext[ext_or_search] = cb;
  } else {
    by_match.push([ext_or_search, cb]);
  }
}

let message_cb;
// cb(message)
export function filewatchMessageHandler(cb) {
  message_cb = cb;
}

function onFileChange(filename) {
  console.log(`FileWatch change: ${filename}`);
  let ext_idx = filename.lastIndexOf('.');
  let did_reload = false;
  if (ext_idx !== -1) {
    let ext = filename.slice(ext_idx);
    if (by_ext[ext]) {
      if (by_ext[ext](filename) !== false) {
        did_reload = true;
      }
    }
  }
  for (let ii = 0; ii < by_match.length; ++ii) {
    if (filename.match(by_match[ii][0])) {
      if (by_match[ii][1](filename) !== false) {
        did_reload = true;
      }
    }
  }
  if (message_cb && did_reload) {
    message_cb(`Reloading: ${filename}`);
  }
}

export function filewatchTriggerChange(filename) {
  onFileChange(filename);
}

export function filewatchStartup(client) {
  client.onMsg('filewatch', onFileChange);
}
