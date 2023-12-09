// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export const FADE_DEFAULT = 0;
export const FADE_OUT = 1;
export const FADE_IN = 2;
export const FADE = FADE_OUT + FADE_IN;

import assert from 'assert';
import { ErrorCallback } from 'glov/common/types';
import { callEach, defaults, ridx } from 'glov/common/util';
import { is_firefox, is_itch_app } from './browser';
import { cmd_parse } from './cmds';
import { onEnterBackground, onExitBackground } from './engine';
import { filewatchOn } from './filewatch';
import { textureCname } from './textures';
import * as urlhash from './urlhash';

const { Howl, Howler } = require('@jimbly/howler/src/howler.core.js');
// TODO: Replace with "import * as settings" and replace settings.x with settings.get('x')
const settings = require('./settings');
const { abs, floor, max, min, random } = Math;

const DEFAULT_FADE_RATE = 0.001;

interface SoundLoadOpts {
  streaming?: boolean;
  for_reload?: boolean;
  loop?: boolean;
}

// Workaround to have interface to Howl object available (alongside glov_load_opts).
interface HowlSound {
  glov_load_opts: SoundLoadOpts;
  play(sprite?: string | number, volume?: number): number;
  stop(id?: number): HowlSound;
  volume(vol?: number, id?: number): void;
  seek(seek?: number, id?: number): HowlSound | number;
  playing(id?: number): boolean;
  duration(id?: number): number;
}

// Sound wrapper returned by soundPlay to external code
export interface GlovSoundSetUp {
  name: string;
  stop(id: number): HowlSound;
  volume(vol: number): void;
  playing(id?: number): boolean;
  duration(id?: number): number;
  location(): number;
  fade(target_volume: number, time: number): void;
}

// Placeholder to track reference to sound whenever it's played
export interface GlovSoundStreamedPlaceholder {
  name: string;
  is_placeholder: true;
}

export type GlovSound = GlovSoundSetUp | GlovSoundStreamedPlaceholder;

export function isPlaceholderSound(sound: GlovSound): sound is GlovSoundStreamedPlaceholder {
  return (sound as GlovSoundStreamedPlaceholder).is_placeholder;
}

interface GlovMusic {
  sound: HowlSound | null;
  id: number;
  current_volume: number;
  target_volume: number;
  sys_volume: number;
  need_play: boolean;
}

interface Fade {
  sound: GlovSoundSetUp;
  target_volume: number;
  id: number;
  time: number;
  volume: number;
  settingsVolume(): number;
}

let sounds : Record<string, HowlSound> = {};
let active_sfx_as_music: {
  sound: GlovSoundSetUp;
  play_volume: number;
  set_volume_when_played: number;
}[] = [];
let num_loading = 0;

// Howler.usingWebAudio = false; // Disable WebAudio for testing HTML5 fallbacks

export type SoundSystemParams = {
  ext_list: string[];
  fade_rate: number;
  fade_music_in_bg: boolean;
};
const default_params: SoundSystemParams = {
  // Note: as of Firefox v71 (2019), all major browsers support MP3
  // ext_list: ['mp3', 'wav'], // (recommended) try loading .mp3 versions first, then fallback to .wav
  //  also covers all browsers: ['webm', 'mp3']
  ext_list: ['ogg', 'mp3'], // (recommended) autosound build task => ogg and mp3 from wav, load ogg first (smaller)
  fade_rate: DEFAULT_FADE_RATE,
  fade_music_in_bg: true,
};
let sound_params: SoundSystemParams;

let last_played : Record<string, number> = {};
let frame_timestamp = 0;
let fades : Fade[] = [];
let music : GlovMusic[];

export function fadesCount(): number {
  return fades.length;
}

let volume_override = 1;
let volume_override_target = 1;
let volume_music_override = 1;
let volume_music_override_target = 1;

settings.register({
  volume: {
    default_value: 1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,1],
  },
});

settings.register({
  volume_music: {
    default_value: 1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,1],
  },
});

settings.register({
  volume_sound: {
    default_value: 1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,1],
  },
});

function musicVolume(): number {
  return settings.volume * settings.volume_music;
}

function soundVolume(): number {
  return settings.volume * settings.volume_sound;
}

let sounds_loading : Record<string, ErrorCallback<never, string>[]> = {};
let on_load_fail: (base: string) => void;
export function soundOnLoadFail(cb: (base: string) => void): void {
  on_load_fail = cb;
}

export type SoundID = string | { file: string; volume: number };

export function soundFindForReplacement(filename: string): string | null {
  if (sounds[filename]) {
    return filename;
  }
  for (let key in sounds) {
    if (textureCname(key) === filename) {
      return key;
    }
  }
  return null;
}

export function soundReplaceFromDataURL(key: string, dataurl: string): void {
  let existing = sounds[key];
  assert(existing);
  let opts = existing.glov_load_opts;
  const { loop } = opts;
  let sound = new Howl({
    src: dataurl,
    html5: false,
    loop: Boolean(loop),
    volume: 0,
    onload: function () {
      sound.glov_load_opts = opts;
      sounds[key] = sound;
    },
    onloaderror: function (id: unknown, err: string, extra: unknown) {
      console.error(`Error loading sound ${key}: ${err}`);
    },
  });
}

export function soundLoad(soundid: SoundID | SoundID[], opts?: SoundLoadOpts, cb?: ErrorCallback<never, string>): void {
  opts = opts || {};
  if (opts.streaming && (is_firefox || is_itch_app)) {
    // TODO: Figure out workaround and fix!
    //   On slow connections, sounds set to streaming sometimes never load on Firefox,
    //   possibly related to preload options or something ('preload=meta' not guaranteed to fire 'canplay')
    // Additionally, HTML5 audio simply fails from within the Itch.io app
    opts.streaming = false;
  }
  const { streaming, loop } = opts;
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
  function tryLoad(idx: number): void {
    if (idx === srcs.length) {
      console.error(`Error loading sound ${soundname}: All fallbacks exhausted, giving up`);
      if (on_load_fail) {
        on_load_fail(soundname);
      }
      callEach(cbs, delete sounds_loading[key], 'Error loading sound');
      return;
    }
    if (!streaming) {
      ++num_loading;
    }
    let once = false;
    let sound = new Howl({
      src: srcs.slice(idx),
      html5: Boolean(streaming),
      loop: Boolean(loop),
      volume: 0,
      onload: function () {
        if (!once) {
          if (!streaming) {
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
          if (!streaming) {
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

function soundReload(filename: string): void {
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
  soundTick(0); // eslint-disable-line @typescript-eslint/no-use-before-define
}

export function soundResume(): void {
  volume_override_target = 1;

  // Actual context resuming handled internally by Howler, except for gamepad
  //   which calls soundResume, so let's poke howler to unlock.
  Howler.manualUnlock();
}

export function soundMusicPause(): void {
  volume_music_override_target = 0;
}

let skip_one_music_blend = false;
export function soundMusicResume(): void {
  volume_music_override_target = 1;
  // Also, skip the blend on the very first frame, dt will be exceptionally large if returning from the background
  skip_one_music_blend = true;
}

function soundFadeMusicInBackground(): void {
  let music_tick_timer: ReturnType<typeof setTimeout> | null = null;
  let last_time: number;
  function musicForceTick(): void {
    let now = Date.now();
    soundTick(now - last_time); // eslint-disable-line @typescript-eslint/no-use-before-define
    last_time = now;
    music_tick_timer = setTimeout(musicForceTick, 100);
  }
  onEnterBackground(() => {
    soundMusicPause();
    last_time = Date.now();
    if (!music_tick_timer) {
      music_tick_timer = setTimeout(musicForceTick, 100);
    }
  });
  onExitBackground(() => {
    soundMusicResume();
    if (music_tick_timer) {
      clearTimeout(music_tick_timer);
      music_tick_timer = null;
    }
  });
}

export function soundStartup(params: Partial<SoundSystemParams>): void {
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

  if (sound_params.fade_music_in_bg) {
    soundFadeMusicInBackground();
  }
}

export function soundResumed(): boolean {
  return !Howler.noAudio && Howler.safeToPlay;
}

function blendOverride(dt: number, override: number, target: number): number {
  let delta = dt * 0.001;
  if (override < target) {
    override = min(override + delta, target);
  } else {
    override = max(override - delta, target);
  }
  return override;
}

export function soundTick(dt: number): void {
  frame_timestamp += dt;
  if (volume_override !== volume_override_target) {
    volume_override = blendOverride(dt, volume_override, volume_override_target);
  }
  if (volume_music_override !== volume_music_override_target) {
    if (skip_one_music_blend) {
      skip_one_music_blend = false;
    } else {
      volume_music_override = blendOverride(dt, volume_music_override, volume_music_override_target);
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
    let target = (settings.volume * settings.volume_music === 0) ? 0 : mus.target_volume;
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
      let sys_volume = mus.current_volume * musicVolume() * volume_override * volume_music_override;
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
    let delta = fade.target_volume - fade.volume;
    let fade_amt = min(abs(delta), fade.time ? dt / fade.time : max_fade);
    if (delta < 0) {
      fade.volume = max(fade.target_volume, fade.volume - fade_amt);
    } else {
      fade.volume = min(fade.target_volume, fade.volume + fade_amt);
    }
    fade.sound.volume(fade.volume);
    if (fade.volume === fade.target_volume) {
      ridx(fades, ii);
      if (!fade.volume) {
        fade.sound.stop(fade.id);
      }
    }
  }
}

export function soundPlay(soundid: SoundID, volume?: number, as_music?: boolean): GlovSoundSetUp | null {
  volume = volume || 1;
  if (settings.volume * (as_music ? settings.volume_music : settings.volume_sound) === 0) {
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
    name: soundid,
    volume_current: volume,
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
      played_sound.volume_current = vol;
      sound.volume(vol * settingsVolume() * volume_override, id);
    },
    fade: (target_volume: number, time: number) => {
      let new_fade = {
        sound: played_sound,
        volume: played_sound.volume_current,
        target_volume,
        id,
        time,
        settingsVolume,
      };
      for (let ii = 0; ii < fades.length; ++ii) {
        if (fades[ii].id === id) {
          fades[ii] = new_fade;
          return;
        }
      }
      fades.push(new_fade);
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

export function soundPlayStreaming(
  soundname: string, volume: number, as_music: boolean, on_played_sound: (sound: GlovSoundSetUp | null) => void
): GlovSound | null {
  if (settings.volume * (as_music ? settings.volume_music : settings.volume_sound) === 0) {
    return null;
  }
  if (Array.isArray(soundname)) {
    soundname = soundname[floor(random() * soundname.length)];
  }
  let played_sound: GlovSound | null = { name: soundname, is_placeholder: true };
  soundLoad(soundname, { streaming: true, loop: false }, (err) => {
    if (!err) {
      played_sound = soundPlay(soundname, volume, as_music);
      if (on_played_sound) {
        on_played_sound(played_sound);
      }
    }
  });
  return played_sound;
}

export function soundPlayMusic(soundname: string, volume: number, transition: number): void {
  if (settings.volume * settings.volume_music === 0) {
    return;
  }
  if (volume === undefined) {
    volume = 1;
  }
  transition = transition || FADE_DEFAULT;
  soundLoad(soundname, { streaming: true, loop: true }, (err) => {
    let sound = null;
    if (err) {
      // Likely case: MP3 not supported, no WAV fallback
    } else {
      sound = sounds[soundname];
      assert(sound);
      if (music[0].sound === sound) {
        // Same sound, just adjust volume, if required
        music[0].target_volume = volume;
        if (!transition) {
          if (!volume) {
            sound.stop(music[0].id);
            music[0].sound = null;
          } else {
            let sys_volume = music[0].sys_volume = volume * musicVolume() * volume_override * volume_music_override;
            sound.volume(sys_volume, music[0].id);
            if (!sound.playing()) {
              sound.play(undefined, sys_volume);
            }
          }
        }
        return;
      }
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
    if (sound) {
      music[0].target_volume = volume;
      let start_vol = (transition & FADE_IN) ? 0 : volume;
      music[0].current_volume = start_vol;
      if (soundResumed()) {
        let sys_volume = start_vol * musicVolume() * volume_override * volume_music_override;
        music[0].id = sound.play(undefined, sys_volume);
        // sound.volume(sys_volume, music[0].id);
        music[0].sys_volume = sys_volume;
        music[0].need_play = false;
      } else {
        music[0].need_play = true;
      }
    } else {
      music[0].target_volume = music[0].current_volume = 0;
    }
  });
}

export function soundLoading(): number {
  return num_loading;
}
