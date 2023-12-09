// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import { callEach } from 'glov/common/util.js';

// eslint-disable-next-line @typescript-eslint/no-use-before-define
exports.netBuildString = buildString;
// eslint-disable-next-line @typescript-eslint/no-use-before-define
exports.netInit = init;

/* eslint-disable import/order */
const { filewatchStartup } = require('./filewatch.js');
const { packetEnableDebug } = require('glov/common/packet.js');
const subscription_manager = require('./subscription_manager.js');
const wsclient = require('./wsclient.js');
const WSClient = wsclient.WSClient;

let client;
let subs;

let post_net_init = [];

export function netPostInit(cb) {
  if (post_net_init) {
    post_net_init.push(cb);
  } else {
    cb();
  }
}

export function init(params) {
  params = params || {};
  if (params.ver) {
    wsclient.CURRENT_VERSION = params.ver;
  }
  if (String(document.location).match(/^https?:\/\/localhost/)) {
    if (!params.no_packet_debug) {
      console.log('PacketDebug: ON');
      packetEnableDebug(true);
    }
  }
  client = new WSClient(params.path, params.client_app);
  subs = subscription_manager.create(client, params.cmd_parse);
  subs.auto_create_user = Boolean(params.auto_create_user);
  subs.no_auto_login = Boolean(params.no_auto_login);
  subs.allow_anon = Boolean(params.allow_anon);
  window.subs = subs; // for debugging
  exports.subs = subs;
  exports.client = client;
  callEach(post_net_init, post_net_init = null);
  filewatchStartup(client);

  if (params.engine) {
    params.engine.addTickFunc((dt) => {
      client.checkDisconnect();
      subs.tick(dt);
    });

    params.engine.onLoadMetrics((obj) => {
      subs.onceConnected(() => {
        client.send('load_metrics', obj);
      });
    });
  }
}

const build_timestamp_string = new Date(Number(BUILD_TIMESTAMP))
  .toISOString()
  .replace('T', ' ')
  .slice(5, -8);
export function buildString() {
  return wsclient.CURRENT_VERSION ? `${wsclient.CURRENT_VERSION} (${build_timestamp_string})` : build_timestamp_string;
}

export function netDisconnectedRaw() {
  return !client || !client.connected || client.disconnected ||
    !client.socket || client.socket.readyState !== 1;
}

export function netDisconnected() {
  return netDisconnectedRaw() || subs.logging_in;
}

export function netForceDisconnect() {
  if (subs) {
    subs.was_logged_in = false;
  }
  client?.socket?.close?.();
}

export function netClient() {
  return client;
}

export function netClientId() {
  return client.id;
}

export function netUserId() {
  return subs.getUserId();
}

export function netSubs() {
  return subs;
}
