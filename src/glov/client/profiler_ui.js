// Portions Copyright 2008-2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Initially derived from libGlov:utilPerf.h/GlovPerf.cpp
// For good memory profiling, Chrome must be launched with --enable-precise-memory-info


// Add to ProfilerEntry.prototype before any other (potentially circular) requires

/* eslint-disable import/order */
const camera2d = require('./camera2d.js');
const { cmd_parse } = require('./cmds.js');
const engine = require('./engine.js');
const { style } = require('./font.js');
const input = require('./input.js');
const { floor, max, min } = Math;
const { netClient, netDisconnected } = require('./net.js');
const ui = require('./ui.js');
const { perfGraphOverride, friendlyBytes } = require('./perf.js');
const {
  HIST_SIZE,
  HIST_COMPONENTS,
  HIST_TOT,
  HAS_MEMSIZE,
  MEM_DEPTH_DEFAULT,
  profilerAvgTime,
  profilerImport,
  profilerExport,
  profilerHistoryIndex,
  profilerMaxMem,
  profilerMemDepthGet,
  profilerMemDepthSet,
  profilerNodeTick,
  profilerNodeRoot,
  profilerPause,
  profilerPaused,
  profilerTotalCalls,
  profilerWalkTree,
  profilerWarning,
} = require('./profiler.js');
const settings = require('./settings.js');
const { lerp } = require('glov/common/util.js');
const { vec2, vec4 } = require('glov/common/vmath.js');

Z.PROFILER = Z.PROFILER || 9950; // above Z.BUILD_ERRORS
let color_gpu = vec4(0.5, 0.5, 1, 1);

let loaded_profile = null;
let node_out_of_tick;
let root;

function useNewRoot(new_root) {
  root = new_root;
  node_out_of_tick = root.child;
  if (node_out_of_tick) {
    node_out_of_tick.color_override = color_gpu;
  }
}

function useSavedProfile(text) {
  let obj = profilerImport(text);
  if (!obj) {
    ui.modalDialog({
      title: 'Error loading profile',
      text: text || 'No data',
      buttons: {
        Ok: null,
      },
    });
    return;
  }
  useNewRoot(obj.root);
  loaded_profile = obj;
}

function useLiveProfile() {
  useNewRoot(profilerNodeRoot());
  loaded_profile = null;
}

function profilerToggle(data, resp_func) {
  useLiveProfile();
  if (data === '1') {
    settings.set('show_profiler', 1);
  } else if (data === '0') {
    settings.set('show_profiler', 0);
    profilerMemDepthSet(MEM_DEPTH_DEFAULT);
  } else {
    if (settings.show_profiler) {
      if (profilerPaused()) {
        profilerPause(false);
      } else {
        settings.set('show_profiler', 0);
        profilerMemDepthSet(MEM_DEPTH_DEFAULT);
      }
    } else {
      settings.set('show_profiler', 1);
      profilerPause(true);
    }
  }

  if (resp_func) {
    resp_func();
  }
}
const access_show = engine.DEBUG ? undefined : ['hidden'];
cmd_parse.register({
  cmd: 'profiler_toggle',
  help: 'Show or toggle profiler visibility',
  access_show,
  func: profilerToggle,
});
const PROFILER_RELATIVE_LABELS = ['% of user', '% of parent', '% of frame', '% of mem'];
settings.register({
  show_profiler: {
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    access_show,
  },
  profiler_average: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    access_show: ['hidden'],
  },
  profiler_relative: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0, PROFILER_RELATIVE_LABELS.length-1],
    access_show: ['hidden'],
  },
  profiler_interactable: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    access_show: ['hidden'],
  },
  profiler_graph: {
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    access_show: ['hidden'],
  },
  profiler_mem_depth: {
    default_value: MEM_DEPTH_DEFAULT,
    type: cmd_parse.TYPE_INT,
    range: [0,100],
    access_show: ['hidden'],
  },
});

let font;
let y;
const style_time_spike = style(null, {
  color: 0xFF7F7Fff,
});
const style_number = style(null, {
  color: 0xFFFFD0ff,
});
const style_percent = style(null, {
  color: 0xFFFFD0ff,
});
const style_ms = style(null, {
  color: 0xD0FFFFff,
});
const style_mem = style(null, {
  color: 0xD0FFD0ff,
});
const style_header = style(null, {
  color: 0xFFFFFFff,
  outline_width: 0.8,
  outline_color: 0xFFFFFFff,
});
const style_name = style(null, {
  color: 0xFFFFFFff,
  outline_width: 1,
  outline_color: 0x00000080,
});
const FONT_SIZE = 22;
const LINE_HEIGHT = 24;
const LINE_YOFFS = (LINE_HEIGHT - FONT_SIZE)/2;
let font_number_scale;
let font_size_number;
let number_yoffs;
let bar_w;
// Different Zs for better batching
const Z_BAR = Z.PROFILER;
const Z_GRAPH = Z.PROFILER+1;
const Z_TREE = Z.PROFILER+2;
const Z_NAMES = Z.PROFILER+3;
const Z_NUMBER = Z.PROFILER+4;
const Z_MS = Z.PROFILER+5;
const MS_W = 58;
const COUNT_W = 56;
const MSPAIR_W = MS_W + 4 + COUNT_W;
const MEM_W = 120;
const COL_HEADERS = ['Profiler', 'µs (count)', 'max', 'GC / Δmem'];
const COL_W = [400, MSPAIR_W, MS_W, MEM_W];
const COL_X = [];
let bar_x0;
COL_X[0] = 0;
for (let ii = 0; ii < COL_W.length; ++ii) {
  COL_X[ii+1] = COL_X[ii] + COL_W[ii] + 4;
}
const LINE_WIDTH_WITH_MEM = COL_X[COL_W.length];
const LINE_WIDTH_NO_MEM = COL_X[COL_W.length-1];
let color_hint = vec4(0,0.25,0,0.85);
let color_bar = vec4(0,0,0,0.85);
let color_bar2 = vec4(0.2,0.2,0.2,0.85);
let color_bar_header = vec4(0.3,0.3,0.3,0.85);
let color_bar_over = vec4(0,0,0.5,0.85);
let color_bar_over2 = vec4(0.2,0.2,0.7,0.85);
let color_bar_parent = vec4(0,0,0.3,0.85);
let color_bar_parent2 = vec4(0.2,0.2,0.4,0.85);
let color_timing = vec4(1, 1, 0.5, 1);
let color_bar_highlight = vec4(0,0,0, 0.5);
const GRAPH_FRAME_TIME = 16;
let GRAPH_MAX_MEM = 4096;
let total_frame_time;
let total_frame_mem;
let show_index_count;
let show_index_time;
let show_index_mem;
let do_average;
let history_index;
let do_ui;
let line_width;
let show_mem;
let mouseover_elem = {};
let mouseover_main_elem;
let mouseover_bar_idx;
let dmem_max_value = 0;
let perf_graph = {
  history_size: HIST_SIZE,
  num_lines: 2,
  data: {
    history: new Float32Array(HIST_SIZE * 2),
    index: 0,
  },
  line_scale_top: GRAPH_FRAME_TIME,
  bars_stack: true,
  colors: [
    vec4(0.5, 1.0, 0.5, 1),
    color_gpu,
  ],
};
function profilerShowEntryEarly(walk, depth) {
  if (settings.profiler_relative === 0 && walk === node_out_of_tick) {
    // doesn't make sense to show
    return false;
  }
  let count_sum=0;
  for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
    count_sum += walk.history[ii];
  }
  if (!count_sum) {
    return true;
  }
  if (input.mouseOver({ x: 0, y, w: line_width, h: LINE_HEIGHT, peek: true })) {
    mouseover_main_elem = walk;
    mouseover_elem[walk.id] = 1;
    for (let parent = walk.parent; parent; parent = parent.parent) {
      mouseover_elem[parent.id] = 2;
    }
  }
  y += LINE_HEIGHT;
  if (!walk.show_children) {
    return false;
  }
  return true;
}
function hasActiveChildren(walk) {
  walk = walk.child;
  if (!walk) {
    return false;
  }
  while (walk) {
    for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
      if (walk.history[ii]) {
        return true;
      }
    }
    walk = walk.next;
  }
  return false;
}
function profilerShowEntry(walk, depth) {
  if (settings.profiler_relative === 0 && walk === node_out_of_tick) {
    // doesn't make sense to show
    return false;
  }
  let time_sum=0;
  let count_sum=0;
  let time_max=0;
  let sum_count=0;
  let dmem_min=Infinity;
  let dmem_max=-Infinity;
  for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
    if (walk.history[ii]) {
      sum_count++;
      count_sum += walk.history[ii]; // count
      time_sum += walk.history[ii+1]; // time
      time_max = max(time_max, walk.history[ii+1]);
      let dmem = walk.history[ii+2];
      dmem_max_value = max(dmem_max_value, dmem);
      dmem_min = min(dmem_min, dmem);
      dmem_max = max(dmem_max, dmem);
    }
  }
  if (!count_sum) {
    return true;
  }
  let over = mouseover_elem[walk.id] === 1;
  let parent_over = mouseover_elem[walk.id] === 2;
  if (do_ui) {
    if (input.click({ x: 0, y, w: line_width, h: LINE_HEIGHT, button: 0 })) {
      walk.toggleShowChildren();
    } else if (input.click({ x: 0, y, w: line_width, h: LINE_HEIGHT, button: 1 })) {
      walk.parent.toggleShowChildren();
    }
  }

  // Draw background
  let color_top = over ? color_bar_over : parent_over ? color_bar_parent : color_bar;
  let color_bot = over ? color_bar_over2 : parent_over ? color_bar_parent2 : color_bar2;
  ui.drawRect4Color(0, y, line_width, y + LINE_HEIGHT, Z_BAR,
    color_top, color_top, color_bot, color_bot);

  // Draw bar graph
  let x = bar_x0;
  let offs = 1 + settings.profiler_graph;
  let graph_max = settings.profiler_graph ? GRAPH_MAX_MEM : GRAPH_FRAME_TIME;
  for (let ii = 0; ii < HIST_SIZE; ++ii) {
    let value = walk.history[(history_index + ii*HIST_COMPONENTS) % HIST_TOT + offs];
    if (value > 0) {
      let hv = value / graph_max;
      let h = min(hv * LINE_HEIGHT, LINE_HEIGHT);
      if (hv < 1) {
        color_timing[0] = hv;
        color_timing[1] = 1;
      } else {
        color_timing[0] = 1;
        color_timing[1] = max(0, 2 - hv);
      }
      let color = walk.color_override || color_timing;
      let elem = ui.drawRect(x + ii*bar_w, y + LINE_HEIGHT - h, x + (ii + 1)*bar_w, y + LINE_HEIGHT, Z_GRAPH, color);
      elem.x = elem.y = 0; // no sorting by x/y required
    }
  }

  y += LINE_YOFFS;

  let prefix;
  if (hasActiveChildren(walk)) {
    if (!walk.show_children) {
      prefix = '▶'; // '+';
    } else {
      prefix = '▼'; // '-';
    }
  }
  let percent = 0;
  if (settings.profiler_relative === 1) {
    // "% of parent"
    if (walk.parent) {
      if (do_average) {
        percent = (time_sum/HIST_SIZE) / profilerAvgTime(walk.parent);
      } else {
        percent = walk.history[show_index_time] / walk.parent.history[show_index_time];
      }
    }
  } else if (settings.profiler_relative === 3) {
    // % of meme
    if (do_average) {
      percent = dmem_max / total_frame_mem;
    } else {
      percent = walk.history[show_index_mem] / total_frame_mem;
    }
  } else {
    if (do_average) {
      percent = (time_sum/HIST_SIZE) / total_frame_time;
    } else {
      percent = walk.history[show_index_time] / total_frame_time;
    }
  }
  x = depth * FONT_SIZE;
  if (prefix) {
    font.drawSized(null, x - 16, y, Z_TREE, FONT_SIZE, prefix);
  }
  x += FONT_SIZE*2;
  font.drawSizedAligned(style_percent, x, y + number_yoffs, Z_NUMBER, font_size_number, font.ALIGN.HRIGHT, 0, 0,
    `${(percent * 100).toFixed(0)}%`);
  x += 4;
  font.drawSized(style_name, x, y, Z_NAMES, FONT_SIZE,
    walk.name);

  x = COL_X[1];
  let ms = do_average ? time_sum / sum_count : walk.history[show_index_time];
  let count = do_average ? (count_sum / sum_count).toFixed(0) : walk.history[show_index_count];
  font.drawSizedAligned(style_ms, x, y + number_yoffs, Z_MS, font_size_number, font.ALIGN.HRIGHT, MS_W, 0,
    (ms*1000).toFixed(0));
  x += MS_W + 4;
  font.drawSizedAligned(style_number, x, y + number_yoffs, Z_NUMBER, font_size_number, font.ALIGN.HFIT, COUNT_W, 0,
    `(${count})`);

  x = COL_X[2];
  let spike = (time_max * 0.25 > (time_sum / sum_count));
  font.drawSizedAligned(spike ? style_time_spike : style_ms, x, y + number_yoffs, Z_MS, font_size_number,
    font.ALIGN.HRIGHT, COL_W[2], 0,
    (time_max*1000).toFixed(0));

  if (show_mem) {
    x = COL_X[3];

    if (dmem_min < 0) {
      // Had a GC
      font.drawSizedAligned(style_time_spike, x, y + number_yoffs, Z_MS, font_size_number,
        font.ALIGN.HLEFT|font.ALIGN.HFIT, MEM_W/2, 0,
        `${friendlyBytes(-dmem_min)}`);
      font.drawSizedAligned(style_mem, x + MEM_W/2, y + number_yoffs, Z_MS, font_size_number,
        font.ALIGN.HRIGHT|font.ALIGN.HFIT, MEM_W/2, 0,
        `${do_average ? dmem_max : walk.history[show_index_mem]}`);
    } else {
      // Just increase
      font.drawSizedAligned(style_mem, x, y + number_yoffs, Z_MS, font_size_number, font.ALIGN.HRIGHT, MEM_W, 0,
        `${do_average ? dmem_max : walk.history[show_index_mem]}`);
    }
  }

  y += FONT_SIZE + LINE_YOFFS;
  if (!walk.show_children) {
    return false;
  }
  return true;
}

function doZoomedGraph() {
  if (settings.profiler_graph) {
    perf_graph.line_scale_top = GRAPH_MAX_MEM;
    if (!mouseover_main_elem) {
      mouseover_main_elem = profilerNodeTick();
    }
  } else if (!mouseover_main_elem || mouseover_main_elem === node_out_of_tick) {
    perf_graph.line_scale_top = GRAPH_FRAME_TIME * 2;
  } else {
    perf_graph.line_scale_top = GRAPH_FRAME_TIME;
  }
  let offs = 1 + settings.profiler_graph;
  if (mouseover_main_elem) {
    let elem = mouseover_main_elem;
    for (let ii = 0; ii < HIST_SIZE; ++ii) {
      perf_graph.data.history[ii*2] = elem.history[ii*HIST_COMPONENTS + offs];
      perf_graph.data.history[ii*2+1] = 0;
    }
  } else {
    for (let ii = 0; ii < HIST_SIZE; ++ii) {
      let idx = ii*HIST_COMPONENTS + offs;
      perf_graph.data.history[ii*2] = root.history[idx] - node_out_of_tick.history[idx];
      perf_graph.data.history[ii*2+1] = node_out_of_tick.history[idx];
    }
  }
  perf_graph.data.index = history_index/HIST_COMPONENTS;
  perfGraphOverride(perf_graph);
}

const BUTTON_W = 140;
const BUTTON_H = 48;
const BUTTON_FONT_HEIGHT = 24;
let mouse_pos = vec2();
function profilerUIRun() {
  profilerStart('profilerUIRun');
  profilerStart('top+buttons');
  if (engine.render_width) {
    let scale = FONT_SIZE / ui.font_height;
    camera2d.set(0, 0, scale * engine.render_width, scale * engine.render_height);
    font_number_scale = 1;
    bar_w = scale;
  } else {
    camera2d.setScreen();
    font_number_scale = 0.9;
    bar_w = 2;
  }
  bar_x0 = COL_X[1] - HIST_SIZE*bar_w;
  font_size_number = FONT_SIZE * font_number_scale;
  number_yoffs = (FONT_SIZE - font_size_number) / 2;

  if (profilerMemDepthGet() !== settings.profiler_mem_depth) {
    // First time opening the UI this session, restore previous mem_depth values
    profilerMemDepthSet(settings.profiler_mem_depth);
  }

  if (loaded_profile) {
    history_index = loaded_profile.history_index;
    show_mem = loaded_profile.mem_depth > 0;
  } else {
    history_index = profilerHistoryIndex();
    show_mem = HAS_MEMSIZE;
  }
  line_width = show_mem ? LINE_WIDTH_WITH_MEM : LINE_WIDTH_NO_MEM;

  let z = Z.PROFILER + 10;
  y = 0;
  let x = line_width;
  if (ui.buttonText({
    x, y, z,
    w: BUTTON_W, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
    text: settings.profiler_interactable ? 'interactable' : 'overlay',
  })) {
    settings.set('profiler_interactable', 1 - settings.profiler_interactable);
  }
  do_ui = settings.profiler_interactable;
  if (do_ui && ui.buttonText({
    x: x + BUTTON_W, y, z,
    w: BUTTON_H, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
    text: 'X',
  })) {
    settings.set('show_profiler', 0);
  }
  y += BUTTON_H;

  let text = loaded_profile ? 'loaded' : profilerPaused() ? 'paused' : 'live';
  if (do_ui) {
    if (ui.buttonText({
      x, y, z,
      w: BUTTON_W, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
      text,
    })) {
      if (loaded_profile) {
        useLiveProfile();
      } else {
        profilerPause(!profilerPaused());
      }
    }
  } else {
    font.drawSizedAligned(null, x, y, z, FONT_SIZE, font.ALIGN.HVCENTERFIT, BUTTON_W, BUTTON_H, text);
  }
  y += BUTTON_H;

  if (do_ui) {
    if (ui.buttonText({
      x, y, z,
      w: BUTTON_W, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
      text: PROFILER_RELATIVE_LABELS[settings.profiler_relative],
    })) {
      settings.set('profiler_relative', (settings.profiler_relative + 1) % PROFILER_RELATIVE_LABELS.length);
    }
  } else {
    font.drawSizedAligned(null, x, y, z, FONT_SIZE, font.ALIGN.HVCENTERFIT, BUTTON_W, BUTTON_H,
      PROFILER_RELATIVE_LABELS[settings.profiler_relative]);
  }
  y += BUTTON_H;

  if (do_ui) {
    if (ui.buttonText({
      x, y, z,
      w: BUTTON_W, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
      text: settings.profiler_average ? 'average' : 'last frame',
    })) {
      settings.set('profiler_average', 1 - settings.profiler_average);
    }
  } else {
    font.drawSizedAligned(null, x, y, z, FONT_SIZE, font.ALIGN.HVCENTERFIT, BUTTON_W, BUTTON_H,
      settings.profiler_average ? 'average' : 'last frame');
  }
  y += BUTTON_H;

  if (do_ui) {
    if (ui.buttonText({
      x, y, z,
      w: BUTTON_W, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
      text: settings.profiler_graph ? 'graph: mem' : 'graph: CPU',
    })) {
      settings.set('profiler_graph', 1 - settings.profiler_graph);
    }
  } else {
    font.drawSizedAligned(null, x, y, z, FONT_SIZE, font.ALIGN.HVCENTERFIT, BUTTON_W, BUTTON_H,
      settings.profiler_graph ? 'graph: mem' : 'graph: CPU');
  }
  y += BUTTON_H;

  if (loaded_profile ? true : HAS_MEMSIZE) {
    let cur_depth = loaded_profile ? loaded_profile.mem_depth : profilerMemDepthGet();
    font.drawSizedAligned(null, x, y, z, FONT_SIZE, font.ALIGN.HVCENTERFIT, BUTTON_W, LINE_HEIGHT,
      'Mem Depth');
    y += LINE_HEIGHT;
    if (do_ui) {
      if (ui.buttonText({
        x, y, z,
        w: BUTTON_W/3, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
        text: '-',
        disabled: loaded_profile || cur_depth === 0,
      })) {
        profilerMemDepthSet(cur_depth - 1);
        settings.set('profiler_mem_depth', profilerMemDepthGet());
      }
      if (ui.buttonText({
        x: x + BUTTON_W/3, y, z,
        w: BUTTON_W/3, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
        text: `${cur_depth || 'OFF'}`,
        disabled: loaded_profile,
      })) {
        if (cur_depth === MEM_DEPTH_DEFAULT) {
          profilerMemDepthSet(99);
        } else {
          profilerMemDepthSet(MEM_DEPTH_DEFAULT);
        }
        settings.set('profiler_mem_depth', profilerMemDepthGet());
      }
      if (ui.buttonText({
        x: x + 2*BUTTON_W/3, y, z,
        w: BUTTON_W/3, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
        text: '+',
        disabled: loaded_profile,
      })) {
        profilerMemDepthSet(cur_depth + 1);
        settings.set('profiler_mem_depth', profilerMemDepthGet());
      }
    } else {
      font.drawSizedAligned(null, x, y, z, FONT_SIZE, font.ALIGN.HVCENTERFIT, BUTTON_W, BUTTON_H,
        `${cur_depth || 'OFF'}`);
    }
    y += BUTTON_H;
  }

  font.drawSizedAligned(null, x, y, z, FONT_SIZE, font.ALIGN.HVCENTERFIT, BUTTON_W, LINE_HEIGHT,
    `${loaded_profile ? loaded_profile.calls : profilerTotalCalls()} calls`);
  y += LINE_HEIGHT;

  if (ui.buttonText({
    x, y, z,
    w: BUTTON_W/2, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
    text: 'save',
    disabled: loaded_profile,
  })) {
    // Note: doesn't work in IE, but we probably don't care
    let a = document.createElement('a');
    a.href = `data:application/json,${encodeURIComponent(profilerExport())}`;
    a.setAttribute('download', 'profile.json');
    a.click();
  }
  if (ui.buttonText({
    x: x + BUTTON_W/2, y, z,
    w: BUTTON_W/2, h: BUTTON_H, font_height: BUTTON_FONT_HEIGHT,
    text: 'load',
  })) {
    let input_elem = document.createElement('input');
    input_elem.setAttribute('type', 'file');
    let reader = new FileReader();
    reader.onload = () => {
      if (reader.readyState === 2) {
        useSavedProfile(reader.error || reader.result);
      }
    };
    input_elem.onchange = () => {
      reader.readAsText(input_elem.files[0]);
    };
    input_elem.click();
  }
  y += BUTTON_H;

  ui.drawRect(x, 0, x + BUTTON_W, y, z-1, color_bar);

  y = 0;

  font.drawSizedAligned(style_header, COL_X[0], y, z, FONT_SIZE, font.ALIGN.HLEFT, COL_W[0], 0, COL_HEADERS[0]);
  for (let ii = 1; ii < COL_HEADERS.length - (show_mem ? 0 : 1); ++ii) {
    font.drawSizedAligned(style_header, COL_X[ii], y, z, FONT_SIZE, font.ALIGN.HCENTER, COL_W[ii], 0, COL_HEADERS[ii]);
  }
  ui.drawRect(0, y, line_width, y + LINE_HEIGHT, z-1, color_bar_header);
  y += LINE_HEIGHT;

  let y0 = y;

  // first determine mouseover tree
  mouseover_main_elem = null;
  mouseover_bar_idx = -1;
  if (do_ui) {
    mouseover_elem = {};
    profilerWalkTree(root, profilerShowEntryEarly);
    if (mouseover_main_elem) {
      let xx = input.mousePos(mouse_pos)[0] - bar_x0;
      mouseover_bar_idx = floor(xx / bar_w);
      if (mouseover_bar_idx < 0 || mouseover_bar_idx >= HIST_SIZE) {
        mouseover_bar_idx = -1;
      }
      // Just use this one elem's values
      dmem_max_value = 0;
      for (let ii = 0; ii < HIST_TOT; ii+=HIST_COMPONENTS) {
        if (mouseover_main_elem.history[ii]) {
          dmem_max_value = max(dmem_max_value, mouseover_main_elem.history[ii+2]);
        }
      }
    }
  }

  if (dmem_max_value < GRAPH_MAX_MEM * 0.25 || dmem_max_value > GRAPH_MAX_MEM) {
    GRAPH_MAX_MEM = lerp(0.1, GRAPH_MAX_MEM, dmem_max_value);
  }
  dmem_max_value = 0;
  do_average = settings.profiler_average;
  show_index_count = (history_index - HIST_COMPONENTS + HIST_TOT) % HIST_TOT;

  if (mouseover_bar_idx !== -1) {
    // override do_average if the mouse is over a particular frame in the bar graph
    do_average = false;
    show_index_count = (show_index_count - (HIST_SIZE - mouseover_bar_idx - 1) * HIST_COMPONENTS + HIST_TOT) % HIST_TOT;
  }

  show_index_time = show_index_count + 1;
  show_index_mem = show_index_count + 2;

  if (do_average) {
    // use average for percents and timing
    if (settings.profiler_relative === 0) {
      // "% of user"
      total_frame_time = 0;
      let walk = root.child;
      while (walk) {
        if (walk !== node_out_of_tick) {
          total_frame_time += profilerAvgTime(walk);
        }
        walk = walk.next;
      }
      total_frame_time = max(total_frame_time, 0.001);
    } else if (settings.profiler_relative === 2) {
      // "% of frame"
      total_frame_time = profilerAvgTime(root);
    } else if (settings.profiler_relative === 3) {
      total_frame_mem = profilerMaxMem(root);
    }
  } else {
    // use last frame for percents
    if (settings.profiler_relative === 0) {
      // "% of user"
      total_frame_time = 0;
      let walk = root.child;
      while (walk) {
        if (walk !== node_out_of_tick) {
          total_frame_time += walk.history[show_index_time];
        }
        walk = walk.next;
      }
      total_frame_time = max(total_frame_time, 0.001);
    } else if (settings.profiler_relative === 2) {
      // "% of frame"
      total_frame_time = root.history[show_index_time];
    } else if (settings.profiler_relative === 3) {
      total_frame_mem = root.history[show_index_mem];
      if (total_frame_mem < 0) {
        // sum positive children instead, for better estimate
        let walk = root.child;
        total_frame_mem = 0;
        while (walk) {
          total_frame_mem += max(0, walk.history[show_index_mem]);
          walk = walk.next;
        }
      }
    }
  }

  profilerStopStart('interface');

  // then render / do UI
  y = y0;
  profilerWalkTree(root, profilerShowEntry);
  let hint = !loaded_profile && profilerWarning();
  if (hint) {
    font.drawSizedAligned(style_name, FONT_SIZE, y, Z_NAMES, FONT_SIZE,
      font.ALIGN.HVCENTERFIT, line_width - FONT_SIZE*2, LINE_HEIGHT*1.5,
      hint);
    ui.drawRect(0, y,
      line_width, y + LINE_HEIGHT*1.5, Z_NAMES - 0.5,
      color_hint);
  }

  // profilerStopStart('bottom'); // nothing

  if (mouseover_bar_idx !== -1) {
    ui.drawRect(bar_x0 + mouseover_bar_idx * bar_w, y0,
      bar_x0 + (mouseover_bar_idx + 1) * bar_w, y, Z_GRAPH + 0.5,
      color_bar_highlight);
  }

  if (do_ui) {
    // consume mouseover regardless
    input.mouseOver({ x: 0, y: 0, w: line_width, h: y });
  }

  doZoomedGraph();

  profilerStop();
  profilerStop('profilerUIRun');
}

export function profilerUIStartup() {
  ({ font } = ui);
  useLiveProfile();
}

export function profilerUI() {
  if (engine.DEBUG && input.keyUpEdge(input.KEYS.F7)) {
    profilerToggle();
  }
  if (settings.show_profiler) {
    profilerUIRun();
  }
  if (engine.DEBUG || settings.show_profiler) {
    // TODO: warn if more than some number of profiler calls per frame
  }
}

cmd_parse.register({
  cmd: 'profile',
  help: 'Captures a performance profile for developer investigation',
  prefix_usage_with_help: true,
  usage: 'Optionally delays for DELAY seconds before capturing the profile.\n' +
    'Usage: /profile [DELAY]',
  func: function (str, resp_func) {
    function doit() {
      let profile = profilerExport();
      if (netDisconnected()) {
        ui.provideUserString('Profiler Snapshot', profile);
        resp_func();
      } else {
        netClient().send('profile', profile, function (err, data) {
          if (data?.id) {
            ui.provideUserString('Profile submitted', `ID=${data.id}`);
            resp_func(null, `Profile submitted with ID=${data.id}`);
          } else {
            resp_func(err, data);
          }
        });
      }
    }
    if (Number(str)) {
      setTimeout(doit, Number(str) * 1000);
    } else {
      doit();
    }
  },
});
