import assert from 'assert';
import { ridx } from '../common/util';
import * as engine from './engine.js';
import {
  GlovSound,
  GlovSoundSetUp,
  GlovSoundStreamedPlaceholder,
  isPlaceholderSound,
  soundLoad,
  soundPlay,
  soundPlayStreaming,
  soundResumed,
} from './sound';
import {
  SSDataFile,
  SSDataLayer,
  SSDataTagLayer,
  SSFile,
  SSLayer,
  SSLayerState,
  SSParentLayer,
  SSSoundState,
  SSSoundStateBase,
  SSTagLayer,
  SoundScape,
  dataLayerHasMax,
} from './soundscape_types';

// TODO: Replace with "import * as settings" and replace settings.x with settings.get('x')
const settings = require('./settings');
const { floor, max, min, random } = Math;

export * from './soundscape_types';

class GlovSSFile implements SSFile {
  file: string;
  fade_time: number;
  excl_group: Record<string, boolean>;
  excl_group_first: string;
  excl_group_debug: string;
  tag_id?: string;

  constructor(ss: GlovSoundScape, file: SSDataFile, tag_id?: string) {
    this.file = `${ss.base_path}${file.file}`;
    if (typeof file.excl_group === 'string') {
      file.excl_group = [file.excl_group];
    }
    assert(Array.isArray(file.excl_group));
    this.excl_group_first = file.excl_group[0]; // Used if we are the master
    this.excl_group_debug = file.excl_group.join(',');
    let map : Record<string, boolean> = {};
    for (let ii = 0; ii < file.excl_group.length; ++ii) {
      map[file.excl_group[ii]] = true;
    }
    this.excl_group = map;
    this.fade_time = file.fade_time || ss.default_fade_time;
    if (tag_id) {
      this.tag_id = tag_id;
    }
  }
}

const DEFAULT_PERIOD = 30000;
const DEFAULT_PERIOD_NOISE = 15000;
const DEFAULT_MAX_INTENSITY = Infinity;
const DEFAULT_ADD_DELAY = 5000; // how long to wait between adding another track
const DEFAULT_TAG_TOLERANCE = 5000;

class GlovSSTagLayer implements SSTagLayer {
  excl_group_master?: boolean;
  sync_with?: string;
  odds: number[];
  odds_total: number;
  period: number;
  period_noise: number;
  min_intensity: number;
  max_intensity: number;
  add_delay: number;
  files: SSFile[];
  files_map: Record<string, SSFile>;

  priority: number;

  constructor(ss: GlovSoundScape, layer: SSDataTagLayer, parent: SSLayer, tag_id: string) {
    this.files_map = {};
    this.files = layer.files.map((file) => {
      let new_file = new GlovSSFile(ss, file, tag_id);
      this.files_map[new_file.file] = new_file;
      if (!ss.streaming) {
        soundLoad(file.file, { streaming: true });
      }
      return new_file;
    });
    this.priority = layer.priority;
    this.excl_group_master = parent.excl_group_master;
    this.sync_with = layer.sync_with || parent.sync_with;
    this.odds = layer.odds || parent.odds;
    this.period = layer.period || parent.period || DEFAULT_PERIOD;
    this.period_noise = parent.period_noise || DEFAULT_PERIOD_NOISE;
    this.min_intensity = layer.min_intensity || parent.min_intensity;
    this.max_intensity = layer.max_intensity || parent.max_intensity || DEFAULT_MAX_INTENSITY;
    this.add_delay = layer.add_delay || parent.add_delay || DEFAULT_ADD_DELAY;

    this.odds_total = 0;
    for (let ii = 0; ii < this.odds.length; ++ii) {
      this.odds_total += this.odds[ii];
    }
  }
}

class GlovSSParentLayer implements SSParentLayer {
  excl_group_master?: boolean;
  sync_with?: string;
  odds: number[];
  odds_total: number;
  period: number;
  period_noise: number;
  min_intensity: number;
  max_intensity: number;
  add_delay: number;
  files: SSFile[];
  files_map: Record<string, SSFile>;

  tags: Record<string, GlovSSTagLayer>;
  user_idx: number;

  constructor(ss: GlovSoundScape, layer: SSDataLayer) {
    let { tags } = layer;
    this.files_map = {};
    this.files = layer.files.map((file) => {
      let new_file = new GlovSSFile(ss, file);
      this.files_map[new_file.file] = new_file;
      if (!ss.streaming) {
        soundLoad(file.file, { streaming: true });
      }
      return new_file;
    });
    this.excl_group_master = layer.excl_group_master;
    this.sync_with = layer.sync_with;
    this.min_intensity = layer.min_intensity;

    this.odds_total = 0;
    if (dataLayerHasMax(layer)) {
      this.odds = [0];
      for (let ii = 0; ii < layer.max; ++ii) {
        this.odds.push(1);
      }
    } else {
      this.odds = layer.odds;
    }
    for (let ii = 0; ii < this.odds.length; ++ii) {
      this.odds_total += this.odds[ii];
    }

    this.add_delay = layer.sync_with ? 0 : (layer.add_delay || DEFAULT_ADD_DELAY);
    this.period = layer.period || DEFAULT_PERIOD;
    this.period_noise = layer.period_noise || DEFAULT_PERIOD_NOISE;
    this.max_intensity = layer.max_intensity || DEFAULT_MAX_INTENSITY;
    this.tags = {};
    for (let tag in tags) {
      ss.tags[tag] = false;
      this.tags[tag] = new GlovSSTagLayer(ss, tags[tag], this, tag);
    }
    this.user_idx = ++ss.user_idx;
  }
}

const DEFAULT_ENABLE_LOGS = false;
const DEFAULT_STREAMING = true;
const DEFAULT_KILL_DELAY = 500;
const DEFAULT_ADD_ALL = true;
const MAX_SOUND_DELAY = 1000;
const GLOV_PLAY_VOLUME = 1;
const SILENT_VOLUME = 0.0001;

export class GlovSoundScape implements SoundScape {
  data_layers: Record<string, SSDataLayer>;
  layers: Record<string, GlovSSParentLayer>;
  base_path: string;
  default_fade_time: number;
  enable_logs: boolean;
  streaming: boolean;
  kill_delay: number;

  force_no_tracks = false;
  fade_in_time = 0;
  fade_in_start = 0;
  intensity = 0;
  tags: Record<string, boolean> = {};
  tag_timer: Partial<Record<string, number>> = {};
  tag_tolerance: number;

  streaming_cbs: Record<string, ((sound: GlovSoundSetUp) => void)[]> = {};

  layer_state: Record<string, SSLayerState> = {};
  layer_keys: string[] = [];
  timestamp = engine.frame_timestamp;
  user_idx = 0;

  constructor(params: {
    layers: Record<string, SSDataLayer>; base_path: string; default_fade_time: number;
    enable_logs?: boolean; streaming?: boolean; kill_delay?: number; tag_tolerance?: number;
    add_all?: boolean;
  }) {
    this.data_layers = params.layers;
    this.layers = {};
    this.base_path = params.base_path;
    this.default_fade_time = params.default_fade_time;
    this.enable_logs = params.enable_logs !== undefined ? params.enable_logs : DEFAULT_ENABLE_LOGS;
    this.streaming = params.streaming !== undefined ? params.streaming : DEFAULT_STREAMING;
    this.kill_delay = params.kill_delay !== undefined ? params.kill_delay : DEFAULT_KILL_DELAY;
    this.tag_tolerance = params.tag_tolerance !== undefined ? params.tag_tolerance : DEFAULT_TAG_TOLERANCE;
    params.add_all = params.add_all !== undefined ? params.add_all : DEFAULT_ADD_ALL;
    if (params.add_all) {
      this.addAll();
    }
  }

  addLayer(key: string): void {
    if (!this.layer_state[key]) {
      this.layers[key] = new GlovSSParentLayer(this, this.data_layers[key]);
      this.layer_state[key] = {
        active: [],
        rel_intensity: random(),
        // when we last started a new track playing
        last_add: 0,
        // change: when to change `rel_intensity`
        change: this.timestamp + this.layers[key].period + random() * this.layers[key].period_noise,
        add_blocked: false,
        drained: false,
      };
      this.layer_keys.push(key);
      this.layer_keys.sort((a, b) => {
        let layera: GlovSSParentLayer = this.layers[a];
        let layerb: GlovSSParentLayer = this.layers[b];
        let d = (layera.excl_group_master?1:0) - (layerb.excl_group_master?1:0);
        if (d) {
          return -d;
        }
        d = (layera.sync_with?1:0) - (layerb.sync_with?1:0);
        if (d) {
          return d;
        }
        return layera.user_idx - layerb.user_idx;
      });
    }
  }

  addAll(): void {
    for (let key in this.data_layers) {
      this.addLayer(key);
    }
  }

  getTag(tag: string): boolean {
    return this.tags[tag];
  }
  getTagTime(tag: string): number | undefined {
    let tag_time = this.tag_timer[tag];
    return tag_time && this.tag_tolerance - (engine.frame_timestamp - tag_time);
  }
  setTag(tag: string, value: boolean, force?: boolean): void {
    if (force) {
      this.tags[tag] = value;
      delete this.tag_timer[tag];
      return;
    }
    if (this.tag_timer[tag]) {
      if (this.tags[tag] === value) {
        delete this.tag_timer[tag];
      }
      return;
    }
    if (this.tags[tag] !== value) {
      this.tag_timer[tag] = engine.frame_timestamp;
    }
  }
  getIntensity(): number {
    return this.intensity;
  }
  setIntensity(value: number): void {
    this.intensity = value;
  }
  getLayer(key: string): SSLayer {
    let layer = this.layers[key];
    let ret: SSLayer = layer;
    let priority = 0;
    for (let tag in layer.tags) {
      if (!this.tags[tag]) {
        continue;
      }
      let taglayer = layer.tags[tag];
      if (taglayer.priority > priority) {
        ret = taglayer;
        priority = taglayer.priority;
      }
    }
    return ret;
  }

  forceNoTracks(value: boolean): void {
    this.force_no_tracks = value;
  }

  setFadeInTime(time: number): void {
    this.fade_in_start = engine.frame_timestamp;
    this.fade_in_time = engine.frame_timestamp + time;
  }

  tick(): void {
    let now = engine.frame_timestamp;
    let { intensity, layer_state, layer_keys } = this;

    for (let tag in this.tag_timer) {
      let tag_time = this.tag_timer[tag]!;
      if (now > tag_time + this.tag_tolerance) {
        this.tags[tag] = !this.tags[tag];
        delete this.tag_timer[tag];
      }
    }

    let active_excl_group = '';
    let active_files: Record<string, boolean>;
    function filterValidFiles(a: GlovSSFile): boolean {
      return !active_files[a.file] && (!a.excl_group || a.excl_group[active_excl_group]);
    }
    function filterValidFilesMaster(a: GlovSSFile): boolean {
      return !active_files[a.file] && (!a.excl_group || !active_excl_group || a.excl_group[active_excl_group]);
    }

    if (this.fade_in_time && now > this.fade_in_time) {
      this.fade_in_time = 0;
      this.fade_in_start = 0;
    }

    // If streaming and no sounds are playing, should force first sound (never desyncs)
    let any_playing;
    if (this.streaming) { // any_playing won't be used if not streaming.
      any_playing = false;
      for (let jj = 0; jj < layer_keys.length; ++jj) {
        let state = layer_state[layer_keys[jj]];
        for (let ii = 0; ii < state.active.length; ++ii) {
          if (!isPlaceholderSound(state.active[ii].sound)) {
            any_playing = true;
          }
        }
      }
    }

    for (let jj = 0; jj < layer_keys.length; ++jj) {
      let key = layer_keys[jj];
      let data = this.getLayer(key);
      let { files, files_map, add_delay, sync_with, excl_group_master } = data;
      let state = layer_state[key];
      if (now > state.change) {
        state.change = now + data.period + random() * data.period_noise;
        state.rel_intensity = random();
      }
      let wanted = 0;
      if (!this.force_no_tracks) {
        if (intensity > data.min_intensity && intensity < data.max_intensity && data.odds_total) {
          let v = state.rel_intensity * data.odds_total;
          wanted = 0;
          do {
            v -= data.odds[wanted];
            if (v < 0) {
              break;
            }
            wanted++;
          } while (wanted < data.odds.length - 1);
        }
        wanted = min(wanted, files.length);
        if (settings.volume * settings.volume_music === 0 || !soundResumed()) {
          wanted = 0;
          this.stopAllLayers(this.kill_delay);
        }
      }
      // Ensure active sounds are in the current file list
      active_files = {};
      for (let ii = state.active.length - 1; ii >= 0; --ii) {
        let active_sound = state.active[ii];
        let { file, sound, start } = active_sound;
        if (!sound) {
          // No sound here, soundPlay returned null to soundPlayStreaming?...
          this.log(key, `remove (not playing) ${file.file}`);
          ridx(state.active, ii);
        } else if (isPlaceholderSound(sound)) { // Will only happen if this.streaming = true.
          // Not loaded on time, if nothing is playing pretend it was asked now to hurry it up (no risk of desyncing)
          if (!any_playing) {
            active_sound.start = start = now;
          }
          // Not loaded on time, do not play it or it will desync
          if (now - start > MAX_SOUND_DELAY) {
            this.addStreamedSoundCB(sound, (played_sound) => played_sound.fade(0, 1));
            this.log(key, `remove (not loaded on time) ${file.file}`);
            ridx(state.active, ii);
          }
        } else if (!sound.playing()) {
          // not playing yet, for some reason some sounds never start playing
          if (now - start > MAX_SOUND_DELAY) {
            this.log(key, `remove (not playing) ${file.file}`);
            ridx(state.active, ii);
          }
        } else {
          // currently playing
          let should_stop = !files_map[file.file] ? 'not in file list' : null;
          if (file.excl_group) {
            if (excl_group_master) {
              if (!active_excl_group) {
                active_excl_group = file.excl_group_first;
              }
              // Either we just set the group, or anything playing must be in that group
              assert(file.excl_group[active_excl_group]);
            } else {
              // Maybe also stop if no excl_group is active?  fine to let this keep playing, I guess?
              if (active_excl_group && !file.excl_group[active_excl_group]) {
                should_stop = 'mismatched excl_group';
              }
            }
          }
          if (should_stop) {
            this.log(key, `stop (${should_stop}) ${file.file}`);
            this.stopSound(state.active, ii);
          } else {
            active_files[file.file] = true;
          }
        }
      }

      // check sync'd track
      if (sync_with) {
        let sync_parent = this.layer_state[sync_with];
        if (sync_parent.last_add === now) {
          // they just started, stop what we've got and start a new one
          for (let ii = state.active.length - 1; ii >= 0; --ii) {
            let active_sound = state.active[ii];
            let { sound, file } = active_sound;
            if (isPlaceholderSound(sound)) {
              this.addStreamedSoundCB(sound, function (played_sound) {
                played_sound.fade(0, 1);
              });
            } else if (!sound.playing()) {
              this.log(key, `remove (sync'd changed) ${file.file}`);
              ridx(state.active, ii);
            } else {
              // Not doing this, don't stop (and immediately restart) a sync'd track if it's still playing
              // this.log(key, `stop (sync'd changed) ${file.file}`);
              // this.stopSound(state.active, 0);
            }
            delete active_files[file.file];
          }
          wanted = min(wanted, sync_parent.active.length);
          this.log(key, `sync'd changed, want ${wanted}`);
        } else {
          // do not start any new ones if ours has ended, stop if theirs ended
          wanted = min(wanted, state.active.length, sync_parent.active.length);
        }
      }

      // Stop any extras
      while (state.active.length > wanted) {
        let idx = floor(random() * state.active.length);
        this.log(key, `stop (over wanted count) ${state.active[idx].file.file}`);
        this.stopSound(state.active, idx);
        // Allow immediate adds
        state.last_add = 0;
      }

      // Start new to match
      state.add_blocked = false;
      state.drained = false;
      while (state.active.length < wanted) {
        if (state.last_add && now - state.last_add < add_delay) {
          state.add_blocked = true;
          break;
        }
        let valid_files = files.filter(excl_group_master ? filterValidFilesMaster : filterValidFiles);
        // assert(valid_files.length); // More likely to get no valid files due to excl groups
        if (!valid_files.length) {
          state.drained = true;
          break;
        }
        let idx = floor(random() * valid_files.length);
        let file = valid_files[idx];
        let active_state : SSSoundStateBase = {
          file,
          start: now,
        };
        let new_sound;
        if (this.streaming) {
          new_sound = soundPlayStreaming(file.file, GLOV_PLAY_VOLUME, true, (played_sound: GlovSoundSetUp | null) => {
            if (played_sound) {
              let { name } = played_sound;
              active_state.sound = played_sound;
              this.log(key, `start ${file.file}`);
              if (this.fade_in_time) {
                let ratio = (now - this.fade_in_start) / (this.fade_in_time - this.fade_in_start);
                let volume = max(SILENT_VOLUME, GLOV_PLAY_VOLUME * ratio);
                played_sound.volume(volume);
                let target_volume = GLOV_PLAY_VOLUME;
                played_sound.fade(target_volume, this.fade_in_time - now);
              }
              let sound_cbs = this.streaming_cbs[name];
              if (sound_cbs) {
                for (let i = 0; i < sound_cbs.length; ++i) {
                  sound_cbs[i](played_sound as GlovSoundSetUp);
                }
                delete this.streaming_cbs[name];
              }
            }
          });
        } else {
          new_sound = soundPlay(file.file, GLOV_PLAY_VOLUME, true);
        }

        if (!new_sound) {
          // No new sound.
          this.log(key, `start ${this.streaming ? 'streaming ' : ''}failed ${file.file}`);
          // if streaming: Should never reach here.
          // if not streaming: still loading? Or just played on another layer
          --wanted;
        } else {
          // New sound being played.
          if (this.streaming) {
            delete this.streaming_cbs[new_sound.name]; // Want it to play again, remove unwanted cb's
          }
          this.log(key, `start ${this.streaming ? 'streaming ' : ''}${file.file}`);
          active_state.sound = new_sound;
          state.last_add = now;
          state.active.push(active_state as SSSoundState); // Will always have sound property here.
          active_files[file.file] = true;
          if (excl_group_master && file.excl_group) {
            assert(!active_excl_group || file.excl_group[active_excl_group]);
            active_excl_group = file.excl_group_first;
          }
        }
      }
    }
  }

  callSoundCBWhenPossible(sound: GlovSound, cb: (sound: GlovSoundSetUp) => void): void {
    if (isPlaceholderSound(sound)) {
      this.addStreamedSoundCB(sound, cb);
    } else {
      cb(sound);
    }
  }

  addStreamedSoundCB(sound: GlovSoundStreamedPlaceholder, cb: (sound: GlovSoundSetUp) => void): void {
    let { name } = sound;
    if (!this.streaming_cbs[name]) {
      this.streaming_cbs[name] = [];
    }
    this.streaming_cbs[name].push(cb);
  }

  stopSound(active_list: SSSoundState[], idx: number, fade_override?: number): void {
    let to_remove = active_list[idx];
    ridx(active_list, idx);
    if (isPlaceholderSound(to_remove.sound)) {
      this.addStreamedSoundCB(to_remove.sound, function (played_sound: GlovSoundSetUp) {
        played_sound.fade(0, 1); // Starting to be played, immediately stop.
      });
    } else {
      to_remove.sound.fade(0, fade_override || to_remove.file.fade_time);
    }
  }

  stopAllLayers(fade_override: number): void {
    let { layer_state, layer_keys } = this;
    for (let jj = 0; jj < layer_keys.length; ++jj) {
      let key = layer_keys[jj];
      let state = layer_state[key];
      for (let ii = state.active.length - 1; ii >= 0; --ii) {
        let active_sound = state.active[ii];
        let { sound } = active_sound;
        if (isPlaceholderSound(sound)) { // Didn't even start, stop immediately
          this.addStreamedSoundCB(sound, function (played_sound: GlovSoundSetUp) {
            played_sound.fade(0, 1);
          });
          state.last_add = 0;
        } else {
          if (!sound.playing()) {
            ridx(state.active, ii);
          } else {
            this.stopSound(state.active, ii, fade_override);
            // Allow immediate adds
            state.last_add = 0;
          }
        }
      }
    }
  }

  debugSolo(solo: SSSoundState): void {
    let { layer_state, layer_keys } = this;
    for (let jj = 0; jj < layer_keys.length; ++jj) {
      let key = layer_keys[jj];
      let state = layer_state[key];
      for (let ii = state.active.length - 1; ii >= 0; --ii) {
        let active_sound = state.active[ii];
        let { sound } = active_sound;
        this.callSoundCBWhenPossible(sound, function (played_sound: GlovSoundSetUp) {
          if (played_sound.playing()) {
            // Might be wrong solo track when loaded. Not important as is debug-only
            if (active_sound === solo || !solo) {
              played_sound.volume(1);
            } else {
              played_sound.volume(0);
            }
          }
        });
      }
    }
  }

  debug(): { text: string; hover?: SSSoundState }[] {
    let { layer_state } = this;
    let ret = [];
    for (let key in layer_state) {
      let state = layer_state[key];
      let data = this.getLayer(key);
      let { active, rel_intensity } = state;
      if (active.length || this.intensity > data.min_intensity && this.intensity < data.max_intensity) {
        ret.push({ text: `Layer ${key}` +
          `${(data.odds_total === 1 ? '' : ` (${rel_intensity.toFixed(2)})`)}` +
          `${state.add_blocked ? ' (waiting)' : ''}` +
          `${state.drained ? ' (no options)' : ''}` +
          ':' });
      }
      for (let ii = 0; ii < active.length; ++ii) {
        let active_sound = active[ii];
        let filename = active_sound.file.file.substring(active_sound.file.file.lastIndexOf('/')+1);
        let text = '  ';
        if (active_sound.file.tag_id) {
          text += `[${active_sound.file.tag_id}]`;
        }
        text += ` ${filename}\t `+
        `  ${active_sound.file.excl_group ? active_sound.file.excl_group_debug : '*'} `;
        if (isPlaceholderSound(active_sound.sound)) {
          text += '  (Sound being streamed...)';
        } else {
          let location = active_sound.sound?.location().toFixed(1);
          let duration = active_sound.sound?.duration().toFixed(1);
          text += `  (${location}/${duration})`;
        }
        ret.push({ hover: active_sound, text });
      }
    }
    return ret;
  }

  log(layer_name: string, msg: string): void {
    if (this.enable_logs) {
      console.log(`${(engine.frame_timestamp/1000).toFixed(2)} [${layer_name}]: ${msg}`);
    }
  }
}
