// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// eslint-disable-next-line no-use-before-define
exports.netBuildString = buildString;
// eslint-disable-next-line no-use-before-define
exports.netInit = init;

/* eslint-disable import/order */
const { filewatchStartup } = require('./filewatch.js');
const packet = require('glov/common/packet.js');
const subscription_manager = require('./subscription_manager.js');
const wsclient = require('./wsclient.js');
const wscommon = require('glov/common/wscommon.js');
const WSClient = wsclient.WSClient;

let client;
let subs;

export function init(params) {
  params = params || {};
  if (params.ver) {
    wsclient.CURRENT_VERSION = params.ver;
  }
  if (String(document.location).match(/^https?:\/\/localhost/)) {
    console.log('PacketDebug: ON');
    packet.default_flags |= packet.PACKET_DEBUG;
    if (!params.no_net_delay) {
      wscommon.netDelaySet();
    }
  }
  client = new WSClient(params.path);
  subs = subscription_manager.create(client, params.cmd_parse);
  subs.auto_create_user = Boolean(params.auto_create_user);
  subs.no_auto_login = Boolean(params.no_auto_login);
  subs.allow_anon = Boolean(params.allow_anon);
  window.subs = subs; // for debugging
  exports.subs = subs;
  exports.client = client;
  filewatchStartup(client);

  if (params.engine) {
    params.engine.addTickFunc((dt) => {
      client.checkDisconnect();
      subs.tick(dt);
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

export function netDisconnected() {
  return !client || !client.connected || client.disconnected || subs.logging_in ||
    !client.socket || client.socket.readyState !== 1;
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
