// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
const { max } = Math;
import * as ack from 'glov/common/ack.js';
const { ackInitReceiver, ackWrapPakFinish, ackWrapPakPayload } = ack;
import { isPacket } from 'glov/common/packet';
import { platformIsValid } from 'glov/common/platform';
import * as events from 'glov/common/tiny-events.js';
import * as util from 'glov/common/util.js';
import * as wscommon from 'glov/common/wscommon.js';
const { netDelayGet, wsHandleMessage, wsPak, wsPakSendDest } = wscommon;
import * as WebSocket from 'ws';

import { ipBanReady, ipBanned } from './ip_ban';
import { keyMetricsAddTagged } from './key_metrics';
import { logEx } from './log';
import { packetLog, packetLogInit } from './packet_log';
import { ipFromRequest, isLocalHost, requestGetQuery } from './request_utils';
import { VersionSupport, getVersionSupport, isValidVersion } from './version_management';

function WSClient(ws_server, socket) {
  events.EventEmitter.call(this);
  this.ws_server = ws_server;
  this.socket = socket;
  this.id = ++ws_server.last_client_id;
  this.secret = Math.ceil(Math.random() * 1e10).toString();
  this.addr = ipFromRequest(socket.handshake);
  this.glov_is_dev = isLocalHost(this.addr);
  if (socket.handshake.headers) {
    this.user_agent = socket.handshake.headers['user-agent'];
    this.origin = socket.handshake.headers.origin;
  }
  let query = requestGetQuery(socket.handshake);
  this.client_plat = query.plat;
  this.client_ver = query.ver;
  this.client_build = query.build;
  // Note: client_tags only has client-scoped ABTest tags, not user-scoped (UserWorker gets those in rich presence)
  this.client_tags = query.abt ? query.abt.split(',') : [];
  if (this.client_plat) {
    this.client_tags.push(this.client_plat);
  }
  this.handlers = ws_server.handlers; // reference, not copy!
  this.connected = true;
  this.disconnected = false;
  this.last_receive_time = Date.now();
  this.idle_counter = 0;
  ackInitReceiver(this);
  ws_server.clients[this.id] = this;
  this.logPacketDispatch = ws_server.logPacketDispatch.bind(ws_server);
}
util.inherits(WSClient, events.EventEmitter);

WSClient.prototype.ctx = function () {
  let user_id = this.client_channel && this.client_channel.log_user_id || undefined;
  return {
    client: this.client_id,
    ip: this.addr,
    user_id,
  };
};

WSClient.prototype.logCtx = function (level, ...args) {
  let ctx = this.ctx();
  logEx(ctx, level, `WSClient:${this.client_id}(${ctx.user_id || ''})`, ...args);
};

WSClient.prototype.log = function (...args) {
  this.logCtx('info', ...args);
};

WSClient.prototype.onError = function (e) {
  this.ws_server.last_client = this;
  this.ws_server.emit('error', e, this);
};

WSClient.prototype.onClose = function () {
  let client = this;
  if (!client.connected) {
    return;
  }
  let ws_server = client.ws_server;
  client.connected = false;
  client.disconnected = true;
  delete ws_server.clients[client.id];
  this.log(`disconnected (${Object.keys(ws_server.clients).length} clients connected)`);
  ack.failAll(client); // Should this be before or after other disconnect events?
  client.emit('disconnect');
  ws_server.emit('disconnect', client);
};

WSClient.prototype.send = wscommon.sendMessage;

WSClient.prototype.pak = function (msg, ref_pak, msg_debug_name) {
  return wsPak(msg, ref_pak, this, msg_debug_name);
};

function WSServer() {
  events.EventEmitter.call(this);
  this.wss = null;
  this.last_client_id = 0;
  this.last_client = null; // Last client to have had a message dispatched
  this.clients = Object.create(null);
  this.handlers = {};
  this.restarting = undefined;
  this.app_build_timestamp = { app: 0 };
  this.restart_filter = null;
  this.onMsg('ping', util.nop);
  packetLogInit(this);
}
util.inherits(WSServer, events.EventEmitter);

WSServer.prototype.logPacketDispatch = packetLog;
WSServer.prototype.perf_prefix = 'ws.';

// `filter` returns true if message is allowed while shutting down
WSServer.prototype.setRestartFilter = function (filter) {
  this.restart_filter = filter;
};

// cb(client, data, resp_func)
WSServer.prototype.onMsg = function (msg, cb) {
  assert.ok(!this.handlers[msg]);
  this.handlers[msg] = cb;
};

let large_packet_counts = {}; // msg -> { count, largest, last_log }
function logBigFilter(client, msg, data) {
  if (client.log_packet_size >= 65536) {
    let count_data = large_packet_counts[msg];
    if (!count_data) {
      count_data = large_packet_counts[msg] = { count: 0, largest: 0, last_log: 0 };
    }
    count_data.count++;
    count_data.largest = max(count_data.largest, client.log_packet_size);
    let do_log = count_data.count >= count_data.last_log * 10;
    if (do_log) {
      count_data.last_log = count_data.count;
      client.logCtx('warn', `Received large WebSocket packet (${client.log_packet_size}) for message ${msg}.`+
        ` ${count_data.count} occurrences, largest=${count_data.largest} bytes`);
    }
  }
  return true; // always accept
}

WSServer.prototype.init = function (server, server_https, no_timeout, dev) {
  let ws_server = this;
  ws_server.wss = new WebSocket.Server({ noServer: true, maxPayload: 1024*1024 });

  // Doing my own upgrade handling to early-reject invalid protocol versions
  let onUpgrade = (req, socket, head) => {
    if (ipBanReady()) {
      let addr = ipFromRequest(req);
      if (ipBanned(addr)) {
        logEx({
          ip: addr,
        }, 'info', `WS Client rejected (ip banned) from ${addr}: ${req.url}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.end();
        socket.destroy();
        return;
      }
    }

    let query = requestGetQuery(req);
    let plat = query.plat ?? null;
    let ver = query.ver ?? null;
    let versionSupport = plat !== null && ver !== null && platformIsValid(plat) && isValidVersion(ver) ?
      getVersionSupport(plat, ver) :
      VersionSupport.Obsolete;
    if (versionSupport !== VersionSupport.Supported) {
      logEx({
        ip: ipFromRequest(req),
      }, 'info', `WS Client rejected (bad ver) from ${ipFromRequest(req)}: ${req.url}`);
      socket.write('HTTP/1.1 400 Invalid Protocol\r\n\r\n');
      socket.end();
      socket.destroy();
      return;
    }

    ws_server.wss.handleUpgrade(req, socket, head, function done(ws) {
      ws_server.wss.emit('connection', ws, req);
    });
  };
  server.on('upgrade', onUpgrade);
  ws_server.http_servers = [server];
  if (server_https) {
    ws_server.http_servers.push(server_https);
    server_https.on('upgrade', onUpgrade);
  }

  ws_server.wss.on('connection', (socket, req) => {
    socket.handshake = req;
    let client = new WSClient(ws_server, socket);

    socket.on('close', function () {
      // disable this for testing
      client.onClose();
    });
    socket.on('message', function (data) {
      if (client.disconnected) {
        // message received after disconnect!
        // ignore
        client.log('ignoring message received after disconnect');
      } else {
        ws_server.last_client = client;
        client.log_packet_size = data && data.length;
        let log_data;
        try {
          // This doesn't actually work for the packets we were receiving in
          //   production, they contain 0xFFFD characters, which means data has
          //   been lost, we cannot possibly make the data work.
          // if (typeof data === 'string') {
          //   client.logCtx('debug', `Received incorrect WebSocket data type (${typeof data}), auto-fixing...`);
          //   log_data = data;
          //   data = Buffer.from(data, 'binary');
          // }
          wsHandleMessage(client, data, ws_server.restarting && ws_server.restart_filter || logBigFilter);
        } catch (e) {
          e.source = client.ctx();
          client.logCtx('error', `Exception "${e}" while handling packet from`, e.source);
          client.logCtx('error', `Packet data (base64) = ${data.toString('base64', 0, 1000000)}`);
          client.logCtx('error', 'Packet data (utf8,1K) = ' +
            `${JSON.stringify(log_data || data.toString('utf8', 0, 1000))}`);
          ws_server.emit('uncaught_exception', e);
        }
      }
    });
    socket.on('error', function (e) {
      // Get low level errors here, as well as WS_ERR_UNSUPPORTED_MESSAGE_LENGTH (1009)
      client.onError(e);
    });
    ws_server.emit('client', client);

    // log and send cack after the .emit('client') has a chance to set client.client_id
    client.client_id = client.client_id || client.id;

    client.log(`connected to ${req.url} from ${client.addr}` +
      ` (${Object.keys(ws_server.clients).length} clients connected)`,
    {
      ua: client.user_agent,
      origin: client.origin,
      url: req.url,
      plat: client.client_plat,
      ver: client.client_ver,
      build: client.client_build,
    });

    keyMetricsAddTagged('wsconnect', client.client_tags, 1);

    let query = requestGetQuery(req);
    let client_app = query.app || 'app';
    let cack_data = {
      id: client.client_id,
      secret: client.secret,
      build: this.app_build_timestamp[client_app],
      restarting: ws_server.restarting,
    };
    if (dev) {
      cack_data.net_delay = netDelayGet();
    }
    ws_server.emit('cack_data', cack_data, client);

    client.send('cack', cack_data);

    let reconnect_id = Number(query.reconnect);
    if (reconnect_id) {
      // we're reconnecting an existing client, immediately disconnect the old one
      let old_client = ws_server.clients[reconnect_id];
      if (old_client) {
        if (old_client.secret === query.secret) {
          old_client.log('being replaced by reconnect, disconnecting...');
          this.disconnectClient(old_client);
        } else {
          client.log(`requested disconnect of Client ${reconnect_id} with incorrect secret, ignoring`);
        }
      }
    }
  });

  if (!no_timeout) {
    this.check_timeouts_fn = this.checkTimeouts.bind(this);
    setTimeout(this.check_timeouts_fn, wscommon.CONNECTION_TIMEOUT / 4);
  }
};

WSServer.prototype.disconnectClient = function (client) {
  try {
    client.socket.close();
  } catch (err) {
    // ignore
  }
  client.onClose();
};

WSServer.prototype.checkTimeouts = function () {
  for (let client_id in this.clients) {
    let client = this.clients[client_id];
    client.idle_counter++;
    if (client.idle_counter === 5) {
      client.log('timed out, disconnecting...');
      this.disconnectClient(client);
    }
  }
  setTimeout(this.check_timeouts_fn, wscommon.CONNECTION_TIMEOUT / 4);
};

WSServer.prototype.close = function () {
  for (let client_id in this.clients) {
    let client = this.clients[client_id];
    this.disconnectClient(client);
  }
  for (let ii = 0; ii < this.http_servers.length; ++ii) {
    this.http_servers[ii].close();
  }
};

WSServer.prototype.checkAllIPBans = function () {
  assert(ipBanReady());
  for (let client_id in this.clients) {
    let client = this.clients[client_id];
    if (ipBanned(client.addr)) {
      client.log('IP is now banned, disconnecting...');
      this.disconnectClient(client);
    }
  }
};

// Must be a ready-to-send packet created with .pak, not just the payload
WSServer.prototype.broadcastPacket = function (pak) {
  let ws_server = this;
  let num_sent = 0;
  assert(isPacket(pak)); // And should have been created with pak()
  ackWrapPakFinish(pak);
  for (let client_id in ws_server.clients) {
    if (ws_server.clients[client_id]) {
      let client = ws_server.clients[client_id];
      pak.ref();
      wsPakSendDest(client, pak);
      ++num_sent;
    }
  }
  pak.pool();
  return num_sent;
};

WSServer.prototype.broadcast = function (msg, data) {
  assert(!isPacket(data));
  let pak = wsPak(msg);
  ackWrapPakPayload(pak, data);
  return this.broadcastPacket(pak);
};

WSServer.prototype.setAppBuildTimestamp = function (app, ver) {
  assert(ver);
  this.app_build_timestamp[app] = ver;
};

export function isClient(obj) {
  return obj instanceof WSClient;
}

WSServer.prototype.isClient = isClient;

WSServer.prototype.pak = wsPak;

export function create(...args) {
  let ret = new WSServer();
  ret.init(...args);
  return ret;
}
