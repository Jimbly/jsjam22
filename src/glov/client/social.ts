// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-env browser */

import assert from 'assert';
import { PLATFORM_FBINSTANT } from 'glov/client/client_config';
import {
  ID_PROVIDER_FB_GAMING,
  ID_PROVIDER_FB_INSTANT,
  PRESENCE_ACTIVE,
  PRESENCE_INACTIVE,
  PRESENCE_OFFLINE,
} from 'glov/common/enums';
import { FriendData, FriendStatus, FriendsData } from 'glov/common/friends_data';
import {
  ClientPresenceData,
  ErrorCallback,
  FriendCmdResponse,
  ServerPresenceData,
} from 'glov/common/types';
import { deepEqual } from 'glov/common/util';
import { cmd_parse } from './cmds';
import { ExternalUserInfo } from './external_user_info';
import * as input from './input';
import { netDisconnected, netSubs } from './net';
import * as sprites from './sprites';
import * as textures from './textures';

declare let gl: WebGLRenderingContext | WebGL2RenderingContext;

const IDLE_TIME = 60000;

let friend_list: FriendsData | null = null;

export function friendsGet(): FriendsData {
  return friend_list ?? Object.create(null);
}

export function isFriend(user_id: string): boolean {
  let value = friend_list?.[user_id];
  return value?.status === FriendStatus.Added || value?.status === FriendStatus.AddedAuto;
}

export function friendIsBlocked(user_id: string): boolean {
  let value = friend_list?.[user_id];
  return value?.status === FriendStatus.Blocked;
}

function makeFriendCmdRequest(cmd: string, user_id: string, cb: ErrorCallback<string>): void {
  user_id = user_id.toLowerCase();
  let requesting_user_id = netSubs().loggedIn();
  if (netDisconnected()) {
    return void cb('ERR_DISCONNECTED');
  }
  netSubs().getMyUserChannel().cmdParse(`${cmd} ${user_id}`, function (err: string, resp: FriendCmdResponse) {
    if (err) {
      return void cb(err);
    } else if (requesting_user_id !== netSubs().loggedIn() || !friend_list) {
      // Logged out or switched user meanwhile, so ignore the result
      return void cb('Invalid data');
    }

    if (resp.friend) {
      friend_list[user_id] = resp.friend;
    } else {
      delete friend_list[user_id];
    }
    cb(null, resp.msg);
  });
}

export function friendAdd(user_id: string, cb: ErrorCallback<string>): void {
  makeFriendCmdRequest('friend_add', user_id, cb);
}
export function friendRemove(user_id: string, cb: ErrorCallback<string>): void {
  makeFriendCmdRequest('friend_remove', user_id, cb);
}
export function friendBlock(user_id: string, cb: ErrorCallback<string>): void {
  makeFriendCmdRequest('friend_block', user_id, cb);
}
export function friendUnblock(user_id: string, cb: ErrorCallback<string>): void {
  makeFriendCmdRequest('friend_unblock', user_id, cb);
}

// Pass-through commands
cmd_parse.register({
  cmd: 'friend_add',
  help: 'Add a friend',
  func: friendAdd,
});
cmd_parse.register({
  cmd: 'friend_remove',
  help: 'Remove a friend',
  func: friendRemove,
});
cmd_parse.register({
  cmd: 'friend_block',
  help: 'Block someone from seeing your rich presence, also removes from your friends list',
  func: friendBlock,
});
cmd_parse.register({
  cmd: 'friend_unblock',
  help: 'Reset a user to allow seeing your rich presence again',
  func: friendUnblock,
});
cmd_parse.register({
  cmd: 'friend_list',
  help: 'List all friends',
  func: function (str: string, resp_func: ErrorCallback<string>) {
    if (!friend_list) {
      return void resp_func('Friends list not loaded');
    }
    resp_func(null, Object.keys(friend_list).filter(isFriend).join(',') ||
      'You have no friends');
  },
});
cmd_parse.register({
  cmd: 'friend_block_list',
  help: 'List all blocked users',
  func: function (str: string, resp_func: ErrorCallback<string>) {
    if (!friend_list) {
      return void resp_func('Friends list not loaded');
    }
    resp_func(null, Object.keys(friend_list).filter(friendIsBlocked).join(',') ||
      'You have no blocked users');
  },
});

let invisible = 0;
cmd_parse.registerValue('invisible', {
  type: cmd_parse.TYPE_INT,
  help: 'Hide rich presence information from other users',
  label: 'Invisible',
  range: [0,1],
  get: () => invisible,
  set: (v: number) => (invisible = v),
});

let afk = 0;
cmd_parse.registerValue('afk', {
  type: cmd_parse.TYPE_INT,
  help: 'Appear as idle to other users',
  label: 'AFK',
  range: [0,1],
  get: () => afk,
  set: (v: number) => (afk = v),
});

function onPresence(this: { presence_data?: ServerPresenceData }, data: ServerPresenceData): void {
  let user_channel = this;
  user_channel.presence_data = data;
}

let last_presence: ClientPresenceData | null = null;
let send_queued = false;
function richPresenceSend(): void {
  if (!netSubs().loggedIn() || !last_presence || send_queued) {
    return;
  }
  send_queued = true;
  netSubs().onceConnected(() => {
    send_queued = false;
    if (!netSubs().loggedIn() || !last_presence) {
      return;
    }
    let pak = netSubs().getMyUserChannel().pak('presence_set');
    pak.writeInt(last_presence.active);
    pak.writeAnsiString(last_presence.state);
    pak.writeJSON(last_presence.payload);
    pak.send();
  });
}
export function richPresenceSet(active: number, state: string, payload?: unknown): void {
  active = !active || afk || (Date.now() - input.inputLastTime() > IDLE_TIME) ? PRESENCE_INACTIVE : PRESENCE_ACTIVE;
  if (invisible) {
    active = PRESENCE_OFFLINE;
  }
  payload = payload || null;
  if (!last_presence ||
    active !== last_presence.active || state !== last_presence.state ||
    !deepEqual(last_presence.payload, payload)
  ) {
    last_presence = {
      active,
      state,
      payload,
    };
    richPresenceSend();
  }
}

/// Current user info by provider
let external_current_users: Record<string, ExternalUserInfo> = Object.create(null);
/// Friends info by provider and user id
let external_friends: Record<string, Record<string, ExternalUserInfo>> = Object.create(null);

export function getExternalCurrentUserInfos(): Record<string, ExternalUserInfo> {
  return external_current_users;
}

export function getExternalFriendInfos(user_id: string): Record<string, ExternalUserInfo> | undefined {
  return external_friends[user_id];
}

export function getExternalUserInfos(user_id: string): Record<string, ExternalUserInfo> | undefined {
  if (user_id === netSubs().loggedIn()) {
    return getExternalCurrentUserInfos();
  } else {
    return getExternalFriendInfos(user_id);
  }
}

function setExternalCurrentUser(provider: string, user_info: ExternalUserInfo): void {
  if (user_info) {
    external_current_users[provider] = user_info;
  } else {
    delete external_current_users[provider];
  }
}

function updateExternalFriendsOnServer(provider: string, to_add: ExternalUserInfo[], to_remove: string[]): void {
  if (to_add.length === 0 && to_remove.length === 0 || netDisconnected()) {
    return;
  }

  let requesting_user_id = netSubs().loggedIn();
  let pak = netSubs().getMyUserChannel().pak('friend_auto_update');
  pak.writeAnsiString(provider);
  for (let ii = 0; ii < to_add.length; ++ii) {
    pak.writeAnsiString(to_add[ii].external_id);
  }
  pak.writeAnsiString('');
  for (let ii = 0; ii < to_remove.length; ++ii) {
    pak.writeAnsiString(to_remove[ii]);
  }
  pak.writeAnsiString('');
  pak.send(function (err: string, resp: Record<string, FriendData>) {
    if (requesting_user_id !== netSubs().loggedIn() || !friend_list) {
      // Logged out or switched user meanwhile, so ignore the result
      return;
    } else if (err) {
      // Unable to get external friends
      return;
    } else if (!resp) {
      // Nothing to do
      return;
    }

    // Add all new friends
    let friends_external_to_user_ids: Record<string, string> = Object.create(null);
    for (let user_id in resp) {
      let friend = friend_list[user_id] = resp[user_id];
      if (friend.ids) {
        let external_id = friend.ids[provider];
        friends_external_to_user_ids[external_id] = user_id;
      }
    }

    // Map all the external friends by their corresponding user id
    to_add.forEach((provider_friend) => {
      let external_id = provider_friend.external_id;
      let user_id = friends_external_to_user_ids[external_id];
      if (user_id) {
        let external_friend_infos = external_friends[user_id];
        if (!external_friend_infos) {
          external_friend_infos = external_friends[user_id] = Object.create(null);
        }
        external_friend_infos[provider] = provider_friend;
      }
    });
  });
}

function setExternalFriends(provider: string, provider_friends: ExternalUserInfo[]): void {
  let friends_external_to_user_ids: Record<string, string> = Object.create(null);
  for (let user_id in friend_list) {
    let friend = friend_list[user_id];
    let external_id = friend.ids?.[provider];
    if (external_id) {
      friends_external_to_user_ids[external_id] = user_id;
    }
  }

  // Delete all existing infos for this provider
  for (let user_id in external_friends) {
    delete external_friends[user_id][provider];
  }

  let to_add: ExternalUserInfo[] = [];
  provider_friends.forEach((provider_friend) => {
    let external_id = provider_friend.external_id;
    let user_id = friends_external_to_user_ids[external_id];
    if (user_id) {
      let external_friend_infos = external_friends[user_id];
      if (!external_friend_infos) {
        external_friend_infos = external_friends[user_id] = Object.create(null);
      }
      external_friend_infos[provider] = provider_friend;
      // Delete it, so that in the end the only ones left are the ones that need to be removed
      delete friends_external_to_user_ids[external_id];
    } else {
      // New friend, needs to be added
      to_add.push(provider_friend);
    }
  });

  // The only ones left are the ones that need to be removed
  let to_remove: string[] = [];
  for (let external_id in friends_external_to_user_ids) {
    to_remove.push(external_id);
  }

  if (to_add.length !== 0 || to_remove.length !== 0) {
    updateExternalFriendsOnServer(provider, to_add, to_remove);
  }
}

function requestExternalCurrentUser(provider: string,
  request_func: (cb: ErrorCallback<ExternalUserInfo>) => void): void {
  let requesting_user_id = netSubs().loggedIn();
  request_func((err, user_info) => {
    if (requesting_user_id !== netSubs().loggedIn()) {
      // Logged out or switched user meanwhile, so ignore the result
      return;
    } else if (err || !user_info) {
      // Unable to get external current user
      return;
    }

    setExternalCurrentUser(provider, user_info);
  });
}

function requestExternalFriends(provider: string,
  request_func: (cb: ErrorCallback<ExternalUserInfo[]>) => void): void {
  let requesting_user_id = netSubs().loggedIn();
  request_func((err, friends) => {
    if (requesting_user_id !== netSubs().loggedIn() || !friend_list) {
      // Logged out or switched user meanwhile, so ignore the result
      return;
    } else if (err || !friends) {
      // Unable to get external friends
      return;
    }

    setExternalFriends(provider, friends);
  });
}

let profile_images: Record<string, unknown> = {};
let default_profile_image: unknown = null;
export function getUserProfileImage(user_id: string): unknown {
  let image = profile_images[user_id];
  if (image) {
    return image;
  }

  let url = null;
  if (PLATFORM_FBINSTANT) {
    url = getExternalUserInfos(user_id)?.[ID_PROVIDER_FB_INSTANT]?.profile_picture_url;
  } else {
    url = getExternalUserInfos(user_id)?.[ID_PROVIDER_FB_GAMING]?.profile_picture_url;
  }

  if (url) {
    let tex = textures.load({
      url: url,
      filter_min: gl.LINEAR_MIPMAP_LINEAR,
      filter_mag: gl.LINEAR,
      soft_error: true,
      auto_unload: () => delete profile_images[user_id],
    });
    if (tex && tex.loaded) {
      image = profile_images[user_id] = {
        img: sprites.create({ tex }),
      };
      return image;
    }
  }

  return default_profile_image;
}

export function setDefaultUserProfileImage(image: unknown): void {
  default_profile_image = image;
}

let external_user_info_providers = Object.create(null);
export function registerExternalUserInfoProvider(
  provider: string,
  get_current_user: ((cb: ErrorCallback<ExternalUserInfo>) => void) | null,
  get_friends: ((cb: ErrorCallback<ExternalUserInfo[]>) => void) | null,
): void {
  if (get_current_user || get_friends) {
    assert(!friend_list);
    assert(!netSubs()?.loggedIn());

    external_user_info_providers[provider] = { get_current_user, get_friends };
  } else {
    delete external_user_info_providers[provider];
  }
}

// Init
export function socialInit(): void {
  netSubs().on('login', function () {
    let user_channel = netSubs().getMyUserChannel();
    let user_id = netSubs().loggedIn();
    richPresenceSend();
    friend_list = null;
    if (netDisconnected()) {
      return;
    }
    user_channel.pak('friend_list').send((err: unknown, resp: FriendsData) => {
      if (err || user_id !== netSubs().loggedIn()) {
        // disconnected, etc
        return;
      }
      friend_list = resp;

      // Sync friend list with external providers' friends
      for (const provider in external_user_info_providers) {
        let { get_current_user, get_friends } = external_user_info_providers[provider];
        if (get_current_user) {
          requestExternalCurrentUser(provider, get_current_user);
        }
        if (get_friends) {
          requestExternalFriends(provider, get_friends);
        }
      }
    });
  });
  netSubs().on('logout', function () {
    friend_list = null;
    external_current_users = Object.create(null);
    external_friends = Object.create(null);
  });

  netSubs().onChannelMsg('user', 'presence', onPresence);
}
