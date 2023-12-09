// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

let modified = {};
exports.true = true; // for perf.js

const assert = require('assert');
const { titleCase } = require('glov/common/util.js');
const { cmd_parse } = require('./cmds.js');
const engine = require('./engine.js');

let change_cbs = {};

export function get(key) {
  return exports[key];
}

export function set(key, value) {
  if (exports[key] !== value) {
    cmd_parse.handle(null, `${key} ${value}`, null); // uses default cmd_parse handler
  }
}

export function setAsync(key, value) {
  engine.postTick({ fn: set.bind(null, key, value) });
}

export function runTimeDefault(key, new_default) {
  assert(!change_cbs[key]); // If so, we set `default_clear_on` below, and may have discarded a desired setting.
  // Set a default value that cannot be determined at load time
  // Only set if this has never been modified
  if (!modified[key]) {
    // Does *not* call cmd_parse.set - will not write to storage, still at "default" setting
    exports[key] = new_default;
  }
}

export function settingIsModified(key) {
  return modified[key];
}

let settings_stack = null;
export function push(pairs) {
  assert(!settings_stack);
  settings_stack = {};
  for (let key in pairs) {
    settings_stack[key] = exports[key];
    exports[key] = pairs[key];
    let cb = change_cbs[key];
    if (cb) {
      cb(false);
    }
  }
}

export function pop() {
  assert(settings_stack);
  for (let key in settings_stack) {
    exports[key] = settings_stack[key];
    let cb = change_cbs[key];
    if (cb) {
      cb(false);
    }
  }
  settings_stack = null;
}

export function register(defs) {
  Object.keys(defs).forEach(function (key) {
    let def = defs[key];
    exports[key] = def.default_value;
    if (def.on_change) {
      change_cbs[key] = def.on_change;
    }
    cmd_parse.registerValue(key, {
      type: def.type,
      label: def.label || titleCase(key.replace(/_/g, ' ')),
      range: def.range,
      get: () => exports[key],
      set: (v) => {
        modified[key] = true;
        exports[key] = v;
      },
      store: def.store !== false,
      ver: def.ver,
      help: def.help,
      usage: def.usage,
      prefix_usage_with_help: def.prefix_usage_with_help,
      on_change: def.on_change,
      access_run: def.access_run,
      access_show: def.access_show,
      default_value: def.default_value,
      enum_lookup: def.enum_lookup,
    });
  });
}

register({
  max_fps: {
    label: 'Maximum frame rate (FPS)',
    prefix_usage_with_help: true,
    usage:
      'Display current maximum: /max_fps\n' +
      'Set maximum FPS limit: /max_fps 30\n' +
      'Set automatic by browser: /max_fps 0 (may be unresponsive)\n' +
      'Set unlimited: /max_fps 1000 (may be unresponsive)\n' +
      'Default: /max_fps 60',
    default_value: 60,
    type: cmd_parse.TYPE_FLOAT,
    ver: 2,
  },
  use_animation_frame: {
    label: 'Use requestAnimationFrame',
    help: 'Use requestAnimationFrame for any max_fps values lower than this value.',
    prefix_usage_with_help: true,
    default_value: 60,
    type: cmd_parse.TYPE_INT,
    range: [0, 240],
  },
  render_scale: {
    label: 'Render Scale (3D)',
    default_value: 1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0.1,1],
  },
  render_scale_mode: {
    label: 'Render Scale Mode',
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    enum_lookup: {
      LINEAR: 0,
      NEAREST: 1,
      CRT: 2,
    },
  },
  render_scale_all: {
    label: 'Render Scale (All)',
    default_value: 1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0.3333,4],
  },
  render_scale_clear: {
    label: 'Render Scale Full Clear',
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
  fov: {
    default_value: 60,
    type: cmd_parse.TYPE_FLOAT,
    range: [1,100],
  },
  double_click_time: {
    default_value: 500,
    type: cmd_parse.TYPE_INT,
    range: [0,2500],
  },
});
