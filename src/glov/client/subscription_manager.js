// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import {
  externalUsersAutoLoginFallbackProvider,
  externalUsersAutoLoginProvider,
  externalUsersCurrentUser,
  externalUsersEmailPassLoginProvider,
  externalUsersEnabled,
  externalUsersLogIn,
  externalUsersLogOut,
  externalUsersSendEmailConfirmation,
} from 'glov/client/external_users_client';
import {
  chunkedReceiverFinish,
  chunkedReceiverFreeFile,
  chunkedReceiverGetFile,
  chunkedReceiverInit,
  chunkedReceiverOnChunk,
  chunkedReceiverStart,
} from 'glov/common/chunked_send';
import * as dot_prop from 'glov/common/dot-prop';
import { ERR_NO_USER_ID } from 'glov/common/external_users_common';
import * as md5 from 'glov/common/md5';
import { isPacket } from 'glov/common/packet';
import { perfCounterAdd } from 'glov/common/perfcounters';
import * as EventEmitter from 'glov/common/tiny-events';
import * as util from 'glov/common/util';
import { cloneShallow } from 'glov/common/util';
import * as local_storage from './local_storage';
import { netDisconnected, netDisconnectedRaw } from './net';
import * as walltime from './walltime';

// relevant events:
//   .on('channel_data', cb(data [, mod_key, mod_value]));

function ClientChannelWorker(subs, channel_id, base_handlers, base_event_listeners) {
  EventEmitter.call(this);
  this.subs = subs;
  this.channel_id = channel_id;
  let m = channel_id.match(/^([^.]*)\.(.*)$/);
  assert(m);
  this.channel_type = m[1];
  this.channel_subid = m[2];
  this.subscriptions = 0;
  this.subscribe_failed = false;
  this.got_subscribe = false;
  this.immediate_subscribe = 0;
  this.channel_data_ver = 0; // for polling for changes
  this.handlers = Object.create(base_handlers);
  this.base_event_listeners = base_event_listeners;
  this.data = {};
}
util.inherits(ClientChannelWorker, EventEmitter);

ClientChannelWorker.prototype.getChannelID = function () {
  return this.channel_id;
};

ClientChannelWorker.prototype.emit = function (event) {
  // Using `arguments` instead of rest params because Babel is generating pretty
  //   bloated code and this is a hot path.
  // eslint-disable-next-line prefer-rest-params
  let args = arguments;
  EventEmitter.prototype.emit.apply(this, args);
  if (this.base_event_listeners) {
    let listeners = this.base_event_listeners[event];
    if (listeners) {
      for (let ii = 0; ii < listeners.length; ++ii) {
        listeners[ii].apply(this, Array.prototype.slice.call(args, 1));
      }
    }
  }
};

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

ClientChannelWorker.prototype.numSubscriptions = function () {
  return this.subscriptions;
};

ClientChannelWorker.prototype.isFullySubscribed = function () {
  return this.got_subscribe;
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
  let pak = this.subs.client.pak('set_channel_data', `${this.channel_type}.set_channel_data`);
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
  let pak = this.subs.client.pak('channel_msg', `cm:${this.channel_type}.${msg}`);
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
  }, `cm:${this.channel_type}.${msg}`, resp_func);
};

ClientChannelWorker.prototype.cmdParse = function (cmd, resp_func) {
  this.send('cmdparse', cmd, resp_func);
};

ClientChannelWorker.prototype.unsubscribe = function () {
  this.subs.unsubscribe(this.channel_id);
};

function SubscriptionManager(client, cmd_parse) {
  EventEmitter.call(this);
  this.client = client;
  this.channels = {};
  this.logged_in = false;
  this.first_session = false;
  this.login_credentials = null;
  this.logged_in_email = null;
  this.logged_in_username = null;
  this.logged_in_display_name = null;
  this.was_logged_in = false;
  this.logging_in = false;
  this.logging_out = false;
  this.auto_create_user = false;
  this.allow_anon = false;
  this.no_auto_login = false;
  this.auto_login_error = undefined;
  this.cmd_parse = cmd_parse;
  if (cmd_parse) {
    this.cmds_fetched_by_type = {};
  }
  this.base_handlers = {};
  this.channel_handlers = {}; // channel type -> msg -> handler
  this.channel_event_listeners = {}; // channel type -> event -> array of listeners

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

SubscriptionManager.prototype.onChannelEvent = function (channel_type, event, cb) {
  let listeners = this.channel_event_listeners[channel_type];
  if (!listeners) {
    listeners = this.channel_event_listeners[channel_type] = {};
  }
  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event].push(cb);
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

SubscriptionManager.prototype.sendResubscribe = function () {
  assert(!this.logging_in);
  assert(this.need_resub);
  if (netDisconnectedRaw()) {
    // Will re-send upon reconnect
    return;
  }
  // (re-)subscribe to all channels
  for (let channel_id in this.channels) {
    let channel = this.channels[channel_id];
    if (channel.subscriptions) {
      this.client.send('subscribe', channel_id, null, function (err) {
        if (err) {
          channel.subscribe_failed = true;
          console.error(`Error subscribing to ${channel_id}: ${err}`);
          channel.emit('subscribe_fail', err);
        }
      });
    }
  }
  this.emit('connect', this.need_resub.reconnect);
  this.need_resub = null;
};

SubscriptionManager.prototype.handleConnect = function (data) {
  let reconnect = false;
  if (this.first_connect) {
    this.first_connect = false;
  } else {
    reconnect = true;
  }
  this.need_resub = { reconnect };
  this.restarting = Boolean(data.restarting);
  this.cack_data = data;
  walltime.sync(data.time);

  if (netDisconnectedRaw()) {
    // we got disconnected while trying to log in, we'll retry after reconnecting
    return;
  }

  if (this.logging_in) {
    // already have a login in-flight, it should error before we try again
  } else if (this.was_logged_in) {
    // Try to re-connect to existing login
    this.loginRetry((err) => {
      if (err && err === 'ERR_FAILALL_DISCONNECT') {
        // we got disconnected while trying to log in, we'll retry after reconnecting
      } else if (err) {
        this.auto_login_error = err;
      }
    });
  } else if (!this.no_auto_login) {
    let auto_login_provider = externalUsersAutoLoginProvider(); // something like FBInstant - always auto logged in
    let saved_provider;
    if (auto_login_provider && externalUsersEnabled(auto_login_provider)) {
      // Try auto-login but ignore any error
      this.loginExternal({ provider: auto_login_provider }, (err) => {
        if (err === ERR_NO_USER_ID && externalUsersAutoLoginFallbackProvider()) {
          // Login was validated, but no user id exists, and was not auto-created,
          //   send the credentials to the fallback provider to auto-create a user.
          this.loginExternal({
            provider: externalUsersAutoLoginFallbackProvider(),
            external_login_data: cloneShallow(this.login_credentials.external_login_data),
          }, (err) => {
            this.auto_login_error = err;
          });
          return;
        }
        this.auto_login_error = err;
      });
    } else if (local_storage.get('name') && local_storage.get('password')) {
      this.login(local_storage.get('name'), local_storage.get('password'), (err) => {
        this.auto_login_error = err;
      });
    } else if ((saved_provider = local_storage.get('login_external'))) {
      let credentials = { provider: saved_provider };
      this.loginInternal(credentials, (err) => {
        if (err) {
          this.auto_login_error = err;
          // if the server returns an error log out
          externalUsersLogOut(saved_provider);
        }
      });
    }
  }

  // If logging in, will happen later; if disconnected, maybe have already triggered as an error
  if (!this.logging_in && this.need_resub) {
    this.sendResubscribe();
  }

  this.fetchCmds();
};

SubscriptionManager.prototype.fetchCmds = function () {
  let channel_type = 'client';
  let cmd_list = this.cmds_fetched_by_type;
  if (cmd_list && !cmd_list[channel_type]) {
    cmd_list[channel_type] = true;
    this.client.send('cmd_parse_list_client', null, null, (err, resp) => {
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
  let msg_name = `${channel_id.split('.')[0]}.${msg}`;
  perfCounterAdd(`cm.${msg_name}`);
  profilerStart(msg_name);
  handler.call(channel, data, resp_func);
  profilerStop(msg_name);
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
  if (!netDisconnected()) {
    // do not tick immediate subscriptions while disconnected *or* while logging in
    //   as they will not be re-established (upon a disconnection) until *after*
    //   login has finished.
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
    let event_listeners = this.channel_event_listeners[channel_type];
    channel = this.channels[channel_id] = new ClientChannelWorker(this, channel_id, handlers, event_listeners);
  }
  if (do_subscribe) {
    channel.subscriptions++;
    if (!netDisconnectedRaw() && channel.subscriptions === 1) {
      channel.subscribe_failed = false;
      this.client.send('subscribe', channel_id, null, function (err) {
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

SubscriptionManager.prototype.getDisplayName = function () {
  return this.logged_in_display_name;
};

SubscriptionManager.prototype.getLoginProvider = function () {
  return this.login_provider;
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
  if (!netDisconnectedRaw() && !channel.subscriptions && !channel.subscribe_failed) {
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
  let evt = 'login_fail';
  if (!err) {
    evt = 'login';
    this.first_session = Boolean(resp.first_session);
    this.logged_in_email = resp.email;
    this.logged_in_username = resp.user_id;
    this.logged_in_display_name = resp.display_name;
    this.logged_in = true;
    this.was_logged_in = true;
    let user_channel = this.getMyUserChannel(); // auto-subscribe to it
    user_channel.onceSubscribe(() => {
      if (!this.did_master_subscribe) {
        // For cmd_parse access
        let perms = user_channel.getChannelData('public.permissions', {});
        if (perms.sysadmin) {
          this.subscribe('master.master');
        }
        if (perms.sysadmin || perms.csr) {
          this.did_master_subscribe = true;
          this.subscribe('global.global');
        }
      }
    });

    if (!user_channel.subs_added_user_on_channel_data) {
      user_channel.on('channel_data', this.userOnChannelData.bind(this, this.logged_in_username));
      user_channel.subs_added_user_on_channel_data = true;
    }
    if (this.need_resub) {
      this.sendResubscribe();
    }
  }
  if (this.need_resub) {
    this.sendResubscribe();
  }
  this.emit(evt, err);
  resp_func(err);
};

SubscriptionManager.prototype.loginRetry = function (resp_func) {
  this.loginInternal(this.login_credentials, resp_func);
};

SubscriptionManager.prototype.loginInternalExternalUsers = function (provider, login_credentials, resp_func) {
  const {
    email, password, creation_display_name, external_login_data
  } = login_credentials;
  const login_options = {
    user_initiated: true,
    creation_display_name,
    email,
    password,
    external_login_data
  };
  return void externalUsersLogIn(provider, login_options, (err, login_data) => {
    this.login_credentials.external_login_data = login_data;

    if (err) {
      local_storage.set('login_external', this.login_provider = undefined);
      this.serverLog(`authentication_failed_${provider}`, {
        creation_mode: typeof creation_display_name === 'string',
        email,
        passlen: password && password.length,
        external_data: Boolean(external_login_data),
        err,
      });
      return void this.handleLoginResponse(resp_func, err);
    }

    local_storage.set('login_external', this.login_provider = provider);
    local_storage.set('password', undefined);

    externalUsersCurrentUser(provider, (err, user_info) => {
      if (err) {
        // Ignore the error, display_name is optional
      }
      if (netDisconnectedRaw()) {
        return void this.handleLoginResponse(resp_func, 'ERR_DISCONNECTED');
      }
      let request_data = {
        provider,
        validation_data: login_data.validation_data,
        display_name: user_info?.name || '',
      };
      this.client.send('login_external', request_data, null, this.handleLoginResponse.bind(this, resp_func));
    });
  });
};

SubscriptionManager.prototype.sessionHashedPassword = function () {
  assert(this.login_credentials.password);
  return md5(this.client.secret + this.login_credentials.password);
};

SubscriptionManager.prototype.loginInternal = function (login_credentials, resp_func) {
  if (this.logging_in) {
    return void resp_func('Login already in progress');
  }
  this.logging_in = true;
  this.logged_in = false;
  this.login_credentials = login_credentials;
  if (login_credentials.creation_display_name !== undefined) {
    // Only used once, never use upon reconnect, auto-login, etc
    this.login_credentials = cloneShallow(login_credentials);
    delete this.login_credentials.creation_display_name;
  }

  const { provider } = login_credentials;
  if (provider) {
    this.loginInternalExternalUsers(provider, login_credentials, resp_func);
  } else {
    const {
      user_id,
    } = login_credentials;
    this.client.send('login', {
      user_id,
      password: this.sessionHashedPassword(),
    }, null, this.handleLoginResponse.bind(this, resp_func));
  }
};

SubscriptionManager.prototype.userCreateInternal = function (params, resp_func) {
  if (this.logging_in) {
    return resp_func('Login already in progress');
  }
  this.logging_in = true;
  this.logged_in = false;
  return this.client.send('user_create', params, null, this.handleLoginResponse.bind(this, resp_func));
};

function hashedPassword(user_id, password) {
  let split = password.split('$$');
  if (split.length === 2 && split[0] === 'prehashed' && split[1].length === 32) {
    password = split[1];
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
  let credentials = { user_id: username, password: hashed_password };
  if (!this.auto_create_user) {
    // Just return result directly
    return this.loginInternal(credentials, resp_func);
  }
  return this.loginInternal(credentials, (err, data) => {
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

SubscriptionManager.prototype.loginEmailPass = function (credentials, resp_func) {
  credentials = {
    email: credentials.email,
    password: credentials.password,
    provider: externalUsersEmailPassLoginProvider(),
    creation_display_name: credentials.creation_display_name,
  };
  return this.loginInternal(credentials, resp_func);
};

SubscriptionManager.prototype.loginExternal = function (credentials, resp_func) {
  return this.loginInternal(cloneShallow(credentials), resp_func);
};

SubscriptionManager.prototype.sendActivationEmail = function (email, resp_func) {
  return externalUsersSendEmailConfirmation(email, resp_func);
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
    let user_channel = this.getMyUserChannel(); // auto-subscribe to it
    let perms = user_channel && user_channel.getChannelData('public.permissions', {});
    if (perms && perms.sysadmin) {
      this.unsubscribe('master.master');
    }
    this.unsubscribe('global.global');
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
  this.client.send('logout', null, null, (err) => {
    this.logging_out = false;
    if (!err) {
      local_storage.set('password', undefined);
      local_storage.set('login_external', this.login_provider = undefined);
      this.first_session = false;
      this.logged_in = false;
      this.logged_in_username = null;
      this.logged_in_display_name = null;
      this.was_logged_in = false;
      this.login_credentials = null;
      this.emit('logout');
    }
  });
};

SubscriptionManager.prototype.isFirstSession = function () {
  return this.first_session;
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
