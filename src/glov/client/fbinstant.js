/* globals FBInstant */
/* eslint-disable import/order */
const { registerExternalUserInfoProvider } = require('./social.js');
const urlhash = require('./urlhash.js');
const local_storage = require('./local_storage.js');
const { ID_PROVIDER_FB_INSTANT } = require('glov/common/enums.js');
const { errorReportSetDynamicDetails } = require('glov/client/error_report.js');
const { callEach, eatPossiblePromise } = require('glov/common/util.js');

let onreadycallbacks = [];
export function onready(callback) {
  if (!onreadycallbacks) {
    return void callback();
  }
  onreadycallbacks.push(callback);
}

export function fbInstantIsReady() {
  return onreadycallbacks === null;
}

let fb_log = [];
function fbInstantLogEvent(event) {
  FBInstant.logEvent(event);
  fb_log.push(event);
  if (fb_log.length > 10) {
    fb_log.splice(0, 1);
  }
}

let hasSubscribedAlready = false;
function initSubscribe(callback, skipShortcut) {

  skipShortcut = skipShortcut||false;

  function handleSubscribeToBotComplete() {
    if (callback) {
      //Prevents the handleSubscribeToBotComplete promise from eating unfreeze event errors
      setTimeout(callback,1);
    }
  }

  function handleSubscribeToBotFailure(e) {
    if (e && e.code !== 'USER_INPUT') {
      console.error('handleSubscribeToBotFailure', e);
    }
    fbInstantLogEvent('bot_subscribe_failure');
    handleSubscribeToBotComplete();
  }

  function subscribeToBot() {
    console.warn('Window social trying to bot subscribe');
    if (FBInstant.getSupportedAPIs().indexOf('player.canSubscribeBotAsync') !== -1) {
      FBInstant.player.canSubscribeBotAsync().then(function (canSubscribe) {
        if (canSubscribe) {
          fbInstantLogEvent('bot_subscribe_show');
          FBInstant.player.subscribeBotAsync().then(function () {
            fbInstantLogEvent('bot_subscribe_success');
            handleSubscribeToBotComplete();
          },handleSubscribeToBotFailure).catch(handleSubscribeToBotFailure);
        } else {
          handleSubscribeToBotComplete();
        }
      }).catch(handleSubscribeToBotFailure);
    } else {
      handleSubscribeToBotComplete();
    }
  }

  function handleHomescreenComplete() {
    subscribeToBot();
  }

  function handleCreateShortcutFailure(e) {
    console.error('handleCreateShortcutFailure', e);
    fbInstantLogEvent('homescreen_install_failure');
    handleHomescreenComplete();
  }

  let hasAddedToHomescreen = local_storage.get('instant.hasInstalledShortcut.v2');
  function createShortcut() {
    console.warn('Window social trying to create shortcut');
    if (FBInstant.getSupportedAPIs().indexOf('canCreateShortcutAsync') !== -1 &&
      !hasAddedToHomescreen &&
      !hasSubscribedAlready
    ) {
      hasSubscribedAlready = true;
      FBInstant.canCreateShortcutAsync().then(function (canCreateShortcut) {
        if (canCreateShortcut) {
          fbInstantLogEvent('homescreen_install_show');
          FBInstant.createShortcutAsync().then(function () {
            local_storage.set('instant.hasInstalledShortcut.v2',true);
            fbInstantLogEvent('homescreen_install_success');
            handleHomescreenComplete();
          },function () {
            fbInstantLogEvent('homescreen_install_useraborted');
            handleHomescreenComplete();
          }).catch(handleCreateShortcutFailure);
        } else {
          handleHomescreenComplete();
        }
      }).catch(handleCreateShortcutFailure);
    } else {
      handleHomescreenComplete();
    }
  }

  if (skipShortcut) {
    subscribeToBot();
  } else {
    createShortcut();
  }
}

let on_pause = [];
export function fbInstantOnPause(cb) {
  on_pause.push(cb);
}

let can_follow_official_page = false;
let can_join_official_group = false;
let can_get_live_streams_overlay = false;

export function fbGetLoginInfo(cb) {
  onready(() => {
    window.FBInstant.player.getSignedPlayerInfoAsync().then((result) => {
      if (cb) {
        cb(null, {
          signature: result.getSignature(),
          display_name: window.FBInstant.player.getName(),
        });
        cb = null;
      }
    }).catch((err) => {
      if (cb) {
        cb(err);
        cb = null;
      }
    });
  });
}

/// Maps a player to an ExternalUserInfo
function mapPlayerToExternalUserInfo(player) {
  return { external_id: player.getID(), name: player.getName(), profile_picture_url: player.getPhoto() };
}

/// Returns an ExternalUserInfo
function fbInstantGetPlayer(cb) {
  onready(() => {
    let player = window.FBInstant.player;
    cb(null, player ? mapPlayerToExternalUserInfo(player) : undefined);
  });
}

/// cb receives an error if any occurs and an array of ExternalUserInfo objects
function fbInstantGetFriends(cb) {
  onready(() => {
    window.FBInstant.player.getConnectedPlayersAsync().then((players) => {
      if (cb) {
        let local_cb = cb;
        cb = null;
        local_cb(null, players?.map(mapPlayerToExternalUserInfo));
      }
    }).catch((err) => {
      if (cb) {
        let local_cb = cb;
        cb = null;
        local_cb(err);
      }
    });
  });
}

export function fbGetAppScopedUserId(cb) {
  onready(() => {
    window.FBInstant.player.getASIDAsync().then((asid) => {
      if (cb) {
        cb(null, asid);
        cb = null;
      }
    }).catch((err) => {
      if (cb) {
        cb(err);
        cb = null;
      }
    });
  });
}

export function canFollowOfficialPage() {
  return window.FBInstant && can_follow_official_page;
}

export function canJoinOfficialGroup() {
  return window.FBInstant && can_join_official_group;
}

export function canShowLiveStreamOverlay() {
  return window.FBInstant && can_get_live_streams_overlay;
}

export function fbInstantInit() {
  if (!window.FBInstant) {
    return;
  }

  errorReportSetDynamicDetails('fblog', () => fb_log.join(','));
  registerExternalUserInfoProvider(ID_PROVIDER_FB_INSTANT, fbInstantGetPlayer, fbInstantGetFriends);

  let left = 1;
  let fake_load_interval = setInterval(function () {
    left *= 0.9;
    eatPossiblePromise(FBInstant.setLoadingProgress(100-(left*100)>>0));
  },100);

  FBInstant.initializeAsync().then(function () {
    let entryPointData = FBInstant.getEntryPointData()||{};
    // let entryPointData = { querystring: { w: '4675', wg: '1' } }; // FRVR
    // let entryPointData = { querystring: { blueprint: 'RKWVAE26XS24Z' } }; // FRVR
    let querystring = entryPointData.querystring||{};
    for (let x in querystring) {
      urlhash.set(x, querystring[x]);
    }

    clearInterval(fake_load_interval);
    FBInstant.startGameAsync().then(function () {
      callEach(onreadycallbacks, onreadycallbacks = null);

      console.log('Initializing FBInstant');
      initSubscribe(function () {
        console.log('All done initing FBInstant');

        window.FBInstant.community.canFollowOfficialPageAsync().then(function (state) {
          can_follow_official_page = state;
        }).catch(function (err) {
          console.error(err);
        });

        window.FBInstant.community.canJoinOfficialGroupAsync().then(function (state) {
          can_join_official_group = state;
        }).catch(function (err) {
          console.error(err);
        });

        window.FBInstant.community.canGetLiveStreamsAsync().then(function (state) {
          can_get_live_streams_overlay = state;
        }).catch(function (err) {
          console.error(err);
        });
      });
    });
  }).catch(function (e) {
    console.warn('FBInstant initializeAsync failed', e);
  });

  FBInstant.onPause(() => {
    callEach(on_pause);
  });
}
