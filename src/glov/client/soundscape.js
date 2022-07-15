const assert = require('assert');
const { floor, min, random } = Math;
const { ridx } = require('glov/common/util.js');
const engine = require('./engine.js');
const settings = require('./settings.js');
const { soundLoad, soundPlay, soundResumed } = require('./sound.js');

const DEFAULT_PERIOD = 30000;
const DEFAULT_PERIOD_NOISE = 15000;
const DEFAULT_ADD_DELAY = 5000; // how long to wait between adding another track
let inherit_props = [
  'min_intensity',
  'max_intensity',
  'odds',
  'period',
  'period_noise',
  'add_delay',
  'sync_with',
  'excl_group_master',
];
const volume = 1;

function log(layer, msg) {
  console.log(`${(engine.frame_timestamp/1000).toFixed(2)} [${layer}]: ${msg}`);
}

function SoundScape(params) {
  let { base_path, layers, default_fade_time } = params;
  this.intensity = 0;
  this.tags = {};
  function preload(layer, parent) {
    let { tags } = layer;
    layer.files_map = {};
    layer.files = layer.files.map((file) => {
      if (typeof file === 'string') {
        file = { file };
      }
      file.file = `${base_path}${file.file}`;
      layer.files_map[file.file] = file;
      soundLoad(file.file, { streaming: true });
      if (file.excl_group) {
        if (typeof file.excl_group === 'string') {
          file.excl_group = [file.excl_group];
        }
        assert(Array.isArray(file.excl_group));
        file.excl_group_first = file.excl_group[0]; // Used if we are the master
        file.excl_group_debug = file.excl_group.join(',');
        let map = {};
        for (let ii = 0; ii < file.excl_group.length; ++ii) {
          map[file.excl_group[ii]] = true;
        }
        file.excl_group = map;
      }
      if (!file.fade_time) {
        file.fade_time = default_fade_time;
      }
      return file;
    });
    if (parent) {
      for (let ii = 0; ii < inherit_props.length; ++ii) {
        let key = inherit_props[ii];
        if (layer[key] === undefined) {
          layer[key] = parent[key];
        }
      }
    }
    if (layer.max) {
      layer.odds = [0];
      for (let ii = 0; ii < layer.max; ++ii) {
        layer.odds.push(1);
      }
    }
    layer.odds_total = 0;
    if (layer.odds) {
      for (let ii = 0; ii < layer.odds.length; ++ii) {
        layer.odds_total += layer.odds[ii];
      }
    }
    layer.add_delay = layer.sync_with ? 0 : (layer.add_delay || DEFAULT_ADD_DELAY);
    layer.period = layer.period || DEFAULT_PERIOD;
    layer.period_noise = layer.period_noise || DEFAULT_PERIOD_NOISE;
    layer.max_intensity = layer.max_intensity || Infinity;
    for (let tag in tags) {
      preload(tags[tag], layer);
    }
  }
  this.layer_state = {};
  let now = engine.frame_timestamp;
  let user_idx = 0;
  for (let key in layers) {
    preload(layers[key]);
    layers[key].user_idx = ++user_idx;
    this.layer_state[key] = {
      active: [],
      rel_intensity: random(),
      // when we last started a new track playing
      last_add: 0,
      // change: when to change `rel_intensity`
      change: now + layers[key].period + random() * layers[key].period_noise,
    };
  }
  this.layer_keys = Object.keys(layers);
  this.layer_keys.sort((a, b) => {
    let layera = layers[a];
    let layerb = layers[b];
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
  this.layer_data = layers;
}
SoundScape.prototype.getTag = function (tag) {
  return this.tags[tag];
};
SoundScape.prototype.setTag = function (tag, value) {
  this.tags[tag] = value;
};
SoundScape.prototype.setIntensity = function (value) {
  this.intensity = value;
};
SoundScape.prototype.getLayer = function (key) {
  let layer = this.layer_data[key];
  let ret = layer;
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
};
function stop(active_list, idx, fade_override) {
  let to_remove = active_list[idx];
  ridx(active_list, idx);
  to_remove.sound.fadeOut(fade_override || to_remove.file.fade_time);
}
SoundScape.prototype.tick = function () {
  let now = engine.frame_timestamp;
  let { intensity, layer_state, layer_keys } = this;

  let active_excl_group = null;
  let active_files;
  function filterValidFiles(a) {
    return !active_files[a.file] && (!a.excl_group || a.excl_group[active_excl_group]);
  }
  function filterValidFilesMaster(a) {
    return !active_files[a.file] && (!a.excl_group || !active_excl_group || a.excl_group[active_excl_group]);
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
    if (!settings.music || !soundResumed()) {
      wanted = 0;
    }
    // Ensure active sounds are in the current file list
    active_files = {};
    for (let ii = state.active.length - 1; ii >= 0; --ii) {
      let active_sound = state.active[ii];
      let { file, sound, start } = active_sound;
      if (!sound.playing()) {
        // not playing yet, for some reason some sounds never start playing
        if (now - start > 1000) {
          log(key, `remove (not playing) ${file.file}`);
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
          log(key, `stop (${should_stop}) ${file.file}`);
          stop(state.active, ii);
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
          if (!sound.playing()) {
            log(key, `remove (sync'd changed) ${file.file}`);
            ridx(state.active, ii);
          } else {
            // Not doing this, don't stop (and immediately restart) a sync'd track if it's still playing
            // log(key, `stop (sync'd changed) ${file.file}`);
            // stop(state.active, 0);
          }
          delete active_files[file.file];
        }
        wanted = min(wanted, sync_parent.active.length);
        log(key, `sync'd changed, want ${wanted}`);
      } else {
        // do not start any new ones if ours has ended, stop if theirs ended
        wanted = min(wanted, state.active.length, sync_parent.active.length);
      }
    }

    // Stop any extras
    while (state.active.length > wanted) {
      let idx = floor(random() * state.active.length);
      log(key, `stop (over wanted count) ${state.active[idx].file.file}`);
      stop(state.active, idx);
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
      let sound = soundPlay(file.file, volume, true);
      if (!sound) {
        log(key, `start failed ${file.file}`);
        // still loading? Or just played on another layer
        --wanted;
        continue;
      }
      log(key, `start ${file.file}`);
      state.last_add = now;
      state.active.push({
        file,
        sound,
        start: now,
      });
      active_files[file.file] = true;
      if (excl_group_master && file.excl_group) {
        assert(!active_excl_group || file.excl_group[active_excl_group]);
        active_excl_group = file.excl_group_first;
      }
    }
  }
};

SoundScape.prototype.stop = function (fade_override) {
  let { layer_state, layer_keys } = this;
  for (let jj = 0; jj < layer_keys.length; ++jj) {
    let key = layer_keys[jj];
    let state = layer_state[key];
    for (let ii = state.active.length - 1; ii >= 0; --ii) {
      let active_sound = state.active[ii];
      let { sound } = active_sound;
      if (!sound.playing()) {
        ridx(state.active, ii);
      } else {
        stop(state.active, ii, fade_override);
      }
    }
  }
};

SoundScape.prototype.debugSolo = function (solo) {
  let { layer_state, layer_keys } = this;
  for (let jj = 0; jj < layer_keys.length; ++jj) {
    let key = layer_keys[jj];
    let state = layer_state[key];
    for (let ii = state.active.length - 1; ii >= 0; --ii) {
      let active_sound = state.active[ii];
      let { sound } = active_sound;
      if (sound.playing()) {
        if (active_sound === solo || !solo) {
          sound.volume(1);
        } else {
          sound.volume(0);
        }
      }
    }
  }
};

SoundScape.prototype.debug = function () {
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
      ret.push({ hover: active_sound, text: `  ${filename}\t `+
        `  ${active_sound.file.excl_group ? active_sound.file.excl_group_debug : '*'} `+
        `  (${active_sound.sound.location().toFixed(1)}/${active_sound.sound.duration().toFixed(1)})` });
    }
  }
  return ret;
};

export function create(params) {
  return new SoundScape(params);
}
