// client -> server
export const GMX_CMD_REGISTER = 1;
export const GMX_CMD_UNREGISTER = 2;
export const GMX_CMD_SUBSCRIBE = 3;
export const GMX_CMD_PUBLISH = 5;
// server -> client
export const GMX_CMD_ACK = 10;

export const GMX_HEADER = 0xCF; // 207

export const GMX_OK = 0;
export const GMX_ERR_ALREADY_EXISTS = 1;
export const GMX_ERR_NOT_FOUND = 2;

import assert from 'assert';
import { packetReadIntFromBuffer } from 'glov/common/packet';

export function createGMXDataHandler(parent: {
  emitBuf: (cmd: number, buf: Buffer, offs: number, len: number) => void;
}): (buf: Buffer) => void {
  let buf: Buffer | null = null;
  function handleNewData(): boolean {
    assert(buf);
    if (buf.length < 3) {
      // need more
      // console.log('GMXDH:  need more(1)');
      return false;
    }
    let offs = 0;
    let header = buf[offs++];
    assert.equal(header, GMX_HEADER);
    let read_ret = packetReadIntFromBuffer(buf, offs, buf.length);
    if (!read_ret) {
      // need more
      // console.log('GMXDH:  need more(2)');
      return false;
    }
    let payload_size = read_ret.v;
    assert(payload_size > 1);
    offs = read_ret.offs;
    if (offs + payload_size > buf.length) {
      // Need more
      // console.log(`GMXDH:  need more(3:${offs},${payload_size},${buf.length})`);
      return false;
    }
    let cmd = buf[offs++];
    let msg_data_buf = buf;
    let msg_data_offs = offs;
    let payload_end = offs + payload_size - 1;
    let more = buf.length > payload_end;
    if (more) {
      buf = buf.subarray(payload_end);
    } else {
      buf = null;
    }
    parent.emitBuf(cmd, msg_data_buf, msg_data_offs, payload_end);
    return more;
  }

  return (data: Buffer) => {
    // console.log(`GMXDH:on data len=${data.length}, buf=${buf?buf.length:null}`);
    if (buf) {
      buf = Buffer.concat([buf, data]);
    } else {
      buf = data;
    }
    while (handleNewData()) {
      // repeat until consumed
    }
  };
}
