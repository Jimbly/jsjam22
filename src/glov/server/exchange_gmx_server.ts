// Run in dev with: npx nodemon -w dist/game/build.dev/ dist/game/build.dev/glov/server/exchange_gmx_server.js

import assert from 'assert';
import net from 'net';
import {
  packetCreate,
  packetReadIntFromBuffer,
  packetSizeInt,
} from 'glov/common/packet';
import { ridx } from 'glov/common/util';
import {
  GMX_CMD_ACK,
  GMX_CMD_PUBLISH,
  GMX_CMD_REGISTER,
  GMX_CMD_SUBSCRIBE,
  GMX_CMD_UNREGISTER,
  GMX_ERR_ALREADY_EXISTS,
  GMX_ERR_NOT_FOUND,
  GMX_HEADER,
  GMX_OK,
  createGMXDataHandler,
} from './exchange_gmx_common';

import type { TSMap } from 'glov/common/types';
import type { // eslint-disable-line no-duplicate-imports
  AddressInfo,
  Socket,
} from 'net';

const argv = require('minimist')(process.argv.slice(2));

let port = argv.port || process.env.port || 3005;

function packetReadAnsiStringFromBuffer(buf: Buffer, offs: number): [string, number] {
  let read_ret = packetReadIntFromBuffer(buf, offs, buf.length);
  assert(read_ret);
  let end_offs = read_ret.offs + read_ret.v;
  let str = buf.toString('binary', read_ret.offs, end_offs);
  return [str, end_offs];
}

const ACK_MAX_SIZE = 1 + 1 + 1 + 9;
function sendAck(socket: Socket, ack_id: number, status: number): void {
  let ack_pak = packetCreate(0, ACK_MAX_SIZE);
  ack_pak.writeU8(GMX_HEADER);
  let payload_size = 1 + packetSizeInt(ack_id);
  if (status) {
    payload_size++;
  }
  ack_pak.writeInt(payload_size);
  ack_pak.writeU8(GMX_CMD_ACK);
  ack_pak.writeInt(ack_id);
  if (status) {
    ack_pak.writeU8(status);
  }
  let buf = ack_pak.getBuffer();
  let buf_len = ack_pak.getBufferLen();
  if (buf_len !== buf.length) {
    buf = buf.subarray(0, buf_len);
  }
  socket.write(buf, function () {
    ack_pak.pool();
  });
}

// function bufString(buf: Buffer): string {
//   return buf.toString('binary').replace(/[^-\w?./\\]+/g, '?');
// }

let queues: TSMap<Socket> = Object.create(null);
let broadcasts: TSMap<Socket[]> = Object.create(null);

class GMXServerClient {
  last_ack_id = 0;
  my_queues: TSMap<true> = Object.create(null); // TODO: clean up upon disconnect
  my_broadcasts: TSMap<true> = Object.create(null);
  socket: Socket;
  addr: AddressInfo;
  closed = false;
  constructor(s: Socket, addr: AddressInfo) {
    this.socket = s;
    this.addr = addr;
  }
  emitBuf(cmd: number, buf: Buffer, offs: number, buf_len: number): void {
    if (this.closed) {
      return;
    }
    let { socket } = this;
    let ack_id = ++this.last_ack_id;
    // console.log(ack_id, cmd, bufString(buf), buf_len);
    let target_id: string;
    switch (cmd) {
      case GMX_CMD_REGISTER:
        [target_id, offs] = packetReadAnsiStringFromBuffer(buf, offs);
        if (queues[target_id]) {
          console.log('  register FAILED', target_id, this.addr);
          sendAck(socket, ack_id, GMX_ERR_ALREADY_EXISTS);
        } else {
          queues[target_id] = socket;
          this.my_queues[target_id] = true;
          // console.log('  register OK', target_id, this.addr);
          sendAck(socket, ack_id, GMX_OK);
        }
        break;
      case GMX_CMD_UNREGISTER:
        [target_id, offs] = packetReadAnsiStringFromBuffer(buf, offs);
        if (this.my_queues[target_id]) {
          // console.log('  unregister OK', target_id, this.addr);
          delete this.my_queues[target_id];
          delete queues[target_id];
          sendAck(socket, ack_id, GMX_OK);
        } else if (this.my_broadcasts[target_id]) {
          // console.log('  unregister OK (broadcast)', target_id, this.addr);
          delete this.my_broadcasts[target_id];
          let arr = broadcasts[target_id];
          assert(arr);
          broadcasts[target_id] = arr.filter((s) => s !== socket);
          sendAck(socket, ack_id, GMX_OK);
        } else {
          console.log('  register FAILED', target_id, this.addr);
          sendAck(socket, ack_id, GMX_ERR_NOT_FOUND);
        }
        break;
      case GMX_CMD_SUBSCRIBE:
        [target_id, offs] = packetReadAnsiStringFromBuffer(buf, offs);
        if (this.my_broadcasts[target_id]) {
          console.log('  subscribe FAILED', target_id, this.addr);
          sendAck(socket, ack_id, GMX_ERR_ALREADY_EXISTS);
        } else {
          let arr = broadcasts[target_id];
          if (!arr) {
            arr = broadcasts[target_id] = [];
          }
          arr.push(socket);
          this.my_broadcasts[target_id] = true;
          // console.log('  subscribe OK', target_id, this.addr);
          sendAck(socket, ack_id, GMX_OK);
        }
        break;
      case GMX_CMD_PUBLISH:
        assert(offs <= 11); // should just be the 1-byte header + <=9-byte size + 1-byte command
        [target_id, offs] = packetReadAnsiStringFromBuffer(buf, offs);
        if (queues[target_id] || broadcasts[target_id]) {
          if (buf.length !== buf_len) {
            buf = buf.subarray(0, buf_len);
          }
          sendAck(socket, ack_id, GMX_OK);
          // console.log('  publish OK', target_id, this.addr);
          let queue_socket = queues[target_id];
          if (queue_socket) {
            queue_socket.write(buf);
          }
          let broad_target = broadcasts[target_id];
          if (broad_target) {
            for (let ii = 0; ii < broad_target.length; ++ii) {
              broad_target[ii].write(buf);
            }
          }
        } else {
          // console.log('  publish FAILED ERR_NOT_FOUND', target_id, this.addr);
          sendAck(socket, ack_id, GMX_ERR_NOT_FOUND);
        }
        break;
      default:
        assert(false, `GMX Server received unknown command ${cmd} from ${this.addr.address}`);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    console.log('client disconnected', this.addr);
    for (let target in this.my_queues) {
      assert.equal(queues[target], this.socket);
      delete queues[target];
    }
    this.my_queues = null!;
    for (let target in this.my_broadcasts) {
      let arr = broadcasts[target];
      assert(arr);
      let idx = arr.indexOf(this.socket);
      assert(idx !== -1);
      ridx(arr, idx);
      if (arr.length === 0) {
        delete broadcasts[target];
      }
    }
    this.my_broadcasts = null!;
    this.socket = null!;
  }
}

type NodeError = Error & { code: string };

let server = net.createServer(function (socket) {
  socket.setNoDelay(true);
  socket.setKeepAlive(true);
  let addr = socket.address() as AddressInfo;
  console.log('client connected', addr);
  let client = new GMXServerClient(socket, addr);
  socket.on('close', () => {
    client.close();
  });
  socket.on('data', createGMXDataHandler(client));
  socket.on('error', (err: NodeError) => {
    if (err.code === 'ECONNRESET') {
      // disconnect "error", expected
      client.close();
      // console.debug('ignoring socket error ECONNRESET sending to', addr);
    } else {
      // TODO: do not fatally error here?  log in a way that's alertable?
      throw err;
    }
  });
});
server.on('error', (err) => {
  // TODO: do not fatally error here?  log in a way that's alertable?
  throw err;
});
server.listen(port, () => {
  console.log(`GMX Server Started on port ${port}`);
});
