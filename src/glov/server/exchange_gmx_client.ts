// Portions Copyright 2023 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import net from 'net';
import {
  ExecuteWithRetryOptions,
  executeWithRetry,
} from 'glov/common/execute_with_retry';
import {
  Packet,
  isPacket,
  packetCreate,
  packetFromBuffer,
  packetReadIntFromBuffer,
  packetSizeAnsiString,
  packetSizeInt,
} from 'glov/common/packet';
import { callEach, errorString } from 'glov/common/util';
import {
  ERR_NOT_FOUND,
  Mexchange,
  MexchangeCompletionCB,
  MexchangeHandler,
  exchangeProviderRegister,
} from './exchange';
import {
  GMX_CMD_ACK,
  GMX_CMD_PUBLISH,
  GMX_CMD_REGISTER,
  GMX_CMD_SUBSCRIBE,
  GMX_CMD_UNREGISTER,
  GMX_ERR_ALREADY_EXISTS,
  GMX_ERR_NOT_FOUND,
  GMX_HEADER,
  createGMXDataHandler,
} from './exchange_gmx_common';
import { panic } from './server';

import type { DataObject, TSMap, VoidFunc } from 'glov/common/types';

const GMX_ERR_STRINGS: Record<number, string> = {
  [GMX_ERR_ALREADY_EXISTS]: 'ERR_ALREADY_EXISTS',
  [GMX_ERR_NOT_FOUND]: ERR_NOT_FOUND,
};

const connect_retry_options: ExecuteWithRetryOptions = {
  max_retries: 30,
  inc_backoff_duration: 100,
  max_backoff: 5000,
  log_prefix: 'ExchangeGMX Connect',
};

const CONNECT_TIMEOUT = 3000;

class ExchangeGMX implements Mexchange {
  private ready_cbs: VoidFunc[] | null = [];
  private queues: TSMap<MexchangeHandler> = {};
  private broadcasts: TSMap<MexchangeHandler[]> = {};
  private opts: net.TcpNetConnectOpts;
  constructor(opts: net.TcpNetConnectOpts) {
    this.opts = opts;

    executeWithRetry(this.tryConnect.bind(this), connect_retry_options, (err?: string | null) => {
      if (err) {
        return panic(`Unable to establish connecting to GMX: ${err}`);
      }
      assert(this.socket);
      callEach(this.ready_cbs, this.ready_cbs = null);
    });
  }

  private socket?: net.Socket;
  private tryConnect(cb: MexchangeCompletionCB): void {
    let did_cb = false;
    let had_error_connecting = false;
    let connect_timeout: NodeJS.Timeout;
    let socket = net.connect(this.opts, () => { //'connect' listener
      if (connect_timeout) {
        clearTimeout(connect_timeout);
      }
      //console.log('Socket connected to ' + host + ':' + port);
      if (!did_cb) {
        did_cb = true;
        this.socket = socket;
        cb(null);
      }
    });
    socket.setNoDelay(true);
    socket.on('error', function (err) {
      let err_str = errorString(err);
      if (!did_cb) {
        had_error_connecting = true;
        did_cb = true;
        cb(err_str);
      } else if (!had_error_connecting) {
        // error while already connected
        return panic(`GMX runtime error: ${err_str}`);
      }
    });
    socket.on('data', createGMXDataHandler(this));
    socket.on('close', function () {
      //console.log('Socket disconnected from ' + host + ':' + port);
      if (!had_error_connecting) {
        panic('GMX runtime disconnect');
      }
    });
    connect_timeout = setTimeout(() => {
      if (!did_cb) {
        had_error_connecting = true;
        socket.end();
        did_cb = true;
        cb('ERR_TIMEOUT');
      }
    }, CONNECT_TIMEOUT);
  }

  emitBuf(cmd: number, buf: Buffer, offs: number, buf_len: number): void {
    if (cmd === GMX_CMD_ACK) {
      let read_ret = packetReadIntFromBuffer(buf, offs, buf_len);
      assert(read_ret);
      let ack_id = read_ret.v;
      offs = read_ret.offs;
      let err: string | null = null;
      if (offs < buf_len) {
        read_ret = packetReadIntFromBuffer(buf, offs, buf_len);
        assert(read_ret);
        offs = read_ret.offs;
        let err_id = read_ret.v;
        err = GMX_ERR_STRINGS[err_id] || `GMX_UNKNOWN_ERROR(${err_id})`;
      }
      // console.log(`GMX:recv ack ${ack_id}`);
      let cb = this.acks[ack_id];
      assert(cb);
      delete this.acks[ack_id];
      cb(err);
    } else if (cmd === GMX_CMD_PUBLISH) {
      let read_ret = packetReadIntFromBuffer(buf, offs, buf_len);
      assert(read_ret);
      let dest_len = read_ret.v;
      offs = read_ret.offs;
      let dest = buf.toString('binary', offs, offs + dest_len);
      offs += dest_len;
      let payload_buf = buf.subarray(offs);
      let payload_len = buf_len - offs;
      // console.log(`GMX:recv pub to ${dest} len ${payload_len}`);
      let broad_target = this.broadcasts[dest];
      if (broad_target) {
        for (let ii = 0; ii < broad_target.length; ++ii) {
          let clone = packetFromBuffer(payload_buf, payload_len, true);
          broad_target[ii](clone);
        }
      } else {
        let queue_cb = this.queues[dest];
        if (!queue_cb) {
          console.warn(`GMX: Received message for "${dest}" which has no handler, ignoring...`);
        } else {
          let pak = packetFromBuffer(payload_buf, payload_len, true);
          queue_cb(pak);
        }
      }
    } else {
      assert(false, `Unknown GMX CMDID: ${cmd}`);
    }
  }

  private whenReady(cb: VoidFunc): void {
    if (this.ready_cbs) {
      this.ready_cbs.push(cb);
    } else {
      cb();
    }
  }

  private last_ack = 0;
  private acks: Partial<Record<number, MexchangeCompletionCB>> = {};
  private registerAck(cb: MexchangeCompletionCB): number {
    let id = ++this.last_ack;
    this.acks[id] = cb;
    return id;
  }

  private pakSend(pak: Packet, cb: MexchangeCompletionCB): void {
    assert(cb);
    this.registerAck(cb);
    pak.makeReadable();
    let buf = pak.getBuffer();
    let buf_len = pak.getBufferLen();
    if (buf_len !== buf.length) {
      buf = new Uint8Array(buf.buffer, buf.byteOffset, buf_len);
    }
    assert(this.socket);
    // console.log(`GMS:send len=${buf_len} ack_id=${this.last_ack} buf=${buf.slice(0, 8)}`);
    this.socket.write(buf, function () {
      pak.pool();
    });
  }

  // register as an authoritative single handler
  // cb(message)
  // register_cb(err) if already exists
  register(id: string, cb: MexchangeHandler, register_cb: MexchangeCompletionCB): void {
    assert(id);
    assert(cb);
    assert(!this.queues[id]);
    this.queues[id] = cb;
    this.whenReady(() => {
      let payload_size = 1 + packetSizeAnsiString(id);
      let pak = packetCreate(0, 1 + packetSizeInt(payload_size) + payload_size);
      pak.writeU8(GMX_HEADER);
      pak.writeInt(payload_size);
      pak.writeU8(GMX_CMD_REGISTER);
      pak.writeAnsiString(id);
      this.pakSend(pak, (err: null | string) => {
        if (err) {
          delete this.queues[id];
        }
        register_cb(err);
      });
    });
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
    this.whenReady(() => {
      let arr = this.broadcasts[id];
      if (arr) {
        arr.push(cb);
        process.nextTick(register_cb.bind(null, null));
        return;
      }
      arr = this.broadcasts[id] = [cb];

      let payload_size = 1 + packetSizeAnsiString(id);
      let pak = packetCreate(0, 1 + packetSizeInt(payload_size) + payload_size);
      pak.writeU8(GMX_HEADER);
      pak.writeInt(payload_size);
      pak.writeU8(GMX_CMD_SUBSCRIBE);
      pak.writeAnsiString(id);
      this.pakSend(pak, (err: null | string) => {
        assert(!err);
        register_cb(err);
      });
    });
  }

  unregister(id: string, cb?: MexchangeCompletionCB): void {
    assert(this.queues[id]);
    this.whenReady(() => {
      let payload_size = 1 + packetSizeAnsiString(id);
      let pak = packetCreate(0, 1 + packetSizeInt(payload_size) + payload_size);
      pak.writeU8(GMX_HEADER);
      pak.writeInt(payload_size);
      pak.writeU8(GMX_CMD_UNREGISTER);
      pak.writeAnsiString(id);
      this.pakSend(pak, (err: null | string) => {
        assert(!err);
        assert(this.queues[id]);
        delete this.queues[id];
        if (cb) {
          cb(err);
        }
      });
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
    this.whenReady(() => {
      let payload_size = 1 + packetSizeAnsiString(dest) + buf_len;
      let pak = packetCreate(0, 1 + packetSizeInt(payload_size) + payload_size);
      pak.writeU8(GMX_HEADER);
      pak.writeInt(payload_size);
      pak.writeU8(GMX_CMD_PUBLISH);
      pak.writeAnsiString(dest);
      if (buf.length !== buf_len) {
        buf = buf.subarray(0, buf_len);
      }
      pak.appendBuffer(buf);
      this.pakSend(pak, (err: string | null) => {
        if (err) {
          assert.equal(err, ERR_NOT_FOUND); // Only error we'd ever get here?
          cb(ERR_NOT_FOUND);
        } else {
          cb(null);
        }
      });
    });
  }
}

function exchangeGMXCreate(opts: DataObject): Mexchange {
  return new ExchangeGMX({
    host: opts.host as string || 'localhost',
    port: opts.port as number || 3005,
  });
}

exchangeProviderRegister('gmx', exchangeGMXCreate);
