// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const assert = require('assert');
const {
  chunkedReceiverCleanup,
  chunkedReceiverFinish,
  chunkedReceiverInit,
  chunkedReceiverOnChunk,
  chunkedReceiverStart,
  MAX_CLIENT_UPLOAD_SIZE,
} = require('glov/common/chunked_send.js');
const client_worker = require('./client_worker.js');
const { channelServerPak, channelServerSend, quietMessage } = require('./channel_server.js');
const crypto = require('crypto');
const { regex_valid_username } = require('./default_workers.js');
const { logDumpJSON, logSubscribeClient, logUnsubscribeClient } = require('./log.js');
const fs = require('fs');
const { isPacket } = require('glov/common/packet.js');
const { logdata, merge } = require('glov/common/util.js');
const { isProfane, profanityCommonStartup } = require('glov/common/words/profanity_common.js');
const metrics = require('./metrics.js');
const { perfCounterAdd } = require('glov/common/perfcounters.js');
const random_names = require('./random_names.js');
// const {
//   appleSignInInit,
//   appleSignInValidateToken,
// } = require('./signin_with_apple_validator.js');
const {
  facebookGetASIDFromLoginDataAsync,
  facebookGetPayloadFromSignedData,
  facebookGetPlayerIdFromASIDAsync,
  facebookGetUserFieldsFromASIDAsync,
  facebookUtilsInit,
} = require('./facebook_utils.js');
const {
  // ID_PROVIDER_APPLE,
  ID_PROVIDER_FB_GAMING,
  ID_PROVIDER_FB_INSTANT,
} = require('glov/common/enums.js');


// Note: this object is both filtering wsclient -> wsserver messages and client->channel messages
let ALLOWED_DURING_RESTART = Object.create(null);
ALLOWED_DURING_RESTART.login = true; // filtered at lower level
ALLOWED_DURING_RESTART.logout = true; // always allow
ALLOWED_DURING_RESTART.channel_msg = true; // filtered at lower level
ALLOWED_DURING_RESTART.chat = true;

let channel_server;


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
  perfCounterAdd(`cm.${channel_id.split('.')[0]}.${typeof msg === 'number' ? 'ack' : msg}`);
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

function userIdExists(client_channel, user_id, resp_func) {
  /*
  // Needs: const dot_prop = require('glov/common/dot-prop.js');
  const store_path = `user/user.${user_id}`;
  client_channel.channel_server.ds_store_meta.getAsync(store_path, {}, function (err, response) {
    if (err) {
      resp_func(false);
    } else {
      let hasPass = dot_prop.get(response, 'private.password', false);
      let isExternal = dot_prop.get(response, 'private.external', false);
      resp_func(hasPass || isExternal);
    }
  });
  */
  client_channel.sendChannelMessage(`user.${user_id}`, 'user_ping', null, (err) => {
    if (err) {
      client_channel.logCtx('info', 'Unable to send user_ping - the user does not exist');
      resp_func(false);
    } else {
      resp_func(true);
    }
  });
}

function getMappedUserIdFromProviderId(client_channel, provider, provider_id, resp_func) {
  client_channel.sendChannelMessage('idmapper.idmapper', 'id_map_get_id',
    { provider, provider_id }, (err, result) => resp_func(err, result?.user_id));
}

function getOrCreateMappedUserIdFromProviderId(client_channel, provider, provider_id, resp_func) {
  client_channel.sendChannelMessage('idmapper.idmapper', 'id_map_get_create_id',
    { provider, provider_id }, (err, result) => resp_func(err, result?.user_id));
}

function associateProviderIdToMappedUserId(client_channel, provider, provider_id, user_id, resp_func) {
  client_channel.sendChannelMessage('idmapper.idmapper', 'id_map_associate_ids',
    { provider, provider_id, user_id }, resp_func);
}

function handleLoginResponse(login_message, client, user_id, resp_func, err, resp_data) {
  let client_channel = client.client_channel;
  assert(client_channel);

  if (client_channel.ids.user_id) {
    // Logged in while processing the response?
    client_channel.logCtx('info', `${login_message} failed: Already logged in`);
    return resp_func('Already logged in');
  }

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
  }
  return resp_func(err, client_channel.ids); // user_id and display_name
}

function channelServerExternalLoginSend(client, provider, provider_id, user_id, display_name, resp_func) {
  let login_message = `login_${provider}`;
  let client_channel = client.client_channel;
  assert(client_channel);

  client_channel.logCtx('info', `${login_message} ${user_id} success`);
  return client_channel.sendChannelMessage(`user.${user_id}`, 'login_external', {
    provider,
    provider_id,
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

function mapValidFacebookIds(client, login_provider, login_id, asid, player_id, display_name, resp_func) {
  let client_channel = client.client_channel;
  assert(player_id);

  // Check if the user is already created with a prefixed id (used before the mapped ids were introduced)
  let legacy_instant_user_id = `fb$${player_id}`;
  userIdExists(client_channel, legacy_instant_user_id, (legacy_instant_user_id_exists) => {
    function handleIdAssociation(provider, provider_id, user_id) {
      assert(!legacy_instant_user_id_exists || user_id === legacy_instant_user_id);

      associateProviderIdToMappedUserId(client_channel, provider, provider_id, user_id, (err, success) => {
        if (err || !success) {
          err = err || 'Unknown error occurred when trying to associate a provider id to a user id';
          return void resp_func(err);
        } else if (!client.connected) {
          return void resp_func('ERR_DISCONNECTED');
        }
        channelServerExternalLoginSend(client, login_provider, login_id, user_id, display_name, resp_func);
      });
    }
    function handleBothIdAssociations(user_id) {
      assert(!legacy_instant_user_id_exists || user_id === legacy_instant_user_id);

      associateProviderIdToMappedUserId(client_channel, ID_PROVIDER_FB_GAMING, asid, user_id, (err, success) => {
        if (err || !success) {
          err = err || 'Unknown error occurred when trying to associate a provider id to a user id';
          return void resp_func(err);
        }
        handleIdAssociation(ID_PROVIDER_FB_INSTANT, player_id, user_id);
      });
    }

    if (!client.connected) {
      return void resp_func('ERR_DISCONNECTED');
    }

    // If no app-scoped user id exists, then there is no Facebook Gaming user registered yet,
    // so we need to associate the legacy user id if it exists, or get-or-create a new user
    // having only the Facebook Instant mapping
    if (!asid) {
      const provider = ID_PROVIDER_FB_INSTANT;
      if (legacy_instant_user_id_exists) {
        handleIdAssociation(provider, player_id, legacy_instant_user_id);
      } else {
        getOrCreateMappedUserIdFromProviderId(client_channel, provider, player_id, (err, user_id) => {
          if (err) {
            return void resp_func(err);
          } else if (!client.connected) {
            return void resp_func('ERR_DISCONNECTED');
          }
          assert(user_id);
          channelServerExternalLoginSend(client, login_provider, login_id, user_id, display_name, resp_func);
        });
      }
      return;
    }

    // Note: An extra (redundant) request is made to the database that would not be necessary, but this only
    // happens on new user id creation, and this way the flow for both FB gaming and FB instant can be cleaner
    getMappedUserIdFromProviderId(client_channel, ID_PROVIDER_FB_GAMING, asid, (err, user_id_gaming) => {
      if (err) {
        return void resp_func(err);
      } else if (!client.connected) {
        return void resp_func('ERR_DISCONNECTED');
      }
      getMappedUserIdFromProviderId(client_channel, ID_PROVIDER_FB_INSTANT, player_id, (err, user_id_instant) => {
        if (err) {
          return void resp_func(err);
        } else if (!client.connected) {
          return void resp_func('ERR_DISCONNECTED');
        }

        if (user_id_gaming && user_id_instant) {
          client_channel.logCtx('error', 'Found both user_id_gaming and user_id_instant',
            { login_provider, login_id, asid, player_id, legacy_instant_user_id_exists });
          assert(false);
        }

        // If a user already exists for one of the logins, then the other login mapping is missing,
        // so it needs to be associated with the same user id
        if (user_id_gaming || user_id_instant) {
          let user_id = user_id_gaming || user_id_instant;
          let missing_provider = user_id_gaming ? ID_PROVIDER_FB_INSTANT : ID_PROVIDER_FB_GAMING;
          let missing_provider_id = user_id_gaming ? player_id : asid;
          handleIdAssociation(missing_provider, missing_provider_id, user_id);
          return;
        }

        if (legacy_instant_user_id_exists) {
          handleBothIdAssociations(legacy_instant_user_id);
        } else {
          getOrCreateMappedUserIdFromProviderId(client_channel, ID_PROVIDER_FB_GAMING, asid, (err, user_id) => {
            if (err) {
              return void resp_func(err);
            }
            assert(user_id);
            handleIdAssociation(ID_PROVIDER_FB_INSTANT, player_id, user_id);
          });
        }
      });
    });
  });
}

function onLoginFacebookInstant(client, data, resp_func) {
  const provider = ID_PROVIDER_FB_INSTANT;
  let client_channel = client.client_channel;
  assert(client_channel);

  client_channel.logCtx('info', `login_${provider} ${logdata(data)}`);

  // Validate login credentials
  let signed_data = data.signature;
  if (!signed_data) {
    metrics.add(`login_${provider}_auth_error`, 1);
    client_channel.logCtx('error', `login_${provider} auth failed due to missing signature`);
    return void resp_func('Auth Failed');
  }
  let payload = facebookGetPayloadFromSignedData(signed_data);
  if (!payload || !payload.player_id) {
    metrics.add(`login_${provider}_auth_error`, 1);
    client_channel.logCtx('error', `login_${provider} auth failed due to bad signature`);
    return void resp_func('Auth Failed');
  }

  getMappedUserIdFromProviderId(client_channel, provider, payload.player_id, (err, user_id) => {
    if (err) {
      return void resp_func(err);
    } else if (!client.connected) {
      return void resp_func('ERR_DISCONNECTED');
    }

    let display_name = data.display_name;

    if (user_id) {
      return void channelServerExternalLoginSend(client, provider, payload.player_id, user_id, display_name, resp_func);
    }

    let asid = data.asid;
    if (!asid) {
      metrics.add(`login_${provider}_no_asid_error`, 1);
      client_channel.logCtx('error', `login_${provider} auth failed due to missing asid`);
      return void resp_func('Auth Failed');
    }

    facebookGetPlayerIdFromASIDAsync(asid, (err, player_id) => {
      if (err || !player_id) {
        err = err || 'No player id available';
        metrics.add(`login_${provider}_graph_playerid_error`, 1);
        client_channel.logCtx('error',
          `login_${provider} failure in obtaining the player id for ASID ${asid}: ${err}`);
        // Due to a Facebook bug, we may not be able to get the player id from the ASID.
        // Since the the user is correctly authenticated with the player id, so we will ignore the ASID and proceed.
        client_channel.logCtx('warn',
          `login_${provider} ignoring app-scoped user id due to not being able to obtain player id from it`);
        asid = null;
      } else if (player_id !== payload.player_id) {
        metrics.add(`login_${provider}_playerid_mismatch_error`, 1);
        client_channel.logCtx('error',
          `login_${provider} player id ${player_id} gotten from ASID ${asid}` +
          ` differs from the login player id ${payload.player_id} (possible spoofing attempt)`);
        return void resp_func('Auth Failed');
      } else {
        metrics.add(`login_${provider}_valid`, 1);
      }

      if (!client.connected) {
        return void resp_func('ERR_DISCONNECTED');
      }

      mapValidFacebookIds(client, provider, payload.player_id, asid, payload.player_id, display_name, resp_func);
    });
  });
}

function onLoginFacebookGaming(client, data, resp_func) {
  const provider = ID_PROVIDER_FB_GAMING;
  let client_channel = client.client_channel;
  assert(client_channel);

  client_channel.logCtx('info', `login_${provider} ${logdata(data)}`);

  facebookGetASIDFromLoginDataAsync(data, function (err, asid) {
    if (err || !asid) {
      err = err || 'No app-scoped user id';
      metrics.add(`login_${provider}_auth_error`, 1);
      client_channel.logCtx('error', `login_${provider} auth failed due to ${err}`);
      return void resp_func('Auth Failed');
    } else if (!client.connected) {
      return void resp_func('ERR_DISCONNECTED');
    }

    getMappedUserIdFromProviderId(client_channel, provider, asid, (err, user_id) => {
      if (err) {
        return void resp_func(err);
      } else if (!client.connected) {
        return void resp_func('ERR_DISCONNECTED');
      }

      function queryUserDisplayName(user_data_cb) {
        // Note: These calls could be done as a single call together with the facebookGetPlayerIdFromASIDAsync,
        // but the whole call might fail if one of the fields is missing or if there is no player id associated
        // with the user yet (this happens possibly due to a Facebook bug), thus extra calls are needed.
        facebookGetUserFieldsFromASIDAsync(asid, 'first_name', (err, first_name_result) => {
          let display_name = null;

          if (err) {
            client_channel.logCtx('info', `login_${provider} error while obtaining user's first_name: ${err}`);
          } else {
            display_name = first_name_result?.first_name;
            if (display_name) {
              // If the first_name exists, we don't need to query for the name
              return void user_data_cb(display_name);
            }
          }

          facebookGetUserFieldsFromASIDAsync(asid, 'name', (err, name_result) => {
            if (err) {
              client_channel.logCtx('info', `login_${provider} error while obtaining user's name: ${err}`);
            } else {
              display_name = name_result?.name;
            }
            return void user_data_cb(display_name);
          });
        });
      }

      if (user_id) {
        // Note: We need to check if the user exists in order to avoid a potential racing condition:
        // On concurrent requests happening on the first login, the user id might be mapped but the user
        // might not have been created yet, thus not having a display name associated.
        // In order to avoid several unnecessary calls that are needed to get the display name, since that
        // is only necessary for new users creation, first we check if the user is already created.
        userIdExists(client_channel, user_id, (user_id_exists) => {
          if (!client.connected) {
            return void resp_func('ERR_DISCONNECTED');
          }
          if (user_id_exists) {
            channelServerExternalLoginSend(client, provider, asid, user_id, null, resp_func);
          } else {
            queryUserDisplayName((display_name) => {
              if (!client.connected) {
                return void resp_func('ERR_DISCONNECTED');
              }
              channelServerExternalLoginSend(client, provider, asid, user_id, display_name, resp_func);
            });
          }
        });
        return;
      }

      facebookGetPlayerIdFromASIDAsync(asid, (err, player_id) => {
        if (err || !player_id) {
          err = err || 'No player id available';
          metrics.add(`login_${provider}_graph_playerid_error`, 1);
          client_channel.logCtx('error',
            `login_${provider} failure in obtaining the player id for ASID ${asid}: ${err}`);
          return void resp_func('Auth Failed');
        }
        metrics.add(`login_${provider}_valid`, 1);

        queryUserDisplayName((display_name) => {
          if (!client.connected) {
            return void resp_func('ERR_DISCONNECTED');
          }
          mapValidFacebookIds(client, provider, asid, asid, player_id, display_name, resp_func);
        });
      });
    });
  });
}

// function onLoginApple(client, data, resp_func) {
//   const provider = ID_PROVIDER_APPLE;
//   let client_channel = client.client_channel;
//   assert(client_channel);

//   client_channel.logCtx('info', `login_${provider} ${logdata(data)}`);

//   let identity_token = data.loginCredentials.token;
//   let apple_id = data.loginCredentials.userIdentifier;
//   appleSignInValidateToken(client, identity_token, (err, result) => {
//     if (err) {
//       client_channel.logCtx('info', `login_${provider} auth failed`, identity_token, apple_id);
//       return void resp_func('Apple Auth Failed - Invalid token');
//     } else if (!client.connected) {
//       return void resp_func('ERR_DISCONNECTED');
//     }

//     if (apple_id !== result.sub) {
//       client_channel.logCtx('warn',
//         `login_${provider} auth apple user id from client differs from token (possible spoofing attempt)`,
//         result.sub, apple_id);
//     }
//     getOrCreateMappedUserIdFromProviderId(client_channel, provider, result.sub, (err, user_id) => {
//       if (err) {
//         return void resp_func(err);
//       } else if (!client.connected) {
//         return void resp_func('ERR_DISCONNECTED');
//       }
//       assert(user_id);
//       let display_name = data.loginCredentials.user.name;
//       channelServerExternalLoginSend(client, provider, result.sub, user_id, display_name, resp_func);
//     });
//   });
// }

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
    let uid = buf.toString('base64');
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
  facebookUtilsInit();
  // appleSignInInit();
  profanityCommonStartup(fs.readFileSync(`${__dirname}/../common/words/filter.gkg`, 'utf8'),
    fs.readFileSync(`${__dirname}/../common/words/exceptions.txt`, 'utf8'));

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
  ws_server.onMsg('login_facebook_instant', onLoginFacebookInstant);
  ws_server.onMsg('login_facebook_gaming', onLoginFacebookGaming);
  // ws_server.onMsg('login_apple', onLoginApple);
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

  ws_server.onMsg('upload_start', uploadOnStart);
  ws_server.onMsg('upload_chunk', uploadOnChunk);
  ws_server.onMsg('upload_finish', uploadOnFinish);

  ws_server.setRestartFilter(restartFilter);

  client_worker.init(channel_server);
}
