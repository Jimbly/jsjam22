// Portions Copyright 2023 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export const ERR_NOT_FOUND = 'ERR_NOT_FOUND';

import assert from 'assert';
import {
  Packet,
  isPacket,
  packetFromBuffer,
} from 'glov/common/packet';

import type {
  DataObject,
  TSMap,
} from 'glov/common/types';

export type MexchangeHandler = (pak: Packet) => void;
export type MexchangeCompletionCB = (err: string | null) => void;
export type Mexchange = {
  register: (id: string, cb: MexchangeHandler, register_cb: MexchangeCompletionCB) => void;
  replaceMessageHandler: (id: string, old_cb: MexchangeHandler, cb: MexchangeHandler) => void;
  subscribe: (id: string, cb: MexchangeHandler, register_cb: MexchangeCompletionCB) => void;
  unregister: (id: string, cb?: MexchangeCompletionCB) => void;
  publish: (dest: string, pak: Packet, cb: MexchangeCompletionCB) => void;
  no_local_bypass?: boolean;
};

class ExchangeLocal implements Mexchange {
  no_local_bypass = true;
  queues: TSMap<MexchangeHandler> = {};
  broadcasts: TSMap<MexchangeHandler[]> = {};

  // register as an authoritative single handler
  // cb(message)
  // register_cb(err) if already exists
  register(id: string, cb: MexchangeHandler, register_cb: MexchangeCompletionCB): void {
    assert(id);
    assert(cb);
    setTimeout(() => {
      if (this.queues[id]) {
        return void register_cb('ERR_ALREADY_EXISTS');
      }
      assert(!this.queues[id]);
      this.queues[id] = cb;
      register_cb(null);
    }, 30); // slight delay to force async behavior
  }

  replaceMessageHandler(id: string, old_cb: MexchangeHandler, cb: MexchangeHandler): void {
    assert(id);
    assert(cb);
    assert(this.queues[id]);
    assert.equal(this.queues[id], old_cb);
    this.queues[id] = cb;
  }

  // subscribe to a broadcast-to-all channel
  subscribe(id: string, cb: MexchangeHandler, register_cb: MexchangeCompletionCB): void {
    assert(id);
    setTimeout(() => {
      let arr = this.broadcasts[id] = this.broadcasts[id] || [];
      arr.push(cb);
      register_cb(null);
    }, 30); // slight delay to force async behavior
  }

  unregister(id: string, cb?: MexchangeCompletionCB): void {
    assert(this.queues[id]);
    process.nextTick(() => {
      assert(this.queues[id]);
      delete this.queues[id];
      if (cb) {
        cb(null);
      }
    });
  }

  // pak and it's buffers are valid until cb() is called
  // cb(err)
  publish(dest: string, pak: Packet, cb: MexchangeCompletionCB): void {
    assert(isPacket(pak));
    // Note: actually probably a Uint8Array, Buffer.from(buf.buffer,buf.byteOffset,buf_len) will coerce to Buffer
    let buf = pak.getBuffer();
    let buf_len = pak.getBufferLen();
    assert(buf_len);
    // Force this async, pak is *not* serialized upon call, so this can be super-fast in-process later
    process.nextTick(() => {
      let broad_target = this.broadcasts[dest];
      if (broad_target) {
        for (let ii = 0; ii < broad_target.length; ++ii) {
          let clone = packetFromBuffer(buf, buf_len, true);
          broad_target[ii](clone);
        }
        return cb(null);
      }
      let queue_cb = this.queues[dest];
      if (!queue_cb) {
        return cb(ERR_NOT_FOUND);
      }
      let clone = packetFromBuffer(buf, buf_len, true);
      queue_cb(clone);
      return cb(null);
    });
  }
}

export type MexchangeProvider = (opts: DataObject) => Mexchange;
let exchange_providers: TSMap<MexchangeProvider> = {};
export function exchangeProviderRegister(type: string, provider: MexchangeProvider): void {
  assert(!exchange_providers[type]);
  exchange_providers[type] = provider;
}

function exchangeLocalCreate(): Mexchange {
  return new ExchangeLocal();
}
exchangeProviderRegister('local', exchangeLocalCreate);

export function exchangeCreate(opts: DataObject & { type?: string }): Mexchange {
  let type = opts.type || 'local';
  let provider = exchange_providers[type];
  assert(provider, `Unknown exchange provider "${type}"`);
  console.log(`[EXCHANGE] Using "${type}"`);
  return provider(opts);
}
