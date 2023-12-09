// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  MAX_CLIENT_UPLOAD_SIZE,
  chunkedReceiverCleanup,
  chunkedReceiverFinish,
  chunkedReceiverInit,
  chunkedReceiverOnChunk,
  chunkedReceiverStart,
} from 'glov/common/chunked_send';
import { ERR_NO_USER_ID, ERR_UNAUTHORIZED } from 'glov/common/external_users_common';
import { isPacket } from 'glov/common/packet';
import { perfCounterAdd, perfCounterAddValue } from 'glov/common/perfcounters';
import { unicode_replacement_chars } from 'glov/common/replacement_chars';
import { logdata, merge } from 'glov/common/util';
import {
  isProfane,
  profanityCommonStartup,
  profanitySetReplacementChars,
} from 'glov/common/words/profanity_common';
import { channelServerPak, channelServerSend, quietMessage } from './channel_server';
import * as client_worker from './client_worker';
import { regex_valid_username } from './default_workers';
import { externalUsersValidateLogin } from './external_users_validation';
import { logDumpJSON, logSubscribeClient, logUnsubscribeClient } from './log';
import { metricsStats } from './metrics';
import * as random_names from './random_names';

// Note: this object is both filtering wsclient -> wsserver messages and client->channel messages
let ALLOWED_DURING_RESTART = Object.create(null);
ALLOWED_DURING_RESTART.login = true; // filtered at lower level
ALLOWED_DURING_RESTART.logout = true; // always allow
ALLOWED_DURING_RESTART.channel_msg = true; // filtered at lower level
ALLOWED_DURING_RESTART.chat = true;

let channel_server;

function defaultUserIdMappingHandler(client_channel, valid_login_data, resp_func) {
  client_channel.sendChannelMessage(
    'idmapper.idmapper',
    'id_map_get_id',
    { provider: valid_login_data.provider, provider_id: valid_login_data.external_id },
    (err, result) => resp_func(err, result?.user_id));
}

let external_users_id_mapping_handlers = {};
export function setExternalUserIdMapper(provider_id, handler) {
  external_users_id_mapping_handlers[provider_id] = handler;
}
export function getExternalUserIdMapper(provider_id) {
  return external_users_id_mapping_handlers[provider_id] || defaultUserIdMappingHandler;
}


function restartFilter(client, msg, data) {
  if (client && client.client_channel && client.client_channel.ids && client.client_channel.ids.sysadmin) {
    return true;
  }
  if (ALLOWED_DURING_RESTART[msg]) {
    return true;
  }
  return false;
}

function onUnSubscribe(client, channel_id) {
  client.client_channel.unsubscribeOther(channel_id);
}

function uploadCleanup(client) {
  if (client.chunked) {
    chunkedReceiverCleanup(client.chunked);
    delete client.chunked;
  }
}

function onClientDisconnect(client) {
  let client_channel = client.client_channel;
  assert(client_channel);

  uploadCleanup(client);
  client_channel.unsubscribeAll();
  client_channel.shutdownImmediate();
}

function onSubscribe(client, channel_id, resp_func) {
  client.client_channel.logDest(channel_id, 'debug', 'subscribe');
  client.client_channel.subscribeOther(channel_id, ['*'], resp_func);
}

let set_channel_data_async_reply = false;
export function setChannelDataAsyncReply(do_async) {
  set_channel_data_async_reply = do_async;
}

function onSetChannelData(client, pak, resp_func) {
  assert(isPacket(pak));
  let channel_id = pak.readAnsiString();
  assert(channel_id);
  let q = pak.readBool();
  let key = pak.readAnsiString();
  let keyparts = key.split('.');
  if (keyparts[0] !== 'public' && keyparts[0] !== 'private') {
    client.client_channel.logCtx('error', ` - failed, invalid scope: ${keyparts[0]}`);
    resp_func('failed: invalid scope');
    pak.pool();
    return;
  }
  if (!keyparts[1]) {
    client.client_channel.logCtx('error', ' - failed, missing member name');
    resp_func('failed: missing member name');
    pak.pool();
    return;
  }

  // TODO: Disable autocreate for this call?
  // TODO: Error if channel does not exist, but do not require an ack? channelServerSend needs a simple "sent" ack?

  let client_channel = client.client_channel;

  if (!client_channel.isSubscribedTo(channel_id)) {
    pak.pool();
    if (client_channel.recentlyForceUnsubbed(channel_id)) {
      // Silently ignore, client will assert on this but we were forcibly kicked from
      //   this channel, so it's not a client bug.
      return void resp_func();
    }
    return void resp_func(`Client is not on channel ${channel_id}`);
  }

  client_channel.ids = client_channel.ids_direct;
  let outpak = channelServerPak(client_channel, channel_id, 'set_channel_data', pak, q);
  outpak.writeBool(q);
  outpak.writeAnsiString(key);
  outpak.appendRemaining(pak);
  client_channel.ids = client_channel.ids_base;
  if (set_channel_data_async_reply) {
    outpak.send(resp_func);
  } else {
    outpak.send();
    resp_func();
  }
}

function onChannelMsg(client, data, resp_func) {
  // Arbitrary messages
  let channel_id;
  let msg;
  let payload;
  let is_packet = isPacket(data);
  let log;
  if (is_packet) {
    let pak = data;
    assert.equal(pak.getRefCount(), 1);
    pak.ref(); // deal with auto-pool of an empty packet
    channel_id = pak.readAnsiString();
    msg = pak.readAnsiString();
    if (!pak.ended()) {
      pak.pool();
    }
    assert.equal(pak.getRefCount(), 1);
    // let flags = pak.readInt();
    payload = pak;
    log = '(pak)';
  } else {
    if (typeof data !== 'object') {
      return void resp_func('Invalid data type');
    }
    channel_id = data.channel_id;
    msg = data.msg;
    payload = data.data;
    log = logdata(payload);
  }
  if (channel_server.restarting) {
    if (!restartFilter(client, msg, data)) {
      return;
    }
  }
  if (quietMessage(msg, payload)) {
    if (!is_packet && typeof payload === 'object') {
      payload.q = 1; // do not print later, either
    }
  } else {
    client.client_channel.logDest(channel_id, 'debug', `channel_msg ${msg} ${log}`);
  }
  if (!channel_id) {
    if (is_packet) {
      payload.pool();
    }
    return void resp_func('Missing channel_id');
  }
  let client_channel = client.client_channel;

  let debug_name = `cm:${channel_id.split('.')[0]}.${typeof msg === 'number' ? 'ack' : msg}`;
  // re-attribute the packet size to the more detailed perf counter
  let { pkg_log_last_size } = channel_server.ws_server;
  assert(pkg_log_last_size);
  perfCounterAddValue('net.recv_bytes.channel_msg', -pkg_log_last_size);
  perfCounterAddValue(`net.recv_bytes.${debug_name}`, pkg_log_last_size);
  perfCounterAdd(debug_name);

  if (!client_channel.isSubscribedTo(channel_id)) {
    if (channel_server.clientCanSendDirectWithoutSubscribe(channel_id)) {
      // let it through
    } else {
      if (is_packet) {
        payload.pool();
      }
      if (!resp_func.expecting_response) {
        if (client_channel.recentlyForceUnsubbed(channel_id)) {
          // Silently ignore, client will assert on this but we were forcibly kicked from
          //   this channel, so it's not a client bug.
          return void resp_func();
        } else {
          client.logCtx('warn', 'Unhandled error "Client is not on channel' +
            ` ${channel_id}" sent to client in response to ${msg}`+
            ` ${is_packet ? '(pak)' : logdata(payload)}`);
        }
      }
      return void resp_func(`Client is not on channel ${channel_id}`);
    }
  }
  if (!resp_func.expecting_response) {
    resp_func = null;
  }
  let old_resp_func = resp_func;
  resp_func = function (err, resp_data) {
    if (old_resp_func) {
      if (err && err !== 'ERR_FAILALL_DISCONNECT') { // Was previously not logging on cmd_parse packets too
        client.log(`Error "${err}" sent from ${channel_id} to client in response to ${
          msg} ${is_packet ? '(pak)' : logdata(payload)}`);
      }
      old_resp_func(err, resp_data);
    } else if (err && err !== 'ERR_FAILALL_DISCONNECT') {
      // This will throw an exception on the client!
      client.logCtx('warn', `Unhandled error "${err}" sent from ${channel_id} to client in response to ${
        msg} ${is_packet ? '(pak)' : logdata(payload)}`);
      client.send('error', err);
    }
  };
  resp_func.expecting_response = Boolean(old_resp_func);
  client_channel.ids = client_channel.ids_direct;
  channelServerSend(client_channel, channel_id, msg, null, payload, resp_func, true); // quiet since we already logged
  client_channel.ids = client_channel.ids_base;
}

const invalid_names = {
  constructor: 1,
  hasownproperty: 1,
  isprototypeof: 1,
  propertyisenumerable: 1,
  tolocalestring: 1,
  tostring: 1,
  valueof: 1,
  admin: 1,
  sysadmin: 1,
  sysop: 1,
  gm: 1,
  mod: 1,
  moderator: 1,
  default: 1,
  all: 1,
  everyone: 1,
  anonymous: 1,
  public: 1,
  clear: 1,
  wipe: 1,
  reset: 1,
  password: 1,
  server: 1,
  system: 1,
  internal: 1,
  error: 1,
  info: 1,
  user: 1,
};
const regex_admin_username = /^(admin|mod_|gm_|moderator)/; // Might exist in the system, do not allow to be created
function validUsername(user_id, allow_admin) {
  if (!user_id) {
    return false;
  }
  if ({}[user_id]) {
    // hasOwnProperty, etc
    return false;
  }
  user_id = user_id.toLowerCase();
  if (invalid_names[user_id]) {
    // also catches anything on Object.prototype
    return false;
  }
  if (!allow_admin && user_id.match(regex_admin_username)) {
    return false;
  }
  if (!user_id.match(regex_valid_username)) {
    // has a "." or other invalid character
    return false;
  }
  if (isProfane(user_id)) {
    return false;
  }
  return true;
}

function handleLoginResponse(login_message, client, user_id, resp_func, err, resp_data) {
  let client_channel = client.client_channel;
  assert(client_channel);

  if (client_channel.ids.user_id) {
    // Logged in while processing the response?
    client_channel.logCtx('info', `${login_message} failed: Already logged in`);
    return resp_func('Already logged in');
  }

  let first_session;
  let email;
  if (err) {
    client_channel.logCtx('info', `${login_message} failed: ${err}`);
  } else {
    client_channel.onLoginInternal(user_id, resp_data);
    client_channel.logCtx('info', `${login_message} success: logged in as ${user_id}`, { ip: client.addr });
    client_channel.onLogin(resp_data);

    // Tell channels we have a new user id/display name
    for (let channel_id in client_channel.subscribe_counts) {
      channelServerSend(client_channel, channel_id, 'client_changed');
    }

    // Always subscribe client to own user
    onSubscribe(client, `user.${user_id}`);

    first_session = resp_data.first_session;
    email = resp_data.email;
  }

  return resp_func(err, {
    first_session,
    email,
    user_id: client_channel.ids.user_id,
    display_name: client_channel.ids.display_name,
  });
}

function channelServerExternalLoginSend(client, provider, provider_ids, user_id, display_name, resp_func) {
  assert(provider_ids);

  let login_message = `login_${provider}`;
  let client_channel = client.client_channel;
  assert(client_channel);

  client_channel.logCtx('info', `${login_message} ${user_id} success`);
  return client_channel.sendChannelMessage(`user.${user_id}`, 'login_external', {
    provider,
    provider_ids,
    display_name,
    ip: client.addr,
    ua: client.user_agent,
  }, handleLoginResponse.bind(null, login_message, client, user_id, resp_func));
}

function onLogin(client, data, resp_func) {
  let client_channel = client.client_channel;
  assert(client_channel);

  client_channel.logCtx('info', `login ${logdata(data)}`, { ip: client.addr });
  let user_id = data.user_id;
  if (!validUsername(user_id, true)) {
    client_channel.logCtx('info', 'login failed: Invalid username');
    return resp_func('Invalid username');
  }
  user_id = user_id.toLowerCase();

  return client_channel.sendChannelMessage(`user.${user_id}`, 'login', {
    display_name: data.display_name || data.user_id, // original-case'd name
    password: data.password,
    salt: client.secret,
    ip: client.addr,
    ua: client.user_agent,
  }, handleLoginResponse.bind(null, 'login', client, user_id, resp_func));
}

function onLoginExternal(client, data, cb) {
  let client_channel = client.client_channel;
  assert(client_channel);

  let { provider, validation_data, display_name } = data;
  if (!(
    provider && typeof provider === 'string' &&
    validation_data && typeof validation_data === 'string'
  )) {
    client_channel.logCtx('error', `login_external invalid data ${logdata(data)}`);
    return void cb('ERR_INVALID_DATA');
  }

  client_channel.logCtx('info', `login_external ${provider} ${JSON.stringify(data)}`);

  display_name = display_name ? String(display_name) : undefined;

  externalUsersValidateLogin(provider, validation_data, (err, valid_login_data) => {
    if (!client.connected) {
      return void cb('ERR_DISCONNECTED');
    } else if (err) {
      client_channel.logCtx('error', `login_external ${provider} validation error: ${err}`);
      return void cb(ERR_UNAUTHORIZED);
    }
    assert(valid_login_data);
    let external_user_id = valid_login_data.external_id;
    assert(external_user_id);

    let userIdMappingHandler = getExternalUserIdMapper(provider);
    userIdMappingHandler(client_channel, valid_login_data, (err, user_id, providers_ids) => {
      if (!client.connected) {
        return void cb('ERR_DISCONNECTED');
      }
      if (err) {
        return void cb(err);
      }
      if (!user_id) {
        return void cb(ERR_NO_USER_ID);
      }

      // Handle the case where this function is not called with extra providers' ids
      if (!providers_ids) {
        providers_ids = {};
      }
      assert(!providers_ids[provider] || providers_ids[provider] === external_user_id);
      providers_ids[provider] = external_user_id;

      channelServerExternalLoginSend(client, provider, providers_ids, user_id, display_name, cb);
    });
  });
}

function onUserCreate(client, data, resp_func) {
  let client_channel = client.client_channel;
  assert(client_channel);

  client_channel.logCtx('info', `user_create ${logdata(data)}`);
  let user_id = data.user_id;
  if (!validUsername(user_id)) {
    client_channel.logCtx('info', 'user_create failed: Invalid username');
    return resp_func('Invalid username');
  }
  user_id = user_id.toLowerCase();

  if (client_channel.ids.user_id) {
    client_channel.logCtx('info', 'user_create failed: Already logged in');
    return resp_func('Already logged in');
  }

  return client_channel.sendChannelMessage(`user.${user_id}`, 'create', {
    display_name: data.display_name || data.user_id, // original-case'd name
    password: data.password,
    email: data.email,
    ip: client.addr,
    ua: client.user_agent,
  }, handleLoginResponse.bind(null, 'user_create', client, user_id, resp_func));
}

function onLogOut(client, data, resp_func) {
  let client_channel = client.client_channel;
  assert(client_channel);

  let { user_id } = client_channel.ids;
  client_channel.logCtx('info', `logout ${user_id}`);
  if (!user_id) {
    return resp_func('ERR_NOT_LOGGED_IN');
  }

  onUnSubscribe(client, `user.${user_id}`);
  client_channel.onLogoutInternal();

  // Tell channels we have a new user id/display name
  for (let channel_id in client_channel.subscribe_counts) {
    channelServerSend(client_channel, channel_id, 'client_changed');
  }

  return resp_func();
}

function onRandomName(client, data, resp_func) {
  return resp_func(null, random_names.get());
}

function onLog(client, data, resp_func) {
  let client_channel = client.client_channel;
  merge(data, client_channel.ids);
  merge(data, client.crash_data);
  client.client_channel.logCtx('info', 'server_log', data);
  resp_func();
}

function onLogSubscribe(client, data, resp_func) {
  if (!client.glov_is_dev) {
    return void resp_func('ERR_ACCESS_DENIED');
  }
  logSubscribeClient(client);
  resp_func();
}
function onLogUnsubscribe(client, data, resp_func) {
  if (!client.glov_is_dev) {
    return void resp_func('ERR_ACCESS_DENIED');
  }
  logUnsubscribeClient(client);
  resp_func();
}

function uploadOnStart(client, pak, resp_func) {
  if (!client.chunked) {
    client.chunked = chunkedReceiverInit(`client_id:${client.id}`, MAX_CLIENT_UPLOAD_SIZE);
  }
  chunkedReceiverStart(client.chunked, pak, resp_func);
}

function uploadOnChunk(client, pak, resp_func) {
  chunkedReceiverOnChunk(client.chunked, pak, resp_func);
}

function uploadOnFinish(client, pak, resp_func) {
  chunkedReceiverFinish(client.chunked, pak, resp_func);
}

function onGetStats(client, data, resp_func) {
  resp_func(null, { ccu: channel_server.master_stats.num_channels.client || 1 });
}

function onPerfFetch(client, data, resp_func) {
  let { client_channel } = client;
  if (!(client_channel.ids && client_channel.ids.sysadmin)) {
    return void resp_func('ERR_ACCESS_DENIED');
  }
  let { channel_id, fields } = data;
  client_channel.sendChannelMessage(channel_id, 'perf_fetch', { fields }, resp_func);
}

function onProfile(client, data, resp_func) {
  let client_channel = client.client_channel;
  if (typeof data !== 'string') {
    return void resp_func('ERR_INVALID_DATA');
  }
  try {
    data = JSON.parse(data);
  } catch (e) {
    return void resp_func('ERR_INVALID_DATA');
  }
  // Generate a (likely unique) random ID to reference this profile by
  crypto.randomFill(Buffer.alloc(9), (err, buf) => {
    if (err) {
      throw err;
    }
    let uid = buf.toString('base64').replace(/[+/]/g, 'A');
    let log_data = {
      ...data,
      ...client_channel.ids,
      ...client.crash_data,
      uid,
    };
    let file = logDumpJSON('profile', log_data, 'json');
    client_channel.logCtx('info', 'Profile saved', { uid, file });
    resp_func(null, { id: uid });
  });
}

const LOAD_TIME_METRICS = [
  'time_js_load',
  'time_js_init',
  'time_resource_load',
  'time_total',
];
function onLoadMetrics(client, data, resp_func) {
  if (!data) {
    return void resp_func();
  }
  for (let ii = 0; ii < LOAD_TIME_METRICS.length; ++ii) {
    let field = LOAD_TIME_METRICS[ii];
    if (typeof data[field] === 'number') {
      metricsStats(`clientload_${field}`, data[field]);
    }
  }
  resp_func();
}

function onCmdParseAuto(client, pak, resp_func) {
  let cmd = pak.readString();
  let { client_channel } = client;
  client_channel.cmdParseAuto({ cmd }, (err, resp) => {
    resp_func(err, resp ? resp.resp : null);
  });
}

function onCmdParseListClient(client, data, resp_func) {
  let { client_channel } = client;
  client_channel.cmd_parse_source = client_channel.ids;
  client_channel.access = client_channel.ids;
  client_channel.cmd_parse.handle(client_channel, 'cmd_list', resp_func);
}

export function init(channel_server_in) {
  profanityCommonStartup(fs.readFileSync(`${__dirname}/../common/words/filter.gkg`, 'utf8'),
    fs.readFileSync(`${__dirname}/../common/words/exceptions.txt`, 'utf8'));
  profanitySetReplacementChars(unicode_replacement_chars);

  channel_server = channel_server_in;
  let ws_server = channel_server.ws_server;
  ws_server.on('client', (client) => {
    let client_id = channel_server.clientIdFromWSClient(client);
    client.client_id = client_id;
    client.client_channel = channel_server.createChannelLocal(`client.${client_id}`);
    client.client_channel.client = client;
    client.crash_data = {
      addr: client.addr,
      user_agent: client.user_agent,
      plat: client.client_plat,
      ver: client.client_ver,
      build: client.client_build,
      ua: client.user_agent,
    };
  });
  ws_server.on('cack_data', (cack_data) => {
    cack_data.time = Date.now();
  });
  ws_server.on('disconnect', onClientDisconnect);
  ws_server.onMsg('subscribe', onSubscribe);
  ws_server.onMsg('unsubscribe', onUnSubscribe);
  ws_server.onMsg('set_channel_data', onSetChannelData);
  ws_server.onMsg('channel_msg', onChannelMsg);
  ws_server.onMsg('login', onLogin);
  ws_server.onMsg('login_external', onLoginExternal);
  ws_server.onMsg('user_create', onUserCreate);
  ws_server.onMsg('logout', onLogOut);
  ws_server.onMsg('random_name', onRandomName);
  ws_server.onMsg('log', onLog);
  ws_server.onMsg('log_subscribe', onLogSubscribe);
  ws_server.onMsg('log_unsubscribe', onLogUnsubscribe);
  ws_server.onMsg('get_stats', onGetStats);
  ws_server.onMsg('cmd_parse_auto', onCmdParseAuto);
  ws_server.onMsg('cmd_parse_list_client', onCmdParseListClient);
  ws_server.onMsg('perf_fetch', onPerfFetch);
  ws_server.onMsg('profile', onProfile);
  ws_server.onMsg('load_metrics', onLoadMetrics);

  ws_server.onMsg('upload_start', uploadOnStart);
  ws_server.onMsg('upload_chunk', uploadOnChunk);
  ws_server.onMsg('upload_finish', uploadOnFinish);

  ws_server.setRestartFilter(restartFilter);

  client_worker.init(channel_server);
}
