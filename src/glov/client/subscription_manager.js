// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const assert = require('assert');
const {
  chunkedReceiverFinish,
  chunkedReceiverInit,
  chunkedReceiverOnChunk,
  chunkedReceiverStart,
  chunkedReceiverFreeFile,
  chunkedReceiverGetFile,
} = require('glov/common/chunked_send.js');
import { PLATFORM_FBINSTANT } from 'glov/client/client_config.js';
const dot_prop = require('glov/common/dot-prop.js');
const EventEmitter = require('glov/common/tiny-events.js');
const { fbGetLoginInfo } = require('./fbinstant.js');
const local_storage = require('./local_storage.js');
const md5 = require('glov/common/md5.js');
const { netDisconnected } = require('./net.js');
const { isPacket } = require('glov/common/packet.js');
const { perfCounterAdd } = require('glov/common/perfcounters.js');
const util = require('glov/common/util.js');
const { errorString } = util;
const walltime = require('./walltime.js');

// relevant events:
//   .on('channel_data', cb(data [, mod_key, mod_value]));

function ClientChannelWorker(subs, channel_id, base_handlers) {
  EventEmitter.call(this);
  this.subs = subs;
  this.channel_id = channel_id;
  this.subscriptions = 0;
  this.subscribe_failed = false;
  this.got_subscribe = false;
  this.immediate_subscribe = 0;
  this.channel_data_ver = 0; // for polling for changes
  this.handlers = Object.create(base_handlers);
  this.data = {};
}
util.inherits(ClientChannelWorker, EventEmitter);

// cb(data)
ClientChannelWorker.prototype.onSubscribe = function (cb) {
  assert(this.subscriptions || this.autosubscribed);
  this.on('subscribe', cb);
  if (this.got_subscribe) {
    cb(this.data);
  }
};

// cb(data)
ClientChannelWorker.prototype.onceSubscribe = function (cb) {
  assert(this.subscriptions || this.autosubscribed);
  if (this.got_subscribe) {
    cb(this.data);
  } else {
    this.once('subscribe', cb);
  }
};


ClientChannelWorker.prototype.handleChannelData = function (data, resp_func) {
  console.log(`got channel_data(${this.channel_id}):  ${JSON.stringify(data)}`);
  this.data = data;
  ++this.channel_data_ver;
  this.emit('channel_data', this.data);
  this.got_subscribe = true;
  this.emit('subscribe', this.data);

  // Get command list upon first connect
  let channel_type = this.channel_id.split('.')[0];
  let cmd_list = this.subs.cmds_fetched_by_type;
  if (cmd_list && !cmd_list[channel_type]) {
    cmd_list[channel_type] = true;
    this.send('cmdparse', 'cmd_list', (err, resp) => {
      if (err) { // already unsubscribed?
        console.error(`Error getting cmd_list for ${channel_type}`);
        delete cmd_list[channel_type];
      } else {
        this.subs.cmd_parse.addServerCommands(resp);
      }
    });
  }

  resp_func();
};

ClientChannelWorker.prototype.handleApplyChannelData = function (data, resp_func) {
  // already logged in handleChannelMessage
  // if (!data.q) {
  //   console.log(`got channel data mod: ${JSON.stringify(data)}`);
  // }
  if (data.value === undefined) {
    dot_prop.delete(this.data, data.key);
  } else {
    dot_prop.set(this.data, data.key, data.value);
  }
  ++this.channel_data_ver;
  this.emit('channel_data', this.data, data.key, data.value);
  resp_func();
};

ClientChannelWorker.prototype.handleBatchSet = function (data, resp_func) {
  for (let ii = 0; ii < data.length; ++ii) {
    let [key, value] = data[ii];
    if (value === undefined) {
      dot_prop.delete(this.data.public, key);
    } else {
      dot_prop.set(this.data.public, key, value);
    }
    // Question: Should this just be one event at the end?
    ++this.channel_data_ver;
    this.emit('channel_data', this.data, `public.${key}`, value);
  }
  resp_func();
};

ClientChannelWorker.prototype.getChannelData = function (key, default_value) {
  return dot_prop.get(this.data, key, default_value);
};

ClientChannelWorker.prototype.setChannelData = function (key, value, skip_predict, resp_func) {
  if (!skip_predict) {
    dot_prop.set(this.data, key, value);
  }
  let q = value && value.q || undefined;
  let pak = this.subs.client.pak('set_channel_data');
  pak.writeAnsiString(this.channel_id);
  pak.writeBool(q);
  pak.writeAnsiString(key);
  pak.writeJSON(value);
  pak.send(resp_func);
};

ClientChannelWorker.prototype.removeMsgHandler = function (msg, cb) {
  assert(this.handlers[msg] === cb);
  delete this.handlers[msg];
};

ClientChannelWorker.prototype.onMsg = function (msg, cb) {
  assert(!this.handlers[msg] || this.handlers[msg] === cb);
  this.handlers[msg] = cb;
};

ClientChannelWorker.prototype.pak = function (msg) {
  let pak = this.subs.client.pak('channel_msg');
  pak.writeAnsiString(this.channel_id);
  pak.writeAnsiString(msg);
  // pak.writeInt(flags);
  return pak;
};

ClientChannelWorker.prototype.send = function (msg, data, resp_func, old_fourth) {
  assert(!resp_func || typeof resp_func === 'function');
  assert(!old_fourth);
  this.subs.client.send('channel_msg', {
    channel_id: this.channel_id,
    msg, data,
  }, resp_func);
};

ClientChannelWorker.prototype.cmdParse = function (cmd, resp_func) {
  this.send('cmdparse', cmd, resp_func);
};

function SubscriptionManager(client, cmd_parse) {
  EventEmitter.call(this);
  this.client = client;
  this.channels = {};
  this.logged_in = false;
  this.login_credentials = null;
  this.logged_in_username = null;
  this.was_logged_in = false;
  this.logging_in = false;
  this.logging_out = false;
  this.auto_create_user = false;
  this.allow_anon = false;
  this.no_auto_login = false;
  this.cmd_parse = cmd_parse;
  if (cmd_parse) {
    this.cmds_fetched_by_type = {};
  }
  this.base_handlers = {};
  this.channel_handlers = {}; // channel type -> msg -> handler

  this.first_connect = true;
  this.server_time = 0;
  this.server_time_interp = 0;
  this.cack_data = {};
  client.onMsg('connect', this.handleConnect.bind(this));
  client.onMsg('disconnect', this.handleDisconnect.bind(this));
  client.onMsg('channel_msg', this.handleChannelMessage.bind(this));
  client.onMsg('server_time', this.handleServerTime.bind(this));
  client.onMsg('chat_broadcast', this.handleChatBroadcast.bind(this));
  client.onMsg('restarting', this.handleRestarting.bind(this));
  if (cmd_parse) {
    client.onMsg('csr_to_client', this.handleCSRToClient.bind(this));
  }
  this.chunked = null;
  client.onMsg('upload_start', this.handleUploadStart.bind(this));
  client.onMsg('upload_chunk', this.handleUploadChunk.bind(this));
  client.onMsg('upload_finish', this.handleUploadFinish.bind(this));
  // Add handlers for all channel types
  this.onChannelMsg(null, 'channel_data', ClientChannelWorker.prototype.handleChannelData);
  this.onChannelMsg(null, 'apply_channel_data', ClientChannelWorker.prototype.handleApplyChannelData);
  this.onChannelMsg(null, 'batch_set', ClientChannelWorker.prototype.handleBatchSet);
}
util.inherits(SubscriptionManager, EventEmitter);

SubscriptionManager.prototype.onceConnected = function (cb) {
  if (this.client.connected && this.client.socket.readyState === 1) {
    return void cb();
  }
  this.once('connect', cb);
};

SubscriptionManager.prototype.getBaseHandlers = function (channel_type) {
  let handlers = this.channel_handlers[channel_type];
  if (!handlers) {
    handlers = this.channel_handlers[channel_type] = Object.create(this.base_handlers);
  }
  return handlers;
};

SubscriptionManager.prototype.onChannelMsg = function (channel_type, msg, cb) {
  let handlers = channel_type ? this.getBaseHandlers(channel_type) : this.base_handlers;
  assert(!handlers[msg]);
  handlers[msg] = cb;
};

SubscriptionManager.prototype.handleChatBroadcast = function (data) {
  console.error(`[${data.src}] ${data.msg}`);
  this.emit('chat_broadcast', data);
};

SubscriptionManager.prototype.handleRestarting = function (data) {
  this.restarting = data;
  this.emit('restarting', data);
};

SubscriptionManager.prototype.handleDisconnect = function (data) {
  this.emit('disconnect', data);
};

SubscriptionManager.prototype.handleConnect = function (data) {
  let reconnect = false;
  if (this.first_connect) {
    this.first_connect = false;
  } else {
    reconnect = true;
  }
  this.restarting = Boolean(data.restarting);
  this.cack_data = data;
  walltime.sync(data.time);

  if (!this.client.connected || this.client.socket.readyState !== 1) { // WebSocket.OPEN
    // we got disconnected while trying to log in, we'll retry after reconnection
    return;
  }

  let subs = this;
  function resub() {
    // (re-)subscribe to all channels
    for (let channel_id in subs.channels) {
      let channel = subs.channels[channel_id];
      if (channel.subscriptions) {
        subs.client.send('subscribe', channel_id, function (err) {
          if (err) {
            channel.subscribe_failed = true;
            console.error(`Error subscribing to ${channel_id}: ${err}`);
            channel.emit('subscribe_fail', err);
          }
        });
      }
    }
    subs.emit('connect', reconnect);
  }

  if (this.logging_in) {
    // already have a login in-flight, it should error before we try again
  } else if (this.was_logged_in) {
    // Try to re-connect to existing login
    this.loginInternal(this.login_credentials, (err) => {
      if (err && err === 'ERR_FAILALL_DISCONNECT') {
        // we got disconnected while trying to log in, we'll retry after reconnection
      } else if (err) {
        // Error logging in upon re-connection, no good way to handle this?
        // TODO: Show some message to the user and prompt them to refresh?  Stay in "disconnected" state?
        let credentials_str = this.login_credentials && this.login_credentials.password ?
          'user_id, password' :
          JSON.stringify(this.login_credentials);
        assert(false, `Login failed for ${credentials_str}: ${errorString(err)}`);
      } else {
        resub();
      }
    });
  } else if (!this.no_auto_login) {
    // Try auto-login
    let auto_login_enabled = PLATFORM_FBINSTANT;

    if (auto_login_enabled) {
      let login_cb = () => {
        // ignore error on auto-login
      };
      if (PLATFORM_FBINSTANT) {
        this.loginFacebook(login_cb);
      }
    } else if (local_storage.get('name') && local_storage.get('password')) {
      this.login(local_storage.get('name'), local_storage.get('password'), function () {
        // ignore error on auto-login
      });
    }

    resub();
  } else {
    resub();
  }

  this.fetchCmds();
};

SubscriptionManager.prototype.fetchCmds = function () {
  let channel_type = 'client';
  let cmd_list = this.cmds_fetched_by_type;
  if (cmd_list && !cmd_list[channel_type]) {
    cmd_list[channel_type] = true;
    this.client.send('cmd_parse_list_client', null, (err, resp) => {
      if (!err) {
        this.cmd_parse.addServerCommands(resp);
      }
    });
  }
};

SubscriptionManager.prototype.handleChannelMessage = function (pak, resp_func) {
  assert(isPacket(pak));
  let channel_id = pak.readAnsiString();
  let msg = pak.readAnsiString();
  let is_packet = pak.readBool();
  let data = is_packet ? pak : pak.readJSON();
  if (!data || !data.q) {
    let debug_msg;
    if (!is_packet) {
      debug_msg = JSON.stringify(data);
    } else if (typeof data.contents === 'function') {
      debug_msg = data.contents();
    } else {
      debug_msg = '(pak)';
    }
    console.log(`got channel_msg(${channel_id}) ${msg}: ${debug_msg}`);
  }
  let channel = this.getChannel(channel_id);
  let handler = channel.handlers[msg];
  if (!handler) {
    console.error(`no handler for channel_msg(${channel_id}) ${msg}: ${JSON.stringify(data)}`);
    return;
  }
  perfCounterAdd(`cm.${channel_id.split('.')[0]}.${msg}`);
  handler.call(channel, data, resp_func);
};

SubscriptionManager.prototype.handleServerTime = function (pak) {
  this.server_time = pak.readInt();
  if (this.server_time < this.server_time_interp && this.server_time > this.server_time_interp - 250) {
    // slight time travel backwards, this one packet must have been delayed,
    // since we once got a packet quicker. Just ignore this, interpolate from
    // where we were before
    // TODO: If the server had a short stall (less than 250ms) we might be
    // ahead from now on!  Slowly interp back to the specified time
    // (run speed at 90% until it matches?, same thing for catching up to
    // small jumps ahead)
  } else {
    this.server_time_interp = this.server_time;
  }
  walltime.sync(pak.readInt());
};

// DEPRECATED: Not actually a useful unit of time, if your client worker is on a
//   different process than a particular game worker.
SubscriptionManager.prototype.getServerTime = function () {
  // Interpolated server time as of start of last tick
  return this.server_time_interp;
};

SubscriptionManager.prototype.tick = function (dt) {
  this.server_time_interp += dt;
  for (let channel_id in this.channels) {
    let channel = this.channels[channel_id];
    if (channel.immediate_subscribe) {
      if (dt >= channel.immediate_subscribe) {
        channel.immediate_subscribe = 0;
        this.unsubscribe(channel_id);
      } else {
        channel.immediate_subscribe -= dt;
      }
    }
  }
};


SubscriptionManager.prototype.onUploadProgress = function (mime_type, cb) {
  if (!this.upload_progress_cbs) {
    this.upload_progress_cbs = {};
  }
  assert(!this.upload_progress_cbs[mime_type]);
  this.upload_progress_cbs[mime_type] = cb;
  if (!this.chunked) {
    this.chunked = chunkedReceiverInit('client_receive', Infinity);
  }
  if (!this.chunked.on_progress) {
    this.chunked.on_progress = (progress, total, type) => {
      if (this.upload_progress_cbs[type]) {
        this.upload_progress_cbs[type](progress, total);
      }
    };
  }
};

SubscriptionManager.prototype.handleUploadStart = function (pak, resp_func) {
  if (!this.chunked) {
    this.chunked = chunkedReceiverInit('client_receive', Infinity);
  }
  chunkedReceiverStart(this.chunked, pak, resp_func);
};

SubscriptionManager.prototype.handleUploadChunk = function (pak, resp_func) {
  chunkedReceiverOnChunk(this.chunked, pak, resp_func);
};

SubscriptionManager.prototype.handleUploadFinish = function (pak, resp_func) {
  chunkedReceiverFinish(this.chunked, pak, resp_func);
};

SubscriptionManager.prototype.uploadGetFile = function (file_id) {
  return chunkedReceiverGetFile(this.chunked, file_id);
};

SubscriptionManager.prototype.uploadFreeFile = function (file_data) {
  return chunkedReceiverFreeFile(file_data);
};


SubscriptionManager.prototype.subscribe = function (channel_id) {
  this.getChannel(channel_id, true);
};

SubscriptionManager.prototype.getChannel = function (channel_id, do_subscribe) {
  let channel = this.channels[channel_id];
  if (!channel) {
    let channel_type = channel_id.split('.')[0];
    let handlers = this.getBaseHandlers(channel_type);
    channel = this.channels[channel_id] = new ClientChannelWorker(this, channel_id, handlers);
  }
  if (do_subscribe) {
    channel.subscriptions++;
    if (!netDisconnected() && channel.subscriptions === 1) {
      channel.subscribe_failed = false;
      this.client.send('subscribe', channel_id, function (err) {
        if (err) {
          channel.subscribe_failed = true;
          console.error(`Error subscribing to ${channel_id}: ${err}`);
          channel.emit('subscribe_fail', err);
        }
      });
    }
  }
  return channel;
};

SubscriptionManager.prototype.getUserId = function () {
  return this.loggedIn();
};

SubscriptionManager.prototype.getMyUserChannel = function () {
  let user_id = this.loggedIn();
  if (!user_id) {
    return null;
  }
  let channel = this.getChannel(`user.${user_id}`);
  if (!this.logging_out) {
    channel.autosubscribed = true;
  }
  return channel;
};

SubscriptionManager.prototype.unsubscribe = function (channel_id) {
  let channel = this.channels[channel_id];
  assert(channel);
  assert(channel.subscriptions);
  channel.subscriptions--;
  if (!channel.subscriptions) {
    channel.got_subscribe = false;
  }
  if (!netDisconnected() && !channel.subscriptions && !channel.subscribe_failed) {
    this.client.send('unsubscribe', channel_id);
  }
};

// Immediate-mode channel subscription; will unsubscribe automatically on logout
//   or if not accessed for some time
SubscriptionManager.prototype.getChannelImmediate = function (channel_id, timeout) {
  timeout = timeout || 60000;
  let channel = this.getChannel(channel_id);
  if (!channel.immediate_subscribe) {
    this.subscribe(channel_id);
  }
  channel.immediate_subscribe = timeout;
  return channel;
};

SubscriptionManager.prototype.onLogin = function (cb) {
  this.on('login', cb);
  if (this.logged_in) {
    return void cb();
  }
};

SubscriptionManager.prototype.loggedIn = function () {
  return this.logging_out ? false : this.logged_in ? this.logged_in_username || 'missing_name' : false;
};

SubscriptionManager.prototype.userOnChannelData = function (expected_user_id, data, key, value) {
  if (expected_user_id !== this.getUserId()) {
    // must have logged out
    return;
  }
  if (key === 'public.display_name') {
    this.logged_in_display_name = value;
  }
};

SubscriptionManager.prototype.handleLoginResponse = function (resp_func, err, resp) {
  this.logging_in = false;
  if (!err) {
    this.logged_in_username = resp.user_id;
    this.logged_in_display_name = resp.display_name;
    this.logged_in = true;
    this.was_logged_in = true;
    let user_channel = this.getMyUserChannel(); // auto-subscribe to it
    user_channel.onceSubscribe(() => {
      if (!this.did_master_subscribe && user_channel.getChannelData('public.permissions.sysadmin')) {
        // For cmd_parse access
        this.did_master_subscribe = true;
        this.subscribe('master.master');
      }
    });

    if (!user_channel.subs_added_user_on_channel_data) {
      user_channel.on('channel_data', this.userOnChannelData.bind(this, this.logged_in_username));
      user_channel.subs_added_user_on_channel_data = true;
    }
    this.emit('login');
  } else {
    this.emit('login_fail', err);
  }
  resp_func(err);
};

SubscriptionManager.prototype.loginInternal = function (login_credentials, resp_func) {
  if (this.logging_in) {
    return void resp_func('Login already in progress');
  }
  this.logging_in = true;
  this.logged_in = false;

  if (login_credentials.fb) {
    fbGetLoginInfo((err, result) => {
      if (err) {
        return void this.handleLoginResponse(resp_func, err);
      }
      if (!this.client.connected) {
        return void this.handleLoginResponse(resp_func, 'ERR_DISCONNECTED');
      }
      this.client.send('login_facebook_instant', result, this.handleLoginResponse.bind(this, resp_func));
    });
  } else {
    this.client.send('login', {
      user_id: login_credentials.user_id,
      password: md5(this.client.secret + login_credentials.password),
    }, this.handleLoginResponse.bind(this, resp_func));
  }
};

SubscriptionManager.prototype.userCreateInternal = function (params, resp_func) {
  if (this.logging_in) {
    return resp_func('Login already in progress');
  }
  this.logging_in = true;
  this.logged_in = false;
  return this.client.send('user_create', params, this.handleLoginResponse.bind(this, resp_func));
};

function hashedPassword(user_id, password) {
  if (password.split('$$')[0] === 'prehashed') {
    password = password.split('$$')[1];
  } else {
    password = md5(md5(user_id.toLowerCase()) + password);
  }
  return password;
}


SubscriptionManager.prototype.login = function (username, password, resp_func) {
  username = (username || '').trim();
  if (!username) {
    return resp_func('Missing username');
  }
  password = (password || '').trim();
  if (!password) {
    return resp_func('Missing password');
  }
  let hashed_password = hashedPassword(username, password);
  if (hashed_password !== password) {
    local_storage.set('password', `prehashed$$${hashed_password}`);
  }
  this.login_credentials = { user_id: username, password: hashed_password };
  if (!this.auto_create_user) {
    // Just return result directly
    return this.loginInternal(this.login_credentials, resp_func);
  }
  return this.loginInternal(this.login_credentials, (err, data) => {
    if (!err || err !== 'ERR_USER_NOT_FOUND') {
      return void resp_func(err, data);
    }
    // user not found, auto-create
    this.userCreate({
      user_id: username,
      password,
      password_confirm: password,
      email: 'autocreate@glovjs.org',
    }, resp_func);
  });
};

SubscriptionManager.prototype.loginFacebook = function (resp_func) {
  this.login_credentials = { fb: true };
  return this.loginInternal(this.login_credentials, resp_func);
};

SubscriptionManager.prototype.userCreate = function (params, resp_func) {
  params.user_id = (params.user_id || '').trim();
  if (!params.user_id) {
    return resp_func('Missing username');
  }
  params.password = (params.password || '').trim();
  if (!params.password) {
    return resp_func('Missing password');
  }
  params.password_confirm = (params.password_confirm || '').trim();
  if (!this.auto_create_user && !params.password_confirm) {
    return resp_func('Missing password confirmation');
  }
  params.email = (params.email || '').trim();
  if (!this.auto_create_user && !params.email) {
    return resp_func('Missing email');
  }
  params.display_name = (params.display_name || '').trim();
  let hashed_password = hashedPassword(params.user_id, params.password);
  if (hashed_password !== params.password) {
    local_storage.set('password', `prehashed$$${hashed_password}`);
  }
  let hashed_password_confirm = hashedPassword(params.user_id, params.password_confirm);
  if (hashed_password !== hashed_password_confirm) {
    return resp_func('Passwords do not match');
  }
  this.login_credentials = { user_id: params.user_id, password: hashed_password };
  return this.userCreateInternal({
    display_name: params.display_name || params.user_id,
    user_id: params.user_id,
    email: params.email,
    password: hashed_password,
  }, resp_func);
};


SubscriptionManager.prototype.logout = function () {
  assert(this.logged_in);
  assert(!this.logging_in);
  assert(!this.logging_out);
  // Don't know how to gracefully handle logging out with app-level subscriptions
  //   currently, clean up those we can, assert we have no others
  if (this.did_master_subscribe) {
    this.did_master_subscribe = false;
    this.unsubscribe('master.master');
  }
  for (let channel_id in this.channels) {
    let channel = this.channels[channel_id];
    if (channel.immediate_subscribe) {
      channel.immediate_subscribe = 0;
      this.unsubscribe(channel_id);
    }
    assert(!channel.subscriptions, `Remaining active subscription for ${channel_id}`);
    if (channel.autosubscribed) {
      channel.autosubscribed = false;
    }
  }

  this.logging_out = true;
  this.client.send('logout', null, (err) => {
    this.logging_out = false;
    if (!err) {
      local_storage.set('password', undefined);
      this.logged_in = false;
      this.logged_in_username = null;
      this.was_logged_in = false;
      this.login_credentials = null;
      this.emit('logout');
    }
  });
};

SubscriptionManager.prototype.serverLog = function (type, data) {
  this.onceConnected(() => {
    this.client.send('log', { type, data });
  });
};

SubscriptionManager.prototype.sendCmdParse = function (command, resp_func) {
  this.onceConnected(() => {
    let pak = this.client.pak('cmd_parse_auto');
    pak.writeString(command);
    pak.send(resp_func);
  });
};

SubscriptionManager.prototype.handleCSRToClient = function (pak, resp_func) {
  let cmd = pak.readString();
  let access = pak.readJSON();
  this.cmd_parse.handle({ access }, cmd, (err, resp) => {
    if (err && this.cmd_parse.was_not_found) {
      // bounce back to server
      return resp_func(null, { found: 0, err });
    }
    return resp_func(err, { found: 1, resp });
  });
};

export function create(client, cmd_parse) {
  return new SubscriptionManager(client, cmd_parse);
}
