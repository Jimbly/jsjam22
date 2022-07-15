// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
import { FriendStatus } from 'glov/common/friends_data.js';

const assert = require('assert');
const { ChannelWorker } = require('./channel_worker.js');
const {
  ID_PROVIDER_APPLE,
  ID_PROVIDER_FB_GAMING,
  ID_PROVIDER_FB_INSTANT,
  PRESENCE_OFFLINE,
} = require('glov/common/enums.js');
const master_worker = require('./master_worker.js');
const md5 = require('glov/common/md5.js');
const metrics = require('./metrics.js');
const { isProfane, isReserved } = require('glov/common/words/profanity_common.js');
const random_names = require('./random_names.js');
const { deprecate, sanitize } = require('glov/common/util.js');

deprecate(exports, 'handleChat', 'chattable_worker:handleChat');

const DISPLAY_NAME_MAX_LENGTH = 30;
const DISPLAY_NAME_WAITING_PERIOD = 23 * 60 * 60 * 1000;
const email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FRIENDS = 100;
const FRIENDS_DATA_KEY = 'private.friends';

export const regex_valid_username = /^[a-z][a-z0-9_]{1,32}$/;
const regex_valid_user_id = /^(?:fb\$|[a-z0-9])[a-z0-9_]{1,32}$/;
const regex_valid_external_id = /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]*$/;

export function validUserId(user_id) {
  return user_id?.match(regex_valid_user_id);
}

export function validProvider(provider) {
  switch (provider) {
    case ID_PROVIDER_APPLE:
    case ID_PROVIDER_FB_GAMING:
    case ID_PROVIDER_FB_INSTANT:
      return true;
    default:
      return false;
  }
}

export function validExternalId(external_id) {
  return external_id.match(regex_valid_external_id);
}

function validDisplayName(display_name, is_sysadmin) {
  if (!display_name || sanitize(display_name).trim() !== display_name ||
    isProfane(display_name) || display_name.length > DISPLAY_NAME_MAX_LENGTH ||
    (!is_sysadmin && isReserved(display_name))
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
            setFriendExternalId(friend, ID_PROVIDER_FB_INSTANT, fbinstant_friend_id);
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
    if (!validDisplayName(new_name, this.cmd_parse_source.sysadmin)) {
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
      !this.cmd_parse_source.sysadmin
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

    this.sendChannelMessage('idmapper.idmapper', 'id_map_get_multiple_ids', { provider, provider_ids: friends_to_add },
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

    if (!this.getChannelData('private.password')) {
      return resp_func('ERR_USER_NOT_FOUND');
    }
    if (md5(data.salt + this.getChannelData('private.password')) !== data.password) {
      return resp_func('Invalid password');
    }
    this.setChannelData('private.login_ip', data.ip);
    this.setChannelData('private.login_ua', data.ua);
    let display_name = this.getChannelData('public.display_name');
    if (!validDisplayName(display_name, this.getChannelData('public.permissions.sysadmin'))) {
      // Old data with no display_name, or valid display name rules have changed
      let new_display_name = this.user_id;
      if (!validDisplayName(new_display_name)) {
        new_display_name = random_names.get();
      }
      this.log(`Invalid display name ("${display_name}") on user ${this.user_id}` +
        ` detected, changing to "${new_display_name}"`);
      this.setChannelData('public.display_name', new_display_name);
    }

    this.setChannelData('private.login_time', Date.now());
    metrics.add('user.login', 1);
    return resp_func(null, this.getChannelData('public'));
  }
  handleLoginExternal(src, data, resp_func) {
    //Should the authentication step happen here instead?
    if (!this.getChannelData('private.external')) {
      this.setChannelData('private.external', true);
      return this.createShared(data, resp_func);
    }
    this.setChannelData('private.login_ip', data.ip);
    this.setChannelData('private.login_ua', data.ua);
    this.setChannelData('private.login_time', Date.now());
    this.setChannelData(`private.login_${data.provider}`, data.provider_id);
    metrics.add('user.login', 1);
    metrics.add(`user.login_${data.provider}`, 1);
    return resp_func(null, this.getChannelData('public'));
  }
  handleCreate(src, data, resp_func) {
    if (this.exists()) {
      return resp_func('Account already exists');
    }
    if (!data.password) {
      return resp_func('Missing password');
    }
    if (this.require_email && !email_regex.test(data.email)) {
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
    private_data.password = data.password;
    private_data.email = data.email;
    private_data.creation_ip = data.ip;
    private_data.creation_time = Date.now();
    private_data.login_ip = data.ip;
    private_data.login_ua = data.ua;
    private_data.login_time = Date.now();
    this.setChannelData('private', private_data);
    this.setChannelData('public', public_data);
    metrics.add('user.create', 1);
    return resp_func(null, this.getChannelData('public'));
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
  handleClientDisconnect(src) {
    if (this.rich_presence && this.presence_data[src.channel_id]) {
      delete this.presence_data[src.channel_id];
      this.updatePresence();
    }
    if (this.my_clients[src.channel_id]) {
      delete this.my_clients[src.channel_id];
    }
  }
  handlePresenceSet(src, pak, resp_func) {
    let active = pak.readInt();
    let state = pak.readAnsiString(); // app-defined state
    let payload = pak.readJSON();
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
        payload
      };
    }
    this.updatePresence();
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
    if (!this.exists()) {
      return void resp_func('ERR_INVALID_USER');
    }
    if (!src.sysadmin) {
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
      for (let channel_id in this.my_clients) {
        to_use = channel_id;
        if (channel_id !== src.channel_id) {
          break;
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

class ChannelServerWorker extends ChannelWorker {
}
// Returns a function that forwards to a method of the same name on the ChannelServer
function channelServerBroadcast(name) {
  return (ChannelServerWorker.prototype[name] = function (src, data, resp_func) {
    assert(!resp_func.expecting_response); // this is a broadcast
    this.channel_server[name](data);
  });
}
function channelServerHandler(name) {
  return (ChannelServerWorker.prototype[name] = function (src, data, resp_func) {
    this.channel_server[name](data, resp_func);
  });
}

ChannelServerWorker.prototype.no_datastore = true; // No datastore instances created here as no persistence is needed

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
  },
  client_handlers: {
    friend_auto_update: DefaultUserWorker.prototype.handleFriendAutoUpdate,
    friend_list: DefaultUserWorker.prototype.handleFriendList,
    presence_set: DefaultUserWorker.prototype.handlePresenceSet,
    csr_admin_to_user: DefaultUserWorker.prototype.handleCSRAdminToUser,
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
  channel_server.registerChannelWorker('user', user_worker, user_worker_init_data);
  channel_server.registerChannelWorker('channel_server', ChannelServerWorker, {
    autocreate: false,
    subid_regex: /^[a-zA-Z0-9-]+$/,
    handlers: {
      worker_create: channelServerHandler('handleWorkerCreate'),
      master_startup: channelServerBroadcast('handleMasterStartup'),
      master_stats: channelServerBroadcast('handleMasterStats'),
      restarting: channelServerBroadcast('handleRestarting'),
      chat_broadcast: channelServerBroadcast('handleChatBroadcast'),
      ping: channelServerBroadcast('handlePing'),
      eat_cpu: channelServerHandler('handleEatCPU'),
    },
  });
  master_worker.init(channel_server);
}
