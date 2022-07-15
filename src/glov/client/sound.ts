// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export const FADE_DEFAULT = 0;
export const FADE_OUT = 1;
export const FADE_IN = 2;
export const FADE = FADE_OUT + FADE_IN;

import assert from 'assert';
import { ErrorCallback } from 'glov/common/types';
import { callEach, defaults, ridx } from 'glov/common/util';
import { is_firefox } from './browser';
import { cmd_parse } from './cmds';
import { fbInstantOnPause } from './fbinstant';
import { filewatchOn } from './filewatch';
import * as urlhash from './urlhash';

const { Howl, Howler } = require('@jimbly/howler/src/howler.core.js');
// TODO: Replace with "import * as settings" and replace settings.x with settings.get('x')
const settings = require('./settings');
const { abs, floor, max, min, random } = Math;

const DEFAULT_FADE_RATE = 0.001;

interface SoundLoadOpts {
  streaming?: boolean,
  for_reload?: boolean,
  loop?: boolean,
}

// Workaround to have interface to Howl object available (alongside glov_load_opts).
interface HowlSound {
  glov_load_opts: SoundLoadOpts,
  play: (sprite?: string | number, volume?: number) => number,
  stop: (id?: number) => HowlSound,
  volume: (vol?: number, id?: number) => void,
  seek: (seek?: number, id?: number) => HowlSound | number,
  playing: (id?: number) => boolean,
  duration: (id?: number) => number,
}

interface GlovSound { // Sound wrapper returned by soundPlay to external code
  stop: (id: number) => HowlSound;
  volume: (vol: number) => void;
  playing: (id?: number) => boolean;
  duration: (id: number) => number;
  location: () => number;
  fadeOut: (time: number) => void;
}

interface GlovMusic {
  sound: HowlSound | null,
  id: number,
  current_volume: number,
  target_volume: number,
  sys_volume: number,
  need_play: boolean,
}

interface Fade {
  sound: HowlSound,
  id: number,
  time: number,
  volume: number,
  settingsVolume: () => number,
}

let sounds : Record<string, HowlSound> = {};
let active_sfx_as_music: {
  sound: GlovSound,
  play_volume: number,
  set_volume_when_played: number,
}[] = [];
let num_loading = 0;

// Howler.usingWebAudio = false; // Disable WebAudio for testing HTML5 fallbacks

const default_params = {
  // Note: as of Firefox v71 (2019), all major browsers support MP3
  ext_list: ['mp3', 'wav'], // (recommended) try loading .mp3 versions first, then fallback to .wav
  //  also covers all browsers: ['webm', 'mp3']
  fade_rate: DEFAULT_FADE_RATE,
};
let sound_params: {
  ext_list: string[],
  fade_rate: number,
};

let last_played : Record<string, number> = {};
let frame_timestamp = 0;
let fades : Fade[] = [];
let music : GlovMusic[];

let volume_override = 1;
let volume_override_target = 1;

settings.register({
  volume: {
    default_value: 1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,1],
  },
});

settings.register({
  volume_music: {
    default_value: 0.3,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,1],
  },
});

settings.register({
  volume_sound: {
    default_value: 0.5,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,1],
  },
});

settings.register({
  sound: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
});

settings.register({
  music: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
});

function musicVolume() {
  return settings.volume * settings.volume_music;
}

function soundVolume() {
  return settings.volume * settings.volume_sound;
}

let sounds_loading : Record<string, ErrorCallback<never, string>[]> = {};
let on_load_fail: (base: string) => void;
export function soundOnLoadFail(cb: (base: string) => void): void {
  on_load_fail = cb;
}

type SoundID = string | { file: string, volume: number };

export function soundLoad(soundid: SoundID | SoundID[], opts: SoundLoadOpts, cb?: ErrorCallback<never, string>): void {
  opts = opts || {};
  if (opts.streaming && is_firefox) {
    // TODO: Figure out workaround and fix!
    //   On slow connections, sounds set to streaming sometimes never load on Firefox,
    //   possibly related to preload options or something ('preload=meta' not guaranteed to fire 'canplay')
    opts.streaming = false;
  }
  if (Array.isArray(soundid)) {
    assert(!cb);
    for (let ii = 0; ii < soundid.length; ++ii) {
      soundLoad(soundid[ii], opts);
    }
    return;
  }
  let key = typeof soundid === 'string' ? soundid : soundid.file;
  if (sounds[key]) {
    if (cb) {
      cb();
    }
    return;
  }
  if (sounds_loading[key]) {
    if (cb) {
      sounds_loading[key].push(cb);
    }
    return;
  }
  let cbs : ErrorCallback<never, string>[] = [];
  if (cb) {
    cbs.push(cb);
  }
  sounds_loading[key] = cbs;
  let soundname = key;
  let m = soundname.match(/^(.*)\.(mp3|ogg|wav|webm)$/u);
  let preferred_ext;
  if (m) {
    soundname = m[1];
    preferred_ext = m[2];
  }
  let src = `sounds/${soundname}`;
  let srcs : string[] = [];
  let suffix = '';
  if (opts.for_reload) {
    suffix = `?rl=${Date.now()}`;
  }
  if (preferred_ext) {
    srcs.push(`${urlhash.getURLBase()}${src}.${preferred_ext}${suffix}`);
  }
  for (let ii = 0; ii < sound_params.ext_list.length; ++ii) {
    let ext = sound_params.ext_list[ii];
    if (ext !== preferred_ext) {
      srcs.push(`${urlhash.getURLBase()}${src}.${ext}${suffix}`);
    }
  }
  // Try loading desired sound types one at a time.
  // Cannot rely on Howler's built-in support for this because it only continues
  //   through the list on *some* load errors, not all :(.
  function tryLoad(idx: number) {
    if (idx === srcs.length) {
      console.error(`Error loading sound ${soundname}: All fallbacks exhausted, giving up`);
      if (on_load_fail) {
        on_load_fail(soundname);
      }
      callEach(cbs, delete sounds_loading[key], 'Error loading sound');
      return;
    }
    if (!opts.streaming) {
      ++num_loading;
    }
    let once = false;
    let sound = new Howl({
      src: srcs.slice(idx),
      html5: Boolean(opts.streaming),
      loop: Boolean(opts.loop),
      volume: 0,
      onload: function () {
        if (!once) {
          if (!opts.streaming) {
            --num_loading;
          }
          once = true;
          sound.glov_load_opts = opts;
          sounds[key] = sound;
          callEach(cbs, delete sounds_loading[key], null);
        }
      },
      onloaderror: function (id: unknown, err: string, extra: unknown) {
        if (idx === srcs.length - 1) {
          console.error(`Error loading sound ${srcs[idx]}: ${err}`);
        } else {
          console.log(`Error loading sound ${srcs[idx]}: ${err}, trying fallback...`);
        }
        if (!once) {
          if (!opts.streaming) {
            --num_loading;
          }
          once = true;
          tryLoad(idx + 1);
        }
      },
    });
  }
  tryLoad(0);
}

function soundReload(filename: string) {
  let name_match = filename.match(/^sounds\/([^.]+)\.\w+$/);
  let sound_name = name_match && name_match[1];
  if (!sound_name) {
    return;
  }
  if (!sounds[sound_name]) {
    console.log(`Reload trigged for non-existent sound: ${filename}`);
    return;
  }
  let opts = sounds[sound_name].glov_load_opts;
  opts.for_reload = true;
  delete sounds[sound_name];
  soundLoad(sound_name, opts);
}

export function soundPause(): void {
  volume_override = volume_override_target = 0;
  // Immediately mute all the music
  // Can't do a nice fade out here because we stop getting ticked when we're not in the foreground
  soundTick(0); // eslint-disable-line no-use-before-define
}

export function soundResume(): void {
  volume_override_target = 1;

  // Actual context resuming handled internally by Howler, except for gamepad
  //   which calls soundResume, so let's poke howler to unlock.
  Howler.manualUnlock();
}

export function soundStartup(params: { ext_list?: string[], fade_rate?: number }): void {
  sound_params = defaults(params || {}, default_params);

  // Music
  music = []; // 0 is current, 1 is previous (fading out)
  for (let ii = 0; ii < 2; ++ii) {
    music.push({
      sound: null,
      id: 0,
      current_volume: 0,
      target_volume: 0,
      sys_volume: 0,
      need_play: false,
    });
  }
  filewatchOn('.mp3', soundReload);
  filewatchOn('.ogg', soundReload);
  filewatchOn('.wav', soundReload);
  filewatchOn('.webm', soundReload);

  fbInstantOnPause(soundPause);
}

export function soundResumed(): boolean {
  return !Howler.noAudio && Howler.safeToPlay;
}

export function soundTick(dt: number): void {
  frame_timestamp += dt;
  if (volume_override !== volume_override_target) {
    let delta = dt * 0.004;
    if (volume_override < volume_override_target) {
      volume_override = min(volume_override + delta, volume_override_target);
    } else {
      volume_override = max(volume_override - delta, volume_override_target);
    }
  }
  if (!soundResumed()) {
    return;
  }
  for (let i = 0; i < active_sfx_as_music.length; ++i) {
    let { sound, play_volume, set_volume_when_played } = active_sfx_as_music[i];
    if (!sound.playing()) {
      ridx(active_sfx_as_music, i);
    } else if (set_volume_when_played !== musicVolume()) {
      sound.volume(play_volume);
      active_sfx_as_music[i].set_volume_when_played = musicVolume();
    }
  }
  // Do music fading
  // Cannot rely on Howler's fading because starting a fade when one is in progress
  //   messes things up, as well causes snaps in volume :(
  let max_fade = dt * sound_params.fade_rate;
  for (let ii = 0; ii < music.length; ++ii) {
    let mus = music[ii];
    if (!mus.sound) {
      continue;
    }
    let target = settings.music ? mus.target_volume : 0;
    if (mus.current_volume !== target) {
      let delta = target - mus.current_volume;
      let fade_amt = min(abs(delta), max_fade);
      if (delta < 0) {
        mus.current_volume = max(target, mus.current_volume - fade_amt);
      } else {
        mus.current_volume = min(target, mus.current_volume + fade_amt);
      }
      if (!mus.target_volume && !mus.current_volume) {
        if (!mus.need_play) {
          mus.sound.stop(mus.id);
        }
        mus.sound = null;
      }
    }
    if (mus.sound) {
      let sys_volume = mus.current_volume * musicVolume() * volume_override;
      if (mus.need_play) {
        mus.need_play= false;
        mus.id = mus.sound.play();
        mus.sys_volume = -1;
      }
      if (mus.sys_volume !== sys_volume) {
        mus.sound.volume(sys_volume, mus.id);
        mus.sys_volume = sys_volume;
      }
    }
  }

  for (let ii = fades.length - 1; ii >= 0; --ii) {
    let fade = fades[ii];
    let fade_amt = fade.time ? dt / fade.time : max_fade;
    fade.volume = max(0, fade.volume - fade_amt);
    fade.sound.volume(fade.volume * fade.settingsVolume() * volume_override, fade.id);
    if (!fade.volume) {
      fade.sound.stop(fade.id);
      ridx(fades, ii);
    }
  }
}

export function soundPlay(soundid: SoundID, volume: number, as_music?: boolean): GlovSound | null {
  volume = volume || 1;
  if (!as_music && !settings.sound || as_music && !settings.music) {
    return null;
  }
  if (!soundResumed()) {
    return null;
  }
  if (Array.isArray(soundid)) {
    soundid = soundid[floor(random() * soundid.length)];
  }
  if (typeof soundid === 'object') {
    volume *= (soundid.volume || 1);
    soundid = soundid.file;
  }
  let sound = sounds[soundid];
  if (!sound) {
    return null;
  }
  let last_played_time = last_played[soundid] || -9e9;
  if (frame_timestamp - last_played_time < 45) {
    return null;
  }
  let settingsVolume = as_music ? musicVolume : soundVolume;
  let id = sound.play(undefined, volume * settingsVolume() * volume_override);
  // sound.volume(volume * settingsVolume() * volume_override, id);
  last_played[soundid] = frame_timestamp;
  let played_sound = {
    stop: sound.stop.bind(sound, id),
    playing: sound.playing.bind(sound, id), // not reliable if it hasn't started yet? :(
    location: () => { // get current location
      let v = sound.seek(id);
      if (typeof v !== 'number') {
        // Howler sometimes returns `self` from `seek()`
        return 0;
      }
      return v;
    },
    duration: sound.duration.bind(sound, id),
    volume: (vol: number) => {
      sound.volume(vol * settingsVolume() * volume_override, id);
    },
    fadeOut: (time: number) => {
      fades.push({
        volume,
        sound,
        id,
        time,
        settingsVolume,
      });
    },
  };
  if (as_music) {
    active_sfx_as_music.push({
      sound: played_sound,
      play_volume: volume,
      set_volume_when_played: musicVolume(),
    });
  }
  return played_sound;
}

export function soundPlayStreaming(soundname: string, volume: number): void {
  if (!settings.sound) {
    return;
  }
  if (Array.isArray(soundname)) {
    soundname = soundname[floor(random() * soundname.length)];
  }
  soundLoad(soundname, { streaming: true, loop: false }, (err) => {
    if (!err) {
      soundPlay(soundname, volume);
    }
  });
}

export function soundPlayMusic(soundname: string, volume: number, transition: number): void {
  if (!settings.music) {
    return;
  }
  if (volume === undefined) {
    volume = 1;
  }
  transition = transition || FADE_DEFAULT;
  soundLoad(soundname, { streaming: true, loop: true }, (err) => {
    assert(!err);
    let sound = sounds[soundname];
    assert(sound);
    if (music[0].sound === sound) {
      // Same sound, just adjust volume, if required
      music[0].target_volume = volume;
      if (!transition) {
        if (!volume) {
          sound.stop(music[0].id);
          music[0].sound = null;
        } else {
          let sys_volume = music[0].sys_volume = volume * musicVolume() * volume_override;
          sound.volume(sys_volume, music[0].id);
          if (!sound.playing()) {
            sound.play(undefined, sys_volume);
          }
        }
      }
      return;
    }
    // fade out previous music, if any
    if (music[0].current_volume) {
      if (transition & FADE_OUT) {
        // swap to position 1, start fadeout
        let temp = music[1];
        music[1] = music[0];
        music[0] = temp;
        music[1].target_volume = 0;
      }
    }
    if (music[0].sound) {
      music[0].sound.stop(music[0].id);
    }
    music[0].sound = sound;
    music[0].target_volume = volume;
    let start_vol = (transition & FADE_IN) ? 0 : volume;
    music[0].current_volume = start_vol;
    if (soundResumed()) {
      let sys_volume = start_vol * musicVolume() * volume_override;
      music[0].id = sound.play(undefined, sys_volume);
      // sound.volume(sys_volume, music[0].id);
      music[0].sys_volume = sys_volume;
      music[0].need_play = false;
    } else {
      music[0].need_play = true;
    }
  });
}

export function soundLoading(): number {
  return num_loading;
}
