// Portions Copyright 2008-2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Initially derived from libGlov:utilPerf.h/GlovPerf.cpp
// For good memory profiling, Chrome must be launched with --enable-precise-memory-info

// eslint-disable-next-line @typescript-eslint/no-redeclare
/* globals performance*/

export const HAS_MEMSIZE = Boolean(window.performance && performance.memory && performance.memory.usedJSHeapSize);
export const HIST_SIZE = 128;
export const HIST_COMPONENTS = 3; // count, time, dmem
export const HIST_TOT = HIST_SIZE * HIST_COMPONENTS;
// Default `mem_depth` very low, as every profile section with
//    memory adds about 12µs and 56bytes, compared to 1µs and 24bytes without
export const MEM_DEPTH_DEFAULT = 2;

const assert = require('assert');
const engine = require('./engine.js');
const { max } = Math;

// For profiler_ui.js
const { localStorageGetJSON, localStorageSetJSON } = require('./local_storage.js');
let profiler_open_keys = localStorageGetJSON('profiler_open_keys', {});

let last_id = 0;
function ProfilerEntry(parent, name) {
  this.parent = parent;
  this.depth = parent ? parent.depth + 1 : 0;
  this.next = null;
  this.child = null;
  this.name = name;
  this.count = 0;
  this.time = 0;
  this.dmem = 0;
  this.start_time = 0;
  this.start_mem = 0;
  this.history = new Float32Array(HIST_TOT);
  // For profiler_ui.js
  this.id = ++last_id;
  this.show_children = !(parent && parent.parent) || profiler_open_keys[this.getKey()] || false;
  this.color_override = null;
}
ProfilerEntry.prototype.isEmpty = function () {
  for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
    if (this.history[ii]) {
      return false;
    }
  }
  return true;
};
ProfilerEntry.prototype.toJSON = function () {
  let { next, child } = this;
  while (next && next.isEmpty()) {
    next = next.next;
  }
  while (child && child.isEmpty()) {
    child = child.next;
  }
  let ret = {
    i: this.name,
    h: Array.prototype.slice.call(this.history), // Float32Array -> Array
  };
  if (next) {
    ret.n = next;
  }
  if (child) {
    ret.c = child;
  }
  return ret;
};
function profilerEntryFromJSON(parent, obj) {
  let ret = new ProfilerEntry(parent, obj.i);
  assert.equal(obj.h.length, ret.history.length);
  for (let ii = 0; ii < obj.h.length; ++ii) {
    ret.history[ii] = obj.h[ii];
  }
  if (obj.n) {
    ret.next = profilerEntryFromJSON(parent, obj.n);
  }
  if (obj.c) {
    ret.child = profilerEntryFromJSON(ret, obj.c);
  }
  return ret;
}

// For profiler_ui.js
ProfilerEntry.prototype.getKey = function () {
  if (!this.parent) {
    return '';
  } else {
    return `${this.parent.getKey()}.${this.name}`;
  }
};
// For profiler_ui.js
ProfilerEntry.prototype.toggleShowChildren = function () {
  this.show_children = !this.show_children;
  if (this.show_children) {
    profiler_open_keys[this.getKey()] = 1;
  } else {
    delete profiler_open_keys[this.getKey()];
  }
  localStorageSetJSON('profiler_open_keys', profiler_open_keys);
};

let root = new ProfilerEntry(null, 'root');
// Add static node to the tree that we will reference later
// Note: profiler_ui.js assumes this is always `root.child`
let node_out_of_tick = new ProfilerEntry(root, 'GPU/idle');
root.child = node_out_of_tick;
// Immediately add `tick` node, so it's always second in the list
let node_tick = new ProfilerEntry(root, 'tick');
node_out_of_tick.next = node_tick;

let current = root;
let history_index = 0;
let paused = false;
let mem_depth = MEM_DEPTH_DEFAULT;
let total_calls = 0;
let last_frame_total_calls = 0;

function memSizeChrome() {
  return performance.memory.usedJSHeapSize;
}
function memSizeNop() {
  return 0;
}
let memSize = HAS_MEMSIZE ? memSizeChrome : memSizeNop;
let mem_is_high_res = 10;
const WARN_CALLS_COUNT = 1000;
export function profilerWarning() {
  if (last_frame_total_calls > WARN_CALLS_COUNT) {
    return `Warning: Too many per-frame profilerStart() calls (${last_frame_total_calls} > ${WARN_CALLS_COUNT})`;
  } else if (!HAS_MEMSIZE) {
    return 'To access memory profiling, run in Chrome';
  } else if (mem_depth > 1 && mem_is_high_res < 10) {
    return 'For precise memory profiling, launch Chrome with --enable-precise-memory-info';
  }
  return '';
}

export function profilerNodeRoot() {
  return root;
}
export function profilerNodeTick() {
  return node_tick;
}
export function profilerHistoryIndex() {
  return history_index;
}

export function profilerFrameStart() {
  last_frame_total_calls = total_calls;
  total_calls = 0;
  root.count = 1;
  let now = performance.now();
  root.time = now - root.start_time;
  root.start_time = now;
  if (mem_depth > 0) {
    let memnow = memSize();
    root.dmem = memnow - root.start_mem;
    root.start_mem = memnow;
  }
  node_out_of_tick.count = 1;
  // Place the unaccounted portion of the root's time in `node_out_of_tick`
  node_out_of_tick.time = root.time;
  node_out_of_tick.dmem = root.dmem;
  for (let walk = root.child; walk; walk = walk.next) {
    if (walk === node_out_of_tick) {
      continue;
    }
    node_out_of_tick.time -= walk.time;
    node_out_of_tick.dmem -= walk.dmem;
    if (mem_depth > 1) {
      if (walk.count) {
        // Should basically never see a `0` for dmem, if we do, probably low-precision memory tracking
        if (walk.dmem) {
          mem_is_high_res++;
        } else {
          mem_is_high_res-=5;
        }
      }
    }
  }
  if (current !== root) {
    console.error('Profiler starting new frame but some section was not stopped', current && current.name);
    current = root;
  }
  let walk = root;
  while (walk) {
    let recursing_down = true;
    if (!paused) {
      walk.history[history_index] = walk.count;
      walk.history[history_index+1] = walk.time;
      walk.history[history_index+2] = walk.dmem;
    }
    walk.count = 0;
    walk.time = 0;
    walk.dmem = 0;
    do {
      if (recursing_down && walk.child) {
        walk = walk.child;
      } else if (walk.next) {
        walk = walk.next;
      } else {
        walk = walk.parent;
        recursing_down = false;
        if (walk) {
          continue;
        }
      }
      break;
    } while (true);
  }
  if (!paused) {
    history_index = (history_index + HIST_COMPONENTS) % HIST_TOT;
  }
}

function profilerStart(name) {
  ++total_calls;

  // Find us in current's children
  let last = null;
  let instance;
  for (instance = current.child; instance; last = instance, instance = instance.next) {
    if (instance.name === name) {
      break;
    }
  }
  if (!instance) {
    if (!last) {
      // No children yet
      assert(!current.child);
      instance = new ProfilerEntry(current, name);
      current.child = instance;
    } else {
      instance = new ProfilerEntry(current, name);
      last.next = instance;
    }
  } else {
    assert(instance.parent === current);
  }
  // instance is set to us now!

  current = instance;
  instance.start_time = performance.now();
  if (instance.depth < mem_depth) {
    instance.start_mem = memSize();
  }
}

function profilerStop(old_name, count) {
  if (old_name) {
    assert.equal(old_name, current.name);
  }
  current.time += performance.now() - current.start_time;
  if (current.depth < mem_depth) {
    current.dmem += memSize() - current.start_mem;
  }
  current.count += count || 1;
  current = current.parent;
}

function profilerStopStart(name, count) {
  // TODO: only sample timestamp once
  profilerStop(null, count);
  profilerStart(name);
}

if (window.performance && window.performance.now) {
  window.profilerStart = profilerStart;
  window.profilerStop = profilerStop;
  window.profilerStopStart = profilerStopStart;
} // else set to `nop` in bootstrap.js

export function profilerPaused() {
  return paused;
}
export function profilerPause(new_value) {
  paused = new_value;
}

export function profilerMemDepthGet() {
  return mem_depth;
}

export function profilerMemDepthSet(value) {
  mem_depth = value;
}

export function profilerTotalCalls() {
  return last_frame_total_calls;
}

export function profilerWalkTree(use_root, cb) {
  let depth = 0;
  let walk = use_root;
  while (walk) {
    let recursing_down = true;
    if (walk !== use_root) {
      if (!cb(walk, depth)) {
        recursing_down = false;
      }
    }
    do {
      if (recursing_down && walk.child) {
        depth++;
        walk = walk.child;
      } else if (walk.next) {
        walk = walk.next;
      } else {
        depth--;
        walk = walk.parent;
        recursing_down = false;
        if (walk) {
          continue;
        }
      }
      break;
    } while (true);
  }
}

export function profilerAvgTime(entry) {
  let sum = 0;
  for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
    if (entry.history[ii]) {
      sum += entry.history[ii+1];
    }
  }
  return sum / HIST_SIZE;
}

export function profilerMaxMem(entry) {
  let dmem_max = 0;
  for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
    if (entry.history[ii]) {
      dmem_max = max(dmem_max, entry.history[ii+2]);
    }
  }
  return dmem_max;
}

export function profilerExport() {
  let obj = {
    history_index,
    root,
    mem_depth: HAS_MEMSIZE ? mem_depth : 0,
    calls: last_frame_total_calls,
    // Include some device info
    device: {
      ua: window.navigator.userAgent,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      webgl: engine.webgl2 ? 2 : 1,
      width: engine.width,
      height: engine.height,
    },
  };
  let debug_info = gl.getExtension('WEBGL_debug_renderer_info');
  if (debug_info) {
    obj.device.renderer_unmasked = gl.getParameter(debug_info.UNMASKED_RENDERER_WEBGL);
    obj.device.vendor_unmasked = gl.getParameter(debug_info.UNMASKED_VENDOR_WEBGL);
  }
  let str = JSON.stringify(obj);
  // Round all numbers (in text form) to 3 digits of precision, that's the most
  //   we're getting from performance.now anyway, and JSON ends up with lots
  //   of 0.12299999999999 strings otherwise.
  str = str.replace(/\d\.\d\d\d\d+/g, (a) => {
    a = a[5]>'4' ? a.slice(0,4) + (Number(a[4])+1) : a.slice(0,5);
    while (a.slice(-1) === '0' || a.slice(-1) === '.') {
      a = a.slice(0, -1);
    }
    return a;
  });

  return str;
}
export function profilerImport(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    // handled below
  }
  if (!obj) {
    return null;
  }

  obj.root = profilerEntryFromJSON(null, obj.root);
  return obj;
}

// For calling manually in the console for debugging
export function profilerDump() {
  assert(current === root);
  let lines = ['','','# PROFILER RESULTS'];

  // Using "% of frame" and "average" equivalent options from profiler_ui
  let total_frame_time = profilerAvgTime(root);

  profilerWalkTree(root, function (walk, depth) {
    let time_sum=0;
    let count_sum=0;
    let time_max=0;
    let sum_count=0;
    let dmem_max=0;
    for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
      if (walk.history[ii]) {
        sum_count++;
        count_sum += walk.history[ii]; // count
        time_sum += walk.history[ii+1]; // time
        time_max = max(time_max, walk.history[ii+1]);
        dmem_max = max(dmem_max, walk.history[ii+2]);
      }
    }
    if (!count_sum) {
      return true;
    }
    let percent = (time_sum/HIST_SIZE) / total_frame_time;

    let ms = time_sum / sum_count;
    let count = (count_sum / sum_count).toFixed(0);

    let buf = '';
    for (let ii = 1; ii < depth; ++ii) {
      buf += '* ';
    }
    buf += `${(percent * 100).toFixed(0)}% ${walk.name} `;
    buf += `${(ms*1000).toFixed(0)} (${count}) max:${(time_max*1000).toFixed(0)}`;
    if (HAS_MEMSIZE) {
      buf += ` dmem:${dmem_max}`;
    }
    lines.push(buf);
    return true;
  });
  let warning = profilerWarning();
  if (warning) {
    lines.push('', warning);
  }
  lines.push('', '');
  console.log(lines.join('\n'));
}

window.profilerDump = profilerDump;
