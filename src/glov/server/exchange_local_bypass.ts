// Portions Copyright 2023 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import {
  Packet,
  isPacket,
  packetFromBuffer,
} from 'glov/common/packet';

import type {
  Mexchange,
  MexchangeCompletionCB,
  MexchangeHandler,
} from './exchange';
import type { TSMap } from 'glov/common/types';

class ExchangeLocalBypass implements Mexchange {
  queues: TSMap<MexchangeHandler> = {};
  actual_exchange: Mexchange;

  constructor(actual_exchange: Mexchange) {
    this.queues = {};
    this.actual_exchange = actual_exchange;
  }

  // register as an authoritative single handler
  // cb(message)
  // register_cb(err) if already exists
  register(id: string, cb: MexchangeHandler, register_cb: MexchangeCompletionCB): void {
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

  replaceMessageHandler(id: string, old_cb: MexchangeHandler, cb: MexchangeHandler): void {
    assert(id);
    assert(cb);
    assert(this.queues[id]);
    assert.equal(this.queues[id], old_cb);
    this.queues[id] = cb;
    this.actual_exchange.replaceMessageHandler(id, old_cb, cb);
  }

  // subscribe to a broadcast-to-all channel
  // can *not* do a local bypass, the broadcasts must go to the actual exchange
  subscribe(id: string, cb: MexchangeHandler, register_cb: MexchangeCompletionCB): void {
    this.actual_exchange.subscribe(id, cb, register_cb);
  }

  unregister(id: string, cb?: MexchangeCompletionCB): void {
    assert(this.queues[id]);
    delete this.queues[id];
    this.actual_exchange.unregister(id, cb);
  }

  // pak and it's buffers are valid until cb() is called
  // cb(err)
  publish(dest: string, pak: Packet, cb: MexchangeCompletionCB): void {
    assert(isPacket(pak));

    if (!this.queues[dest] || pak.no_local_bypass) {
      // not in our process
      return void this.actual_exchange.publish(dest, pak, cb);
    }

    let buf = pak.getBuffer(); // Actually probably a Uint8Array
    let buf_len = pak.getBufferLen();
    assert(buf_len);
    process.nextTick(() => {
      let queue_cb = this.queues[dest];
      if (!queue_cb) {
        // Unregistered just this tick?  Fall back to actual exchange
        return void this.actual_exchange.publish(dest, pak, cb);
      }
      let clone = packetFromBuffer(buf, buf_len, true);
      queue_cb(clone);
      cb(null);
    });
  }
}

export function exchangeLocalBypassCreate(actual_exchange: Mexchange): Mexchange {
  assert(actual_exchange);
  return new ExchangeLocalBypass(actual_exchange);
}
