// Portions Copyright 2021 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { isPacket, packetFromBuffer } = require('glov/common/packet.js');

class ExchangeLocalBypass {
  constructor(actual_exchange) {
    this.queues = {};
    this.actual_exchange = actual_exchange;
  }

  // register as an authoritative single handler
  // cb(message)
  // register_cb(err) if already exists
  register(id, cb, register_cb) {
    assert(id);
    assert(cb);
    if (this.queues[id]) {
      return void process.nextTick(function () {
        register_cb('ERR_ALREADY_EXISTS');
      });
    }
    this.queues[id] = cb;
    this.actual_exchange.register(id, cb, register_cb);
  }

  replaceMessageHandler(id, old_cb, cb) {
    assert(id);
    assert(cb);
    assert(this.queues[id]);
    assert.equal(this.queues[id], old_cb);
    this.queues[id] = cb;
    this.actual_exchange.replaceMessageHandler(id, old_cb, cb);
  }

  // subscribe to a broadcast-to-all channel
  // can *not* do a local bypass, the broadcasts must go to the actual exchange
  subscribe(id, cb, register_cb) {
    this.actual_exchange.subscribe(id, cb, register_cb);
  }

  unregister(id, cb) {
    assert(this.queues[id]);
    delete this.queues[id];
    this.actual_exchange.unregister(id, cb);
  }

  // pak and it's buffers are valid until cb() is called
  // cb(err)
  publish(dest, pak, cb) {
    assert(isPacket(pak));

    if (!this.queues[dest] || pak.no_local_bypass) {
      // not in our process
      return void this.actual_exchange.publish(dest, pak, cb);
    }

    let buf = pak.getBuffer(); // Actually probably a Uint8Array
    let buf_len = pak.getBufferLen();
    assert(buf_len);
    process.nextTick(() => {
      if (!this.queues[dest]) {
        // Unregistered just this tick?  Fall back to actual exchange
        return void this.actual_exchange.publish(dest, pak, cb);
      }
      let clone = packetFromBuffer(buf, buf_len, true);
      this.queues[dest](clone);
      cb(null);
    });
  }
}

export function create(actual_exchange) {
  assert(actual_exchange);
  return new ExchangeLocalBypass(actual_exchange);
}
