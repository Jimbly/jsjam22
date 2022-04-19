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
  // Set a default value that cannot be determined at load time
  // Only set if this has never been modified
  if (!modified[key]) {
    // Does *not* call cmd_parse.set - will not write to storage, still at "default" setting
    exports[key] = new_default;
  }
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
      cb();
    }
  }
}

export function pop() {
  assert(settings_stack);
  for (let key in settings_stack) {
    exports[key] = settings_stack[key];
    let cb = change_cbs[key];
    if (cb) {
      cb();
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
      on_change: def.on_change,
      access_run: def.access_run,
      access_show: def.access_show,
    });
  });
}

register({
  max_fps: {
    label: 'Max FPS',
    default_value: 0,
    type: cmd_parse.TYPE_FLOAT,
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
    range: [0,2],
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
