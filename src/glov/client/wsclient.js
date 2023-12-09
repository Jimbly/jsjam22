// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* global WebSocket */

/* eslint-disable import/order */
import { getAPIPath, setCurrentEnvironment } from 'glov/client/environments';

const ack = require('glov/common/ack.js');
const { ackInitReceiver } = ack;
const verify = require('glov/common/verify.js');
const assert = require('assert');
const { errorReportSetDetails, session_uid } = require('./error_report.js');
const {
  ERR_CONNECTION,
  fetch,
  fetchDelaySet,
} = require('./fetch.js');
const { min, random } = Math;
const { perfCounterAdd } = require('glov/common/perfcounters.js');
const urlhash = require('./urlhash.js');
const wscommon = require('glov/common/wscommon.js');
const { netDelaySet, wsHandleMessage } = wscommon;
const { platformGetID, getAbilityReloadUpdates } = require('glov/client/client_config.js');

// let net_time = 0;
// export function getNetTime() {
//   let r = net_time;
//   net_time = 0;
//   return r;
// }

// Values exposed for `client.connect_error`
export const ERR_CONNECTING = 'ERR_CONNECTING';
export const ERR_RESTARTING = 'ERR_RESTARTING';
export const ERR_CLIENT_VERSION_NEW = 'ERR_CLIENT_VERSION_NEW';
export const ERR_CLIENT_VERSION_OLD = 'ERR_CLIENT_VERSION_OLD';

exports.CURRENT_VERSION = 0;

export function WSClient(path, client_app) {
  this.id = null;
  this.my_ids = {}; // set of all IDs I've been during this session
  this.handlers = {};
  this.socket = null;
  this.net_delayer = null;
  this.connected = false;
  this.disconnected = false;
  this.retry_scheduled = false;
  this.retry_count = 0;
  this.retry_extra_delay = 0;
  this.disconnect_time = Date.now();
  this.last_receive_time = Date.now();
  this.idle_counter = 0;
  this.last_send_time = Date.now();
  this.connect_error = ERR_CONNECTING;
  this.update_available = false;
  this.client_app = client_app || 'app';
  ackInitReceiver(this);

  if (path) {
    this.path = path;
  }

  this.connect(false);

  this.onMsg('cack', this.onConnectAck.bind(this));
  this.onMsg('build', this.onBuildChange.bind(this));
  this.onMsg('error', this.onError.bind(this));
}

WSClient.prototype.logPacketDispatch = function (source, pak, buf_offs, msg) {
  perfCounterAdd(`ws.${msg}`);
};

WSClient.prototype.timeSinceDisconnect = function () {
  return Date.now() - this.disconnect_time;
};

function getVersionUrlParams() {
  return `plat=${platformGetID()}&ver=${exports.CURRENT_VERSION}&build=${BUILD_TIMESTAMP}`;
}

function jsonParseResponse(response) {
  if (!response) {
    return null;
  }
  if (response.trim()[0] === '<') {
    // html response
    return null;
  }
  try {
    return JSON.parse(response);
  } catch (e) {
    return null;
  }
}

function whenServerReady(cb) {
  let retry_count = 0;
  function doit() {
    fetch({
      url: `${getAPIPath()}ready?${getVersionUrlParams()}`,
    }, (err, response) => {
      if (err) {
        let response_data = jsonParseResponse(response);
        let status = response_data?.status;
        if (status !== 'ERR_CLIENT_VERSION_OLD') {
          ++retry_count;
          setTimeout(doit, min(retry_count * retry_count * 100, 15000) * (0.75 + random() * 0.5));
          return;
        }
      }
      cb();
    });
  }
  doit();
}

WSClient.prototype.onBuildChange = function (obj) {
  // (primarily) development-time dynamic build version change, reload if it's our app that changed
  if (obj.app !== this.client_app) {
    return;
  }
  this.onBuildTimestamp(obj.ver);
};

WSClient.prototype.onBuildTimestamp = function (build_timestamp) {
  if (build_timestamp !== BUILD_TIMESTAMP) {
    if (this.on_build_timestamp_mismatch) {
      this.on_build_timestamp_mismatch();
    } else {
      if (getAbilityReloadUpdates()) {
        console.error(`App build mismatch (server: ${build_timestamp}, client: ${BUILD_TIMESTAMP}), reloading`);
        whenServerReady(function () {
          if (window.reloadSafe) {
            window.reloadSafe();
          } else {
            document.location.reload();
          }
        });
      } else {
        // Not allowed to reload, or reloading would not get the new version anyway
        console.warn(`App build mismatch (server: ${build_timestamp}, client: ${BUILD_TIMESTAMP}), ignoring`);
      }
    }
  }
};

WSClient.prototype.onConnectAck = function (data, resp_func) {
  let client = this;
  client.connected = true;
  client.connect_error = null;
  client.disconnected = false;
  client.id = data.id;
  client.my_ids[data.id] = true;
  errorReportSetDetails('client_id', client.id);
  client.secret = data.secret;
  if (data.build) {
    client.onBuildTimestamp(data.build);
  }
  if (data.net_delay) {
    netDelaySet(data.net_delay[0], data.net_delay[1]);
    fetchDelaySet(data.net_delay[0], data.net_delay[1]);
  }
  // Fire subscription_manager connect handler
  assert(client.handlers.connect);
  data.client_id = client.id;
  client.handlers.connect(client, data);
  resp_func();
};


WSClient.prototype.pak = function (msg, msg_debug_name) {
  return wscommon.wsPak(msg, null, this, msg_debug_name);
};

WSClient.prototype.send = function (msg, data, msg_debug_name, resp_func) {
  if (!verify(typeof msg_debug_name !== 'function')) {
    // Old API
    resp_func = msg_debug_name;
    msg_debug_name = null;
  }
  wscommon.sendMessage.call(this, msg, data, msg_debug_name, resp_func);
};

WSClient.prototype.onError = function (e) {
  console.error('WSClient Error');
  console.error(e);
  if (!(e instanceof Error)) {
    e = new Error(e);
  }
  throw e;
};

// cb(client, data, resp_func)
WSClient.prototype.onMsg = function (msg, cb) {
  assert.ok(!this.handlers[msg]);
  this.handlers[msg] = function wrappedCallback(client, data, resp_func) {
    // Client interface does not need a client passed to it!
    return cb(data, resp_func);
  };
};

WSClient.prototype.checkForNewAppBuild = function () {
  if (!getAbilityReloadUpdates()) {
    // would do nothing with it, don't bother checking
    return;
  }
  if (this.new_build_check_in_progress) {
    return;
  }
  this.new_build_check_in_progress = true;
  fetch({
    url: `${urlhash.getURLBase()}app.ver.json`,
    response_type: 'json'
  }, (err, obj) => {
    this.new_build_check_in_progress = false;
    if (obj && obj.ver) {
      this.onBuildTimestamp(obj.ver);
    }
    if (err && err !== ERR_CONNECTION) {
      // If this is not triggered on connection errors, only if we got a (non-parseable) response from the server
      if (!this.delayed_recheck) {
        this.delayed_recheck = true;
        setTimeout(() => {
          this.delayed_recheck = false;
          this.checkForNewAppBuild();
        }, 1000);
      }
    }
  });
};

WSClient.prototype.retryConnection = function () {
  let client = this;
  assert(!client.socket);
  assert(!client.retry_scheduled);
  client.retry_scheduled = true;
  ++client.retry_count;
  this.checkForNewAppBuild();
  setTimeout(function () {
    assert(client.retry_scheduled);
    assert(!client.socket);
    client.retry_scheduled = false;
    client.connect(true);
  }, min(client.retry_count * client.retry_count * 100, 15000) * (0.75 + random() * 0.5) + this.retry_extra_delay);
  this.retry_extra_delay = 0;
};

WSClient.prototype.checkDisconnect = function () {
  if (this.connected && this.socket.readyState !== 1) { // WebSocket.OPEN
    // We think we're connected, but we're not, we must have received an
    // animation frame before the close event when phone was locked or something
    this.on_close();
    assert(!this.connected);
  }
};

WSClient.prototype.connect = function (for_reconnect) {
  let client = this;
  client.socket = { readyState: 0 }; // Placeholder so it appears disconnected

  assert(!this.ready_check_in_progress);
  this.ready_check_in_progress = true;
  // retry hitting status endpoint until it says it's okay to make a WebSocket connection
  fetch({
    url: `${getAPIPath()}ready?${getVersionUrlParams()}`,
  }, (err, response) => {
    let response_data = jsonParseResponse(response);
    let status = response_data?.status;
    let redirect_environment = response_data?.redirect_environment;
    this.update_available = response_data?.update_available;
    let should_reload = this.update_available && getAbilityReloadUpdates();

    assert(this.ready_check_in_progress);
    this.ready_check_in_progress = false;
    this.connect_error = ERR_CONNECTING;

    if (!err && !redirect_environment && !should_reload) {
      if (this.update_available) {
        // TODO: Inform the user that a new version is available,
        // even though the current version is still supported
      }
      return void this.connectAfterReady(for_reconnect);
    }

    console.log(`Server not ready, err=${err}, response=${response}`);
    // Handle known error strings
    if (status === 'ERR_RESTARTING' || status === 'ERR_STARTUP') {
      client.connect_error = ERR_RESTARTING;
    } else if (status === 'ERR_CLIENT_VERSION_NEW') {
      client.connect_error = ERR_CLIENT_VERSION_NEW;
    } else if (status === 'ERR_CLIENT_VERSION_OLD') {
      client.connect_error = ERR_CLIENT_VERSION_OLD;
    }

    if (redirect_environment) {
      setCurrentEnvironment(redirect_environment);
    }

    client.socket = null;
    client.net_delayer = null;
    this.retryConnection();
  });
};

let connect_url_params = '';
let connect_url_extra = {};
export function wsclientSetExtraParam(key, value) {
  if (!value) {
    delete connect_url_extra[key];
  } else {
    connect_url_extra[key] = value;
  }
  let pairs = [];
  for (let walk in connect_url_extra) {
    pairs.push(`${walk}=${connect_url_extra[walk]}`);
  }
  if (pairs.length) {
    connect_url_params = `&${pairs.join('&')}`;
  } else {
    connect_url_params = '';
  }
}

WSClient.prototype.connectAfterReady = function (for_reconnect) {
  let client = this;

  let path = client.path ||
    getAPIPath()      // 'https://foo.com/product/api/'
    .replace(/^http/, 'ws')
    .replace(/api\/$/, 'ws'); // 'wss://foo.com/product/ws';
  path = `${path}?${getVersionUrlParams()}${
    for_reconnect && client.id && client.secret ? `&reconnect=${client.id}&secret=${client.secret}` : ''
  }&sesuid=${session_uid}${connect_url_params}`;
  let socket = new WebSocket(path);
  socket.binaryType = 'arraybuffer';
  client.socket = socket;

  // Protect callbacks from ever firing if we've already disconnected this socket
  //   from the WSClient
  function guard(fn) {
    return function (...args) {
      if (client.socket !== socket) {
        return;
      }
      fn(...args);
    };
  }

  function abort(skip_close) {
    client.socket = null;
    client.net_delayer = null;
    if (client.connected) {
      client.disconnect_time = Date.now();
      client.disconnected = true;
      errorReportSetDetails('disconnected', 1);
    }
    client.connected = false;
    client.connect_error = ERR_CONNECTING;
    if (!skip_close) {
      try {
        socket.close();
      } catch (e) {
        // ignore
      }
    }
    // Fire subscription_manager disconnect handler
    client.handlers.disconnect();
    ack.failAll(client);
  }

  function retry(skip_close) {
    abort(skip_close);
    client.retryConnection();
  }

  // Local state, for this one connection
  let connected = false;
  client.socket.addEventListener('error', guard(function (err) {
    if (!connected) {
      console.log('WebSocket error during initial connection, retrying...', err);
      retry();
    } else {
      console.error('WebSocket error', err);
      // Disconnect and reconnect here, is this a terminal error? Probably not, we'll get a 'close' event if it is?
      // We some error occasionally on iOS, not sure what error, but it auto-reconnects fine, so let's
      // not do a throw
      // client.onError(err);
    }
  }));

  client.socket.addEventListener('message', guard(function (message) {
    profilerStart('WS');
    // net_time -= Date.now();
    assert(message.data instanceof ArrayBuffer);
    wsHandleMessage(client, new Uint8Array(message.data));
    // net_time += Date.now();
    profilerStop('WS');
  }));

  client.socket.addEventListener('open', guard(function () {
    console.log('WebSocket open');
    connected = true;
    // reset retry count so next retry is fast if we get disconnected
    client.retry_count = 0;
  }));

  // This may get called before the close event gets to use
  client.on_close = guard(function () {
    console.log('WebSocket close, retrying connection...');
    retry(true);
  });
  client.socket.addEventListener('close', client.on_close);

  let doPing = guard(function () {
    if (Date.now() - client.last_send_time >= wscommon.PING_TIME &&
      client.connected && client.socket.readyState === 1
    ) {
      client.send('ping');
    }
    setTimeout(doPing, wscommon.PING_TIME / 2);
  });
  setTimeout(doPing, wscommon.PING_TIME / 2);

  // For debugging reconnect handling
  // setTimeout(function () {
  //   if (connected) {
  //     socket.close();
  //   }
  // }, 5000);
};
