// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import * as base32 from 'glov/common/base32';
import * as dot_prop from 'glov/common/dot-prop';
import {
  PRESENCE_INACTIVE,
  PRESENCE_OFFLINE,
} from 'glov/common/enums.js';
import { FriendStatus } from 'glov/common/friends_data.js';
import * as md5 from 'glov/common/md5.js';
import {
  EMAIL_REGEX,
  deprecate,
  empty,
  sanitize,
} from 'glov/common/util.js';
import { isProfane, isReserved } from 'glov/common/words/profanity_common.js';

import { channelServerWorkerInit } from './channel_server_worker.js';
import { ChannelWorker } from './channel_worker.js';
import { globalWorkerInit } from './global_worker.js';
import {
  keyMetricsStartup,
  usertimeEnd,
  usertimeStart,
} from './key_metrics.js';
import * as master_worker from './master_worker.js';
import { metricsAdd } from './metrics.js';
import * as random_names from './random_names.js';
import { serverConfig } from './server_config';

deprecate(exports, 'handleChat', 'chattable_worker:handleChat');

const { floor, random } = Math;

const DISPLAY_NAME_MAX_LENGTH = 30;
const DISPLAY_NAME_WAITING_PERIOD = 23 * 60 * 60 * 1000;
const MAX_FRIENDS = 100;
const FRIENDS_DATA_KEY = 'private.friends';

let access_token_fns;
let access_token_regex;

export const regex_valid_username = /^[a-z][a-z0-9_]{1,32}$/;
const regex_valid_user_id = /^(?:fb\$|[a-z0-9])[a-z0-9_]{1,32}$/;
const regex_valid_external_id = /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]*$/;

export function validUserId(user_id) {
  return user_id?.match(regex_valid_user_id);
}

let valid_provider_ids = Object.create(null);
export function registerValidIDProvider(key) {
  valid_provider_ids[key] = true;
}
function validProvider(provider) {
  return valid_provider_ids[provider] || false;
}

export function validExternalId(external_id) {
  return external_id.match(regex_valid_external_id);
}

function getDisplayNameBypass(source) {
  let display_name_bypass_flags = serverConfig().display_name_bypass_flags;
  for (let ii = 0; ii < display_name_bypass_flags.length; ++ii) {
    let flag = display_name_bypass_flags[ii];
    if (source[flag]) {
      return true;
    }
  }
  return false;
}

// First character must not be a bracket (confusing messages with `/me`)
const valid_display_name = /^[^[\]]/;

function validDisplayName(display_name, override) {
  if (!display_name || sanitize(display_name).trim() !== display_name ||
    isProfane(display_name) || display_name.length > DISPLAY_NAME_MAX_LENGTH ||
    EMAIL_REGEX.test(display_name) ||
    !valid_display_name.test(display_name) ||
    (!override && isReserved(display_name))
  ) {
    return false;
  }
  return true;
}

function isLegacyFriendValue(friend_value) {
  return friend_value.status === undefined;
}

function createFriendData(status) {
  return { status };
}

function deleteFriendExternalId(friend, provider) {
  if (friend.ids) {
    delete friend.ids[provider];
    if (Object.keys(friend.ids).length === 0) {
      delete friend.ids;
    }
  }
}

function setFriendExternalId(friend, provider, external_id) {
  if (external_id === null || external_id === undefined) {
    return void deleteFriendExternalId(friend, provider);
  }

  if (!friend.ids) {
    friend.ids = {};
  }
  friend.ids[provider] = external_id;
}

export class DefaultUserWorker extends ChannelWorker {
  constructor(channel_server, channel_id, channel_data) {
    super(channel_server, channel_id, channel_data);
    this.user_id = this.channel_subid; // 1234
    this.presence_data = {}; // client_id -> data
    this.presence_idx = 0;
    this.my_clients = {};
    this.last_abtests = '';
    this.last_usertime_active = false;
    this.last_usertime_abtests = '';

    // Migration logic for engine-level fields
    if (this.exists()) {
      let creation_time_old = this.getChannelData('private.creation_time');
      if (creation_time_old) {
        this.setChannelData('public.creation_time', creation_time_old);
        this.setChannelData('private.creation_time', undefined);
      }
    }

  }

  migrateFriendsList(legacy_friends) {
    let new_friends = {};
    for (let user_id in legacy_friends) {
      let fbinstant_friend_id = user_id.startsWith('fb$') && user_id.substr(3);
      let status = legacy_friends[user_id];
      let friend;
      switch (status) {
        case FriendStatus.Added:
        case FriendStatus.Blocked:
          friend = createFriendData(status);
          // Note: To prevent possible non FB Instant friends to be marked as FB friends,
          // the FB Instant ids will only be added when the client sends the FB Instant friends mismatches.
          break;
        case FriendStatus.AddedAuto:
        case FriendStatus.Removed:
          if (fbinstant_friend_id) {
            friend = createFriendData(status);
            // Note: If the friend status is added-auto or removed, it must have been added through FB Instant,
            // so we can use its FB Instant id.
            setFriendExternalId(friend, 'fbi', fbinstant_friend_id);
          } else {
            // Unknown FB Instant friend id, so remove it and let it be re-added by the client.
            // This may cause occasional cases of manually removed friends to reappear as added-auto.
            friend = undefined;
          }
          break;
        default:
          assert(false);
      }

      if (friend) {
        new_friends[user_id] = friend;
      }
    }

    this.setFriendsList(new_friends);
    return new_friends;
  }

  getFriendsList() {
    let friends = this.getChannelData(FRIENDS_DATA_KEY, {});
    for (let user_id in friends) {
      if (isLegacyFriendValue(friends[user_id])) {
        friends = this.migrateFriendsList(friends);
      }
      break;
    }
    return friends;
  }

  setFriendsList(friends) {
    this.setChannelData(FRIENDS_DATA_KEY, friends);
  }

  getFriend(user_id) {
    if (!validUserId(user_id)) {
      return null;
    }

    let friend = this.getChannelData(`${FRIENDS_DATA_KEY}.${user_id}`, undefined);
    if (friend !== undefined && isLegacyFriendValue(friend)) {
      // The getFriendsList handles the migration
      friend = this.getFriendsList()[user_id];
    }
    return friend;
  }

  setFriend(user_id, friend) {
    if (!validUserId(user_id)) {
      return;
    }

    this.setChannelData(`${FRIENDS_DATA_KEY}.${user_id}`, friend);
  }

  cmdRename(new_name, resp_func) {
    if (this.cmd_parse_source.user_id !== this.user_id) {
      return resp_func('ERR_INVALID_USER');
    }
    if (!new_name) {
      return resp_func('Missing name');
    }
    let display_name_bypass = getDisplayNameBypass(this.cmd_parse_source);
    if (!validDisplayName(new_name, display_name_bypass)) {
      return resp_func('Invalid display name');
    }
    let old_name = this.getChannelData('public.display_name');
    if (new_name === old_name) {
      return resp_func('Name unchanged');
    }
    let unimportant = new_name.toLowerCase() === old_name.toLowerCase();
    let now = Date.now();
    let last_change = this.getChannelData('private.display_name_change');
    if (last_change && now - last_change < DISPLAY_NAME_WAITING_PERIOD && !unimportant &&
      !display_name_bypass
    ) {
      return resp_func('You must wait 24h before changing your display name again');
    }
    this.setChannelData('public.display_name', new_name);
    if (!unimportant) {
      this.setChannelData('private.display_name_change', now);
    }
    return resp_func(null, 'Successfully renamed');
  }
  cmdRenameRandom(ignored, resp_func) {
    return this.cmdRename(random_names.get(), resp_func);
  }
  cmdFriendAdd(user_id, resp_func) {
    if (this.cmd_parse_source.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!user_id) {
      return void resp_func('Missing User ID');
    }
    if (!validUserId(user_id)) {
      return void resp_func('Invalid User ID');
    }
    if (user_id === this.user_id) {
      return void resp_func('Cannot friend yourself');
    }
    let friends = this.getFriendsList();
    let friend = friends[user_id];
    if (friend?.status === FriendStatus.Added) {
      return void resp_func(`Already on friends list: ${user_id}`);
    }
    if (Object.keys(friends).length >= MAX_FRIENDS) {
      return void resp_func('Maximum friends list size exceeded');
    }
    this.pak(`user.${user_id}`, 'user_ping').send((err) => {
      if (err) {
        this.log(`Error pinging ${user_id}: ${err}`);
        // Return generic error
        return void resp_func(`User not found: ${user_id}`);
      }
      assert(!this.shutting_down); // Took really long?  Need to override `isEmpty`
      if (friend) {
        friend.status = FriendStatus.Added;
      } else {
        friend = createFriendData(FriendStatus.Added);
      }
      this.setFriend(user_id, friend);
      resp_func(null, { msg: `Friend added: ${user_id}`, friend });
    });
  }
  cmdFriendRemove(user_id, resp_func) {
    if (this.cmd_parse_source.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!user_id) {
      return void resp_func('Missing User ID');
    }
    if (!validUserId(user_id)) {
      return void resp_func('Invalid User ID');
    }
    let friend = this.getFriend(user_id);
    if (!friend) {
      return void resp_func(`Not on your friends list: ${user_id}`);
    }
    // TODO: Should we handle the blocked friends differently in order to keep them blocked?
    if (friend.ids) {
      // Flag as 'removed' if this still has external ids
      friend.status = FriendStatus.Removed;
    } else {
      friend = undefined;
    }
    this.setFriend(user_id, friend);
    resp_func(null, { msg: `Friend removed: ${user_id}`, friend });
  }
  cmdFriendUnblock(user_id, resp_func) {
    if (this.cmd_parse_source.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!user_id) {
      return void resp_func('Missing User ID');
    }
    if (!validUserId(user_id)) {
      return void resp_func('Invalid User ID');
    }
    let friend = this.getFriend(user_id);
    if (!friend) {
      return void resp_func(`Not on your friends list: ${user_id}`);
    }
    if (friend.status !== FriendStatus.Blocked) {
      return void resp_func(`Not blocked: ${user_id}`);
    }
    if (friend.ids) {
      // Flag as 'removed' if this still has external ids
      friend.status = FriendStatus.Removed;
    } else {
      friend = undefined;
    }
    this.setFriend(user_id, friend);
    resp_func(null, { msg: `User unblocked: ${user_id}`, friend });
  }
  cmdFriendBlock(user_id, resp_func) {
    if (this.cmd_parse_source.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!user_id) {
      return void resp_func('Missing User ID');
    }
    if (!validUserId(user_id)) {
      return void resp_func('Invalid User ID');
    }
    let friends = this.getFriendsList();
    let friend = friends[user_id];
    if (friend?.status === FriendStatus.Blocked) {
      return void resp_func(`User already blocked: ${user_id}`);
    }
    if (Object.keys(friends).length >= MAX_FRIENDS) {
      return void resp_func('Maximum friends list size exceeded');
    }
    this.pak(`user.${user_id}`, 'user_ping').send((err) => {
      if (err) {
        this.log(`Error pinging ${user_id}: ${err}`);
        // Return generic error
        return void resp_func(`User not found: ${user_id}`);
      }
      assert(!this.shutting_down); // Took really long?  Need to override `isEmpty`
      let was_friend = false;
      if (friend) {
        was_friend = friend.status === FriendStatus.Added || friend.status === FriendStatus.AddedAuto;
        friend.status = FriendStatus.Blocked;
      } else {
        friend = createFriendData(FriendStatus.Blocked);
      }
      this.setFriend(user_id, friend);
      resp_func(null, {
        msg: `User${was_friend ? ' removed from friends list and' : ''} blocked: ${user_id}`,
        friend,
      });
      this.clearPresenceToUser(user_id);
    });
  }
  cmdAccessToken(access_token/*: string*/, resp_func/*: HandlerCallback<UnimplementedData>*/) {
    let source = this.cmd_parse_source;
    if (source.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }

    if (!access_token || typeof access_token !== 'string') {
      return void resp_func('ERR_MISSING_TOKEN');
    }

    this.logSrc(source, `access_token "${access_token}"`);
    access_token = base32.cannonize(access_token);
    if (!access_token) {
      return void resp_func('ERR_MALFORMED_TOKEN');
    }
    // Determine type of token
    let m = access_token.match(access_token_regex);
    if (!m || m[3].length < 8) {
      return void resp_func('ERR_MALFORMED_TOKEN');
    }
    let type = m[1];
    let target = m[2];
    let body = m[3];
    let fn = access_token_fns[type];
    assert(fn); // shouldn't pass the regex otherwise
    fn.call(this, target, body, resp_func);
  }
  applyTokenPerm(target/*:string*/, perm_token/*: string*/, resp_func/*: HandlerCallback<UnimplementedData>*/) {
    let source = this.cmd_parse_source;
    if (target) {
      return void resp_func('ERR_INVALID_DATA');
    }
    let key = `private.tokens.${perm_token}`;
    this.sendChannelMessage('perm_token.perm_token', 'get_channel_data', key,
      (err/*?: string*/, resp_data/*?: UnimplementedData*/) => {
        if (err) {
          return void resp_func(err);
        }
        if (!resp_data) {
          return void resp_func('ERR_INVALID_TOKEN');
        }
        assert(Array.isArray(resp_data.ops));
        let ops = resp_data.ops/* as UnimplementedData[]*/;
        if (resp_data.claimed) {
          // Really, was in process of being claimed, could perhaps re-apply if it was us that was doing the original
          // applying.
          return void resp_func('ERR_ALREADY_CLAIMED');
        }
        this.logSrc(source, `Claiming token ${perm_token} for ${JSON.stringify(ops)}`);
        // Atomically claim (but not atomically applying to user)
        // Could be conservative and apply to user, try to claim
        let pak = this.pak('perm_token.perm_token', 'set_channel_data_if');
        pak.writeAnsiString(`${key}.claimed`);
        pak.writeJSON(1); // value
        pak.writeJSON(0); // set_if
        pak.send((err/*?: string*/) => {
          if (err) {
            return resp_func(err);
          }
          // Apply
          let perm = this.getChannelData('public.permissions', {});
          for (let ii = 0; ii < ops.length; ++ii) {
            let op = ops[ii];
            assert(op.key);
            let value = op.value;
            switch (op.op) {
              case 'add':
                dot_prop.set(perm, op.key, (dot_prop.get(perm, op.key) || 0) + value);
                break;
              case 'set':
                dot_prop.set(perm, op.key, value);
                break;
              default:
                console.error(resp_data);
                assert(0);
            }
          }
          this.setChannelData('public.permissions', perm);
          // Also delete token from global
          this.setChannelDataOnOther('perm_token.perm_token', `${key}`, undefined);
          this.logSrc(source, `Claimed token ${perm_token}`);
          return resp_func(null, `Successfully applied permissions token ${perm_token}`);
        });
      });
  }

  cmdChannelDataGet(param, resp_func) {
    if (this.cmd_parse_source.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!this.getChannelData('public.permissions.sysadmin')) {
      return void resp_func('ERR_ACCESS_DENIED');
    }
    let m = param.match(/^([^ ]+) ([^ ]+)$/);
    if (!m) {
      return void resp_func('Error parsing arguments');
    }
    if (!m[2].match(/^(public|private)/)) {
      return void resp_func('Key must start with public. or private.');
    }
    this.sendChannelMessage(m[1], 'get_channel_data', m[2], function (err, resp) {
      resp_func(err,
        `${m[1]}:${m[2]} = ${resp === undefined ? 'undefined' : JSON.stringify(resp)}`);
    });
  }
  cmdChannelDataSet(param, resp_func) {
    if (this.cmd_parse_source.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!this.getChannelData('public.permissions.sysadmin')) {
      return void resp_func('ERR_ACCESS_DENIED');
    }
    let m = param.match(/^([^ ]+) ([^ ]+) (.+)$/);
    if (!m) {
      return void resp_func('Error parsing arguments');
    }
    if (!m[2].match(/^(public\.|private\.)/)) {
      return void resp_func('Key must start with public. or private.');
    }
    let value;
    try {
      if (m[3] !== 'undefined') {
        value = JSON.parse(m[3]);
      }
    } catch (e) {
      return void resp_func(`Error parsing value: ${e}`);
    }
    this.setChannelDataOnOther(m[1], m[2], value, function (err, resp) {
      if (err || resp) {
        resp_func(err, resp);
      } else {
        resp_func(null, 'Channel data set.');
      }
    });
  }
  handleFriendList(src, pak, resp_func) {
    if (src.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    let friends = this.getFriendsList();
    resp_func(null, friends);
  }
  handleFriendAutoUpdate(src, pak, resp_func) {
    if (src.user_id !== this.user_id) {
      pak.pool();
      return void resp_func('ERR_INVALID_USER');
    }

    let provider = pak.readAnsiString();
    if (!validProvider(provider)) {
      pak.pool();
      return void resp_func('ERR_INVALID_PROVIDER');
    }

    let friends = this.getFriendsList();

    let provider_friends_map = Object.create(null);
    for (let user_id in friends) {
      let friend = friends[user_id];
      let external_id = friend.ids?.[provider];
      if (external_id) {
        provider_friends_map[external_id] = { user_id, friend };
      }
    }

    let changed_id;
    let friends_to_add = [];
    while ((changed_id = pak.readAnsiString())) {
      if (!validExternalId(changed_id)) {
        this.error(`Trying to add external friend with invalid external user id: ${changed_id}`);
        continue;
      }
      if (!provider_friends_map[changed_id]) {
        friends_to_add.push(changed_id);
      }
    }
    let changed = false;
    while ((changed_id = pak.readAnsiString())) {
      if (!validExternalId(changed_id)) {
        this.error(`Trying to remove external friend with invalid external user id: ${changed_id}`);
        continue;
      }
      let entry = provider_friends_map[changed_id];
      if (entry) {
        let { user_id, friend } = entry;
        deleteFriendExternalId(friend, provider);
        if (!friend.ids && (friend.status === FriendStatus.AddedAuto || friend.status === FriendStatus.Removed)) {
          delete friends[user_id];
        }
        changed = true;
      }
    }
    if (changed) {
      this.setFriendsList(friends);
    }

    if (friends_to_add.length === 0) {
      return void resp_func(null, {});
    }

    this.sendChannelMessage(
      'idmapper.idmapper',
      'id_map_get_multiple_ids',
      { provider, provider_ids: friends_to_add, get_deleted: true },
      (err, id_mappings) => {
        if (err) {
          this.error(`Error getting id maps for ${this.user_id} ${provider} friends: ${err}`);
          return void resp_func('Error when getting friends');
        }
        assert(!this.shutting_down); // Took really long?  Need to override `isEmpty`

        // Refresh the friends list
        friends = this.getFriendsList();

        let resp = {};
        for (let external_id in id_mappings) {
          let user_id = id_mappings[external_id];
          let friend = friends[user_id];
          if (!friend) {
            friends[user_id] = friend = createFriendData(FriendStatus.AddedAuto);
          }
          setFriendExternalId(friend, provider, external_id);
          resp[user_id] = friend;
        }

        this.setFriendsList(friends);
        resp_func(null, resp);
      }
    );
  }
  exists() {
    return this.getChannelData('private.password') || this.getChannelData('private.external');
  }
  handleUserPing(src, pak, resp_func) {
    if (!this.exists()) {
      return resp_func('ERR_USER_NOT_FOUND');
    }
    // Also return display name and any other relevant info?
    return resp_func();
  }
  checkAutoIPBan(login_ip) {
    if (!this.getChannelData('private.auto_ip_ban')) {
      return;
    }
    this.error(`Queuing delayed automatic IP ban for account ${this.user_id} from IP ${login_ip}`);
    setTimeout(() => {
      if (this.shutting_down) {
        return;
      }
      this.error(`Executing automatic IP ban for account ${this.user_id} from IP ${login_ip}`);
      let ids_saved = this.ids;
      this.ids = { user_id: '$system', csr: 1 };
      this.sendChannelMessage('global.global', 'cmdparse', `ipban ${login_ip}`, (err) => {
        if (err) {
          this.error(`Error executing automatic IP ban for account ${this.user_id} from IP ${login_ip}: ${err}`);
        }
      });
      this.ids = ids_saved;
    }, floor(3*60*1000 + random() * 2*60*1000));
  }
  handleLoginShared(data, resp_func) {
    this.setChannelData('private.login_ip', data.ip);
    this.setChannelData('private.login_ua', data.ua);
    this.setChannelData('private.login_time', Date.now());

    let display_name = this.getChannelData('public.display_name');
    let permissions = this.getChannelData('public.permissions', {});
    let display_name_bypass = getDisplayNameBypass(permissions);
    if (!validDisplayName(display_name, display_name_bypass)) {
      // Old data with no display_name, or valid display name rules have changed
      let new_display_name = this.user_id;
      if (!validDisplayName(new_display_name)) {
        new_display_name = random_names.get();
      }
      this.log(`Invalid display name ("${display_name}") on user ${this.user_id}` +
        ` detected, changing to "${new_display_name}"`);
      this.setChannelData('public.display_name', new_display_name);
    }
    this.checkAutoIPBan(data.ip);
    metricsAdd('user.login', 1);

    resp_func(null, {
      public_data: this.getChannelData('public'),
      email: this.getChannelData('private.email'),
    });
  }
  handleLogin(src, data, resp_func) {
    if (this.channel_server.restarting) {
      if (!this.getChannelData('public.permissions.sysadmin')) {
        // Maybe black-hole like other messages instead?
        return resp_func('ERR_RESTARTING');
      }
    }
    if (!data.password) {
      return resp_func('Missing password');
    }

    if (this.getChannelData('private.password_deleted')) {
      return resp_func('ERR_ACCOUNT_MIGRATED');
    }
    if (!this.getChannelData('private.password')) {
      return resp_func('ERR_USER_NOT_FOUND');
    }
    if (this.getChannelData('public.banned')) {
      return resp_func('ERR_ACCOUNT_BANNED');
    }
    if (md5(data.salt + this.getChannelData('private.password')) !== data.password) {
      return resp_func('Invalid password');
    }
    metricsAdd('user.login_pass', 1);
    return this.handleLoginShared(data, resp_func);
  }
  handleLoginExternal(src, data, resp_func) {
    if (this.channel_server.restarting) {
      if (!this.getChannelData('public.permissions.sysadmin')) {
        // Maybe black-hole like other messages instead?
        return resp_func('ERR_RESTARTING');
      }
    }

    //Should the authentication step happen here instead?

    assert(data.provider_ids);
    for (let provider in data.provider_ids) {
      let provider_id = data.provider_ids[provider];
      let provider_key = `private.login_${provider}`;
      let previous_id = this.getChannelData(provider_key);
      if (previous_id) {
        assert(provider_id === previous_id,
          `Multiple external ids for user ${this.user_id} and provider ${provider}: ${previous_id}, ${provider_id}`);
      } else {
        this.setChannelData(provider_key, provider_id);
      }
    }

    if (this.getChannelData('public.banned')) {
      return resp_func('ERR_ACCOUNT_BANNED');
    }
    if (!this.exists()) {
      this.setChannelData('private.external', true);
      return this.createShared(data, resp_func);
    }
    metricsAdd(`user.login_${data.provider}`, 1);
    return this.handleLoginShared(data, resp_func);
  }
  handleCreate(src, data, resp_func) {
    if (this.exists()) {
      return resp_func('Account already exists');
    }
    if (!data.password) {
      return resp_func('Missing password');
    }
    if (this.require_email && !EMAIL_REGEX.test(data.email)) {
      return resp_func('Email invalid');
    }
    if (!validDisplayName(data.display_name)) {
      return resp_func('Invalid display name');
    }
    return this.createShared(data, resp_func);
  }
  createShared(data, resp_func) {
    if (this.onUserCreate) {
      let err = this.onUserCreate(data);
      if (err) {
        return resp_func(err);
      }
    }

    let public_data = this.data.public;
    let private_data = this.data.private;

    public_data.display_name = data.display_name;
    if (!validDisplayName(public_data.display_name)) { // If from external auth
      public_data.display_name = random_names.get();
    }
    public_data.creation_time = Date.now();
    private_data.password = data.password;
    private_data.email = data.email || private_data.email;
    private_data.creation_ip = data.ip;
    private_data.login_ip = data.ip;
    private_data.login_ua = data.ua;
    private_data.login_time = Date.now();
    this.setChannelData('private', private_data);
    this.setChannelData('public', public_data);
    metricsAdd('user.create', 1);
    return resp_func(null, {
      public_data: this.getChannelData('public'),
      first_session: true,
      email: this.getChannelData('private.email'),
    });
  }

  handleReplacePasswordWithExternal(src, { password, provider, provider_id, salt }, resp_func) {
    if (!this.exists()) {
      return resp_func('Account does not exists');
    }
    if (!password) {
      return resp_func('Missing password');
    }
    if (!provider || !provider_id) {
      return resp_func('Missing provider/provider_id', provider, provider_id);
    }
    let private_data = this.getChannelData('private');
    if (md5(salt + private_data.password) !== password) {
      return resp_func('Password mismatch');
    }
    private_data.password_deleted = private_data.password;
    private_data.password = undefined;
    private_data[`login_${provider}`] = provider_id;
    private_data.external = true;
    this.setChannelData('private', private_data);

    return resp_func(null, true);
  }

  handleSetExternal(src, data, resp_func) {
    if (!data.provider || !data.provider_id) {
      return resp_func('Missing provider/provider_id', data.provider, data.provider_id);
    }
    this.setChannelData(`private.login_${data.provider}`, data.provider_id);
    this.setChannelData('private.external', true);
    return resp_func(null, true);
  }

  handleSetEmail(src, email, resp_func) {
    if (!email) {
      return resp_func('Missing email');
    }
    if (!EMAIL_REGEX.test(email)) {
      return resp_func('Invalid email');
    }
    if (email === this.data.private.email) {
      return resp_func(null, true);
    }
    this.logSrc(src, `Updating user ${this.user_id} email from ${this.data.private.email} to ${email}`);
    this.setChannelData('private.email', email);
    return resp_func(null, true);
  }

  handleSetChannelData(src, key, value) {
    let err = this.defaultHandleSetChannelData(src, key, value);
    if (err) {
      return err;
    }
    assert(src);
    assert(src.type);
    if (src.type !== 'client') {
      // from another channel, accept it
      return null;
    }
    // Only allow changes from own client!
    if (src.user_id !== this.user_id) {
      return 'ERR_INVALID_USER';
    }
    return null;
  }

  handleNewClient(src, opts) {
    if (this.rich_presence && src.type === 'client' && this.presence_data) {
      if (this.getFriend(src.user_id)?.status !== FriendStatus.Blocked) {
        this.sendChannelMessage(src.channel_id, 'presence', this.presence_data);
      }
    }
    if (src.type === 'client' && src.user_id === this.user_id) {
      this.my_clients[src.channel_id] = true;
    }
    return null;
  }
  updatePresence() {
    let clients = this.data.public.clients || {};
    let friends = this.getFriendsList();
    for (let client_id in clients) {
      let client = clients[client_id];
      if (client.ids) {
        if (friends[client.ids.user_id]?.status !== FriendStatus.Blocked) {
          this.sendChannelMessage(`client.${client_id}`, 'presence', this.presence_data);
        }
      }
    }
  }
  clearPresenceToUser(user_id) {
    let clients = this.data.public.clients || {};
    for (let client_id in clients) {
      let client = clients[client_id];
      if (client.ids && client.ids.user_id === user_id) {
        this.sendChannelMessage(`client.${client_id}`, 'presence', {});
      }
    }
  }

  updateUsertimeMetrics() {
    let currently_active = false;
    if (this.rich_presence) {
      for (let channel_id in this.presence_data) {
        let presence = this.presence_data[channel_id];
        if (presence.active !== PRESENCE_INACTIVE) {
          currently_active = true;
          break;
        }
      }
    } else {
      currently_active = !empty(this.my_clients);
    }

    if (this.last_usertime_active && (
      !currently_active || this.last_abtests !== this.last_usertime_abtests
    )) {
      this.last_usertime_active = false;
      usertimeEnd(this.last_usertime_abtests);
    }
    if (!this.last_usertime_active && currently_active) {
      this.last_usertime_active = true;
      this.last_usertime_abtests = this.last_abtests;
      usertimeStart(this.last_usertime_abtests);
    }
  }

  handleClientDisconnect(src) {
    if (this.rich_presence && this.presence_data[src.channel_id]) {
      delete this.presence_data[src.channel_id];
      this.updatePresence();
    }
    if (this.my_clients[src.channel_id]) {
      delete this.my_clients[src.channel_id];
    }
    this.updateUsertimeMetrics();
  }
  handlePresenceGet(src, pak, resp_func) {
    if (!this.exists()) {
      return void resp_func('ERR_USER_NOT_FOUND');
    }
    if (!this.rich_presence) {
      return void resp_func('ERR_NO_RICH_PRESENCE');
    }
    let friends = this.getFriendsList();
    if (friends[src.user_id]?.status === FriendStatus.Blocked) {
      return void resp_func(null, {});
    }
    resp_func(null, this.presence_data);
  }
  handlePresenceSet(src, pak, resp_func) {
    let active = pak.readInt();
    let state = pak.readAnsiString(); // app-defined state
    let payload = pak.readJSON();
    let abtests = '';
    if (!pak.ended()) {
      abtests = pak.readAnsiString();
      if (active !== PRESENCE_INACTIVE) {
        this.last_abtests = abtests;
      }
    }
    if (!this.rich_presence) {
      return void resp_func('ERR_NO_RICH_PRESENCE');
    }
    if (src.user_id !== this.user_id) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (active === PRESENCE_OFFLINE) {
      delete this.presence_data[src.channel_id];
    } else {
      this.presence_data[src.channel_id] = {
        id: ++this.presence_idx, // Timestamp would work too for ordering, but this is more concise
        active,
        state,
        payload,
      };
    }
    this.updatePresence();
    this.updateUsertimeMetrics();
    resp_func();
  }
  sendMessageToMyClients(message, payload, exclude_channel_id) {
    for (let channel_id in this.my_clients) {
      if (channel_id !== exclude_channel_id) {
        this.sendChannelMessage(channel_id, message, payload);
      }
    }
  }
  handleCSRAdminToUser(src, pak, resp_func) {
    let access = pak.readJSON();
    let cmd = pak.readString();
    let desired_client_id = pak.readAnsiString();
    if (!this.exists()) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!src.sysadmin && !src.csr) {
      return void resp_func('ERR_ACCESS_DENIED');
    }
    // first, try running here on a (potentially offline) user
    this.cmd_parse_source = { user_id: this.user_id }; // spoof as is from self
    for (let key in src) {
      access[key] = src[key];
    }
    this.access = access; // use caller's access credentials
    this.cmd_parse.handle(this, cmd, (err, resp) => {
      if (!this.cmd_parse.was_not_found) {
        return void resp_func(err, resp);
      }
      // not found
      // find a client worker for this user
      let to_use;
      let desired_channel_id = desired_client_id ? `client.${desired_client_id}` : '';
      if (desired_channel_id && this.my_clients[desired_channel_id]) {
        to_use = desired_channel_id;
      } else {
        for (let channel_id in this.my_clients) {
          to_use = channel_id;
          if (channel_id !== src.channel_id) {
            break;
          }
        }
      }
      if (!to_use) {
        return void resp_func(`User ${this.user_id} has no connected clients`);
      }
      this.log(`Fowarding /csr request ("${cmd}") for ${src.user_id}(${src.channel_id}) to ${to_use}`);
      let out = this.pak(to_use, 'csr_user_to_clientworker');
      out.writeString(cmd);
      out.writeJSON(access);
      out.send(resp_func);
    });

  }
}
DefaultUserWorker.prototype.auto_destroy = true;
DefaultUserWorker.prototype.require_email = true;
DefaultUserWorker.prototype.rich_presence = true;
DefaultUserWorker.prototype.maintain_client_list = true; // needed for rich_presence features

let inited = false;
let user_worker = DefaultUserWorker;
let user_worker_init_data = {
  autocreate: true,
  subid_regex: regex_valid_user_id,
  cmds: [{
    cmd: 'rename',
    help: 'Change display name',
    usage: 'Changes your name as seen by others, your user name (login) remains the same.\n  Usage: /rename New Name',
    func: DefaultUserWorker.prototype.cmdRename,
  },{
    cmd: 'rename_random',
    help: 'Change display name to something random',
    func: DefaultUserWorker.prototype.cmdRenameRandom,
  },{
    cmd: 'friend_add',
    help: 'Add a friend',
    func: DefaultUserWorker.prototype.cmdFriendAdd,
  },{
    cmd: 'friend_remove',
    help: 'Remove a friend',
    func: DefaultUserWorker.prototype.cmdFriendRemove,
  },{
    cmd: 'friend_block',
    help: 'Block someone from seeing your rich presence, also removes from your friends list',
    func: DefaultUserWorker.prototype.cmdFriendBlock,
  },{
    cmd: 'friend_unblock',
    help: 'Reset a user to allow seeing your rich presence again',
    func: DefaultUserWorker.prototype.cmdFriendUnblock,
  },{
    cmd: 'access_token',
    help: 'Apply an access token',
    func: DefaultUserWorker.prototype.cmdAccessToken,
  },{
    cmd: 'channel_data_get',
    help: '(Admin) Get from a channel\'s metadata',
    usage: '$HELP\n/channel_data_get channel_id field.name',
    access_run: ['sysadmin'],
    func: DefaultUserWorker.prototype.cmdChannelDataGet,
  },{
    cmd: 'channel_data_set',
    help: '(Admin) Set a channel\'s metadata',
    usage: '$HELP\n/channel_data_set channel_id field.name JSON',
    access_run: ['sysadmin'],
    func: DefaultUserWorker.prototype.cmdChannelDataSet,
  }],
  handlers: {
    login_external: DefaultUserWorker.prototype.handleLoginExternal,
    login: DefaultUserWorker.prototype.handleLogin,
    create: DefaultUserWorker.prototype.handleCreate,
    user_ping: DefaultUserWorker.prototype.handleUserPing,
    replace_password_with_external: DefaultUserWorker.prototype.handleReplacePasswordWithExternal,
    set_external: DefaultUserWorker.prototype.handleSetExternal,
    set_email: DefaultUserWorker.prototype.handleSetEmail,
  },
  client_handlers: {
    friend_auto_update: DefaultUserWorker.prototype.handleFriendAutoUpdate,
    friend_list: DefaultUserWorker.prototype.handleFriendList,
    presence_get: DefaultUserWorker.prototype.handlePresenceGet,
    presence_set: DefaultUserWorker.prototype.handlePresenceSet,
    csr_admin_to_user: DefaultUserWorker.prototype.handleCSRAdminToUser,
  },
  access_tokens: {
    P: DefaultUserWorker.prototype.applyTokenPerm,
  },
};
export function overrideUserWorker(new_user_worker, extra_data) {
  assert(!inited);
  user_worker = new_user_worker;
  for (let key in extra_data) {
    let v = extra_data[key];
    if (Array.isArray(v)) {
      let dest = user_worker_init_data[key] = user_worker_init_data[key] || [];
      for (let ii = 0; ii < v.length; ++ii) {
        dest.push(v[ii]);
      }
    } else if (typeof v === 'object') {
      let dest = user_worker_init_data[key] = user_worker_init_data[key] || {};
      for (let subkey in v) {
        dest[subkey] = v[subkey];
      }
    } else {
      user_worker_init_data[key] = v;
    }
  }
}

export function init(channel_server) {
  inited = true;
  let token_keys = [];
  access_token_fns = user_worker_init_data.access_tokens;
  for (let key in access_token_fns) {
    assert(access_token_fns[key]);
    token_keys.push(key);
  }
  access_token_regex = new RegExp(`^([${token_keys.join('')}])([^Z]*)Z([0-9A-Z]+)$`);
  channel_server.registerChannelWorker('user', user_worker, user_worker_init_data);
  channelServerWorkerInit(channel_server);
  globalWorkerInit(channel_server);
  master_worker.init(channel_server);
  keyMetricsStartup(channel_server);
}
