// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { isPacket, packetFromBuffer } = require('glov/common/packet.js');

export const ERR_NOT_FOUND = 'ERR_NOT_FOUND';

let queues = {};
let broadcasts = {};

// register as an authoritative single handler
// cb(message)
// register_cb(err) if already exists
export function register(id, cb, register_cb) {
  assert(id);
  assert(cb);
  setTimeout(function () {
    if (queues[id]) {
      return void register_cb('ERR_ALREADY_EXISTS');
    }
    assert(!queues[id]);
    queues[id] = cb;
    register_cb(null);
  }, 30); // slight delay to force async behavior
}

export function replaceMessageHandler(id, old_cb, cb) {
  assert(id);
  assert(cb);
  assert(queues[id]);
  assert.equal(queues[id], old_cb);
  queues[id] = cb;
}

// subscribe to a broadcast-to-all channel
export function subscribe(id, cb, register_cb) {
  assert(id);
  setTimeout(function () {
    broadcasts[id] = broadcasts[id] || [];
    broadcasts[id].push(cb);
    register_cb(null);
  }, 30); // slight delay to force async behavior
}

export function unregister(id, cb) {
  assert(queues[id]);
  process.nextTick(function () {
    assert(queues[id]);
    delete queues[id];
    if (cb) {
      cb();
    }
  });
}

// pak and it's buffers are valid until cb() is called
// cb(err)
export function publish(dest, pak, cb) {
  assert(isPacket(pak));
  let buf = pak.getBuffer(); // Actually probably a Uint8Array, Buffer.from(buf.buffer,0,buf_len) will coerce to Buffer
  let buf_len = pak.getBufferLen();
  assert(buf_len);
  // Force this async, pak is *not* serialized upon call, so this can be super-fast in-process later
  process.nextTick(function () {
    if (broadcasts[dest]) {
      for (let ii = 0; ii < broadcasts[dest].length; ++ii) {
        let clone = packetFromBuffer(buf, buf_len, true);
        broadcasts[dest][ii](clone);
      }
      return cb(null);
    }
    if (!queues[dest]) {
      return cb(ERR_NOT_FOUND);
    }
    let clone = packetFromBuffer(buf, buf_len, true);
    queues[dest](clone);
    return cb(null);
  });
}

export function create() {
  return exports;
}
