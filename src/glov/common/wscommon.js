// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export let wsstats = { msgs: 0, bytes: 0 };
export let wsstats_out = { msgs: 0, bytes: 0 };

/* eslint-disable import/order */
const ack = require('./ack.js');
const assert = require('assert');
const { ackHandleMessage, ackReadHeader, ackWrapPakStart, ackWrapPakPayload, ackWrapPakFinish } = ack;
const { random, round } = Math;
const { isPacket, packetCreate, packetDefaultFlags, packetFromBuffer } = require('./packet.js');
const { perfCounterAddValue } = require('./perfcounters.js');

export const CONNECTION_TIMEOUT = 60000;
export const PING_TIME = CONNECTION_TIMEOUT / 2;

// Rough estimate, if over, will prevent resizing the packet
const PAK_HEADER_SIZE = 1 + // flags
  1+16 + // message id
  1+9; // resp_pak_id

let net_delay = 0;
let net_delay_rand = 0;

function socketSendInternal(client, buf, pak) {
  if (client.ws_server) {
    client.socket.send(buf, pak.pool.bind(pak));
  } else {
    // Testing code to fake sending string packets for debugging
    // Note: though we can successfully decode these string packets, ones seen
    //   in the wild appear to have lost data and cannot be decoded in the same
    //   way.
    // let str = [];
    // for (let ii = 0; ii < buf.length; ++ii) {
    //   str.push(String.fromCharCode(buf[ii]));
    // }
    // client.socket.send(str.join(''));

    client.socket.send(buf);
    pak.pool();
  }
}

export function netDelaySet(delay, rand) {
  if (delay === undefined) {
    // development defaults
    delay = 100;
    rand = 50;
  }
  if (delay) {
    console.log(`NetDelay: ON (${delay}+${rand})`);
  } else {
    console.log('NetDelay: Off');
  }
  net_delay = delay;
  net_delay_rand = rand;
}

export function netDelayGet() {
  return [net_delay, net_delay_rand];
}

function NetDelayer(client, socket) {
  this.client = client;
  this.head = null;
  this.tail = null;
  this.tick = this.tickFn.bind(this);
}
NetDelayer.prototype.send = function (buf, pak) {
  let now = Date.now();
  let delay = round(net_delay + net_delay_rand * random());
  let time = now + delay;
  let elem = { buf, pak, time, next: null };
  if (this.tail) {
    this.tail.next = elem;
    this.tail = elem;
  } else {
    this.head = this.tail = elem;
    setTimeout(this.tick, delay);
  }
};
NetDelayer.prototype.tickFn = function () {
  let { client } = this;
  if (client.net_delayer !== this) {
    // we've been disconnected, just don't ever write these packets
    while (this.head) {
      let elem = this.head;
      elem.pak.pool();
      this.head = elem.next;
    }
    this.tail = null;
    return;
  }
  // Send at least first, possibly more, then schedule tick if any left
  let now = Date.now();
  do {
    // Pop it
    let elem = this.head;
    this.head = elem.next;
    if (!this.head) {
      this.tail = null;
    }
    // Send it
    let { buf, pak } = elem;
    socketSendInternal(client, buf, pak);
  } while (this.head && this.head.time <= now);
  if (this.head) {
    setTimeout(this.tick, this.head.time - now);
  }
};

export function wsPakSendDest(client, pak) {
  if (!client.connected || client.socket.readyState !== 1) {
    // We only get to this particular location from wsserver.broadcast*, all
    //   other paths will print the actual message and error earlier.
    console.warn(`Attempting to send on a disconnected link (client_id:${client.id}), ignoring`);
    pak.pool();
    return;
  }
  let buf = pak.getBuffer(); // a Uint8Array
  let buf_len = pak.getBufferLen();
  if (buf_len !== buf.length) {
    buf = new Uint8Array(buf.buffer, buf.byteOffset, buf_len);
  }
  perfCounterAddValue('net.send_bytes.total', buf.length);
  wsstats_out.msgs++;
  wsstats_out.bytes += buf.length;
  if (net_delay) {
    if (!client.net_delayer) {
      client.net_delayer = new NetDelayer(client);
    }
    client.net_delayer.send(buf, pak);
  } else {
    socketSendInternal(client, buf, pak);
  }
  client.last_send_time = Date.now();
}

function wsPakSendFinish(pak, err, resp_func) {
  let { client, msg } = pak.ws_data;
  delete pak.ws_data;
  let ack_resp_pkt_id = ackWrapPakFinish(pak, err, resp_func);

  if (!client.connected || client.socket.readyState !== 1) { // WebSocket.OPEN
    if (msg === 'channel_msg') { // client -> server channel message, attach additional debugging info
      pak.seek(0);
      pak.readFlags();
      let header = ackReadHeader(pak);
      let is_packet = isPacket(header.data);
      let channel_id;
      let submsg;
      if (is_packet) {
        pak.ref(); // deal with auto-pool of an empty packet
        channel_id = pak.readAnsiString();
        submsg = pak.readAnsiString();
        if (!pak.ended()) {
          pak.pool();
        }
      } else {
        channel_id = header.data.channel_id;
        submsg = header.data.msg;
      }
      msg = `channel_msg:${channel_id}:${submsg}`;
    }
    if (typeof msg !== 'number') {
      (client.log ? client : console).log(`Attempting to send msg=${msg} on a disconnected link, ignoring`);
      if (!client.log && client.onError && msg) {
        // On the client, if we try to send a new packet while disconnected, this is an application error
        client.onError(`Attempting to send msg=${msg} on a disconnected link`);
      }
    }

    if (ack_resp_pkt_id) {
      // Callback will never be dispatched through ack.js, remove the callback here
      delete client.resp_cbs[ack_resp_pkt_id];
    }
    pak.pool();
    return;
  }

  assert.equal(Boolean(resp_func && resp_func.expecting_response !== false), Boolean(ack_resp_pkt_id));

  wsPakSendDest(client, pak);
}

function wsPakSend(err, resp_func) {
  let pak = this; // eslint-disable-line @typescript-eslint/no-invalid-this
  if (typeof err === 'function' && !resp_func) {
    resp_func = err;
    err = null;
  }
  wsPakSendFinish(pak, err, resp_func);
}

export function wsPak(msg, ref_pak, client, msg_debug_name) {
  assert(typeof msg === 'string' || typeof msg === 'number');

  // Assume new packet needs to be comparable to old packet, in flags and size
  let pak = packetCreate(ref_pak ? ref_pak.getInternalFlags() : packetDefaultFlags(),
    ref_pak ? ref_pak.totalSize() + PAK_HEADER_SIZE : 0);
  pak.writeFlags();

  ackWrapPakStart(pak, client, msg, msg_debug_name);

  pak.ws_data = {
    msg,
    client,
  };
  pak.send = wsPakSend;
  return pak;
}

function sendMessageInternal(client, msg, err, data, msg_debug_name, resp_func) {
  let is_packet = isPacket(data);
  let pak = wsPak(msg, is_packet ? data : null, client, msg_debug_name);

  if (!err) {
    ackWrapPakPayload(pak, data);
  }

  pak.send(err, resp_func);
}

export function sendMessage(msg, data, msg_debug_name, resp_func) {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  sendMessageInternal(this, msg, null, data, msg_debug_name, resp_func);
}

export function wsHandleMessage(client, buf, filter) {
  ++wsstats.msgs;
  let now = Date.now();
  let source = client.id ? `client ${client.id}` : 'server';
  if (!(buf instanceof Uint8Array)) {
    (client.log ? client : console).log(`Received incorrect WebSocket data type from ${source} (${typeof buf})`);
    if (typeof buf === 'string') {
      (client.log ? client : console).log(`Invalid WebSocket data: ${JSON.stringify(buf.slice(0, 120))}`);
    }
    if (client.ws_server) {
      if (!client.has_warned_about_text) {
        // Send an generic error (still as binary, since if they got this far, they
        //   must have received the binary `cack` successfully.
        client.has_warned_about_text = true;
        client.send('error', 'Server received non-binary WebSocket data.  ' +
          'Likely cause is a proxy, VPN or something else intercepting and modifying network traffic.');
      }
      return;
    }
    return void client.onError('Invalid data received');
  }
  wsstats.bytes += buf.length;
  let pak = packetFromBuffer(buf, buf.length, false);
  pak.readFlags();
  client.last_receive_time = now;
  client.idle_counter = 0;

  return void ackHandleMessage(client, source, pak, function sendFunc(msg, err, data, resp_func) {
    if (resp_func && !resp_func.expecting_response) {
      resp_func = null;
    }
    sendMessageInternal(client, msg, err, data, null, resp_func);
  }, function pakFunc(msg, ref_pak) {
    return wsPak(msg, ref_pak, client);
  }, function handleFunc(msg, data, resp_func) {
    let handler = client.handlers[msg];
    if (!handler) {
      let error_msg = `No handler for message ${JSON.stringify(msg)} from ${source}`;
      console.error(error_msg, isPacket(data) ? data.contents() : data);
      if (client.onError) {
        return client.onError(error_msg);
      }
      return resp_func(error_msg);
    }
    return handler(client, data, resp_func);
  }, filter);
}
