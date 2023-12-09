// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export let perf_mem_counters = {};

/* eslint-disable import/order */
const engine = require('./engine.js');
let metrics = [];
export function addMetric(metric, first) {
  if (metric.show_graph) {
    metric.num_lines = metric.colors.length;
    metric.history_size = metric.data.history.length / metric.num_lines;
  }
  metric.num_labels = Object.keys(metric.labels).length;
  if (metric.interactable === undefined) {
    metric.interactable = engine.DEBUG && (metric.num_labels > 1 && !metric.show_all || metric.show_graph);
  }
  if (first) {
    metrics.splice(0, 0, metric);
  } else {
    metrics.push(metric);
  }
}


const camera2d = require('./camera2d.js');
const { cmd_parse } = require('./cmds.js');
const glov_font = require('./font.js');
const input = require('./input.js');
const { max } = Math;
const { netClient, netClientId, netDisconnected } = require('./net.js');
const { perfCounterHistory } = require('glov/common/perfcounters.js');
const { profilerUI } = require('./profiler_ui.js');
const settings = require('./settings.js');
const { spriteChainedStart, spriteChainedStop } = require('./sprites.js');
const ui = require('./ui.js');
const { uiTextHeight } = require('./ui.js');
const { vec4, v3copy } = require('glov/common/vmath.js');
require('./perf_net.js');

const METRIC_PAD = 2;

let bg_default = vec4(0,0,0,0.5);
let bg_mouse_over = vec4(0,0,0,0.75);
let bg_fade = vec4();

// referenced in engine.js
settings.register({
  show_metrics: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
  show_fps: {
    label: 'Show FPS',
    default_value: engine.DEBUG ? 1 : 0,
    type: cmd_parse.TYPE_INT,
    enum_lookup: {
      OFF: 0,
      ON: 1,
      MSPF: 2,
      CPU: 3,
      GC: 4,
    }
  },
  fps_graph: {
    label: 'FPS Graph',
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
  fps_window: {
    label: 'FPS Time Window (seconds)',
    default_value: 1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0.001, 120],
  },
  show_perf_counters: {
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
  show_perf_memory: {
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    access_run: ['sysadmin'], // only fetches from server, currently
  },
  perf_provider: {
    default_value: 'client',
    type: cmd_parse.TYPE_STRING,
    usage: 'Set the perf provider for /show_perf_counters and /show_perf_memory\n' +
      '  CLIENT : show client values\n' +
      '  AUTO : automatically determine appropriate server\n' +
      '  user.1234 : use server hosting a particular worker',
    access_run: ['sysadmin'],
  },
});

cmd_parse.register({
  cmd: 'fps',
  help: 'Toggles FPS display',
  func: function (str, resp_func) {
    if (settings.show_fps && settings.show_metrics || str === '0') {
      settings.set('show_fps', 0);
    } else {
      settings.set('show_fps', 1);
      settings.set('show_metrics', 1);
    }
    resp_func();
  },
});

let fps_style = glov_font.style({
  outline_width: 2, outline_color: 0x00000080,
  color: 0xFFFFFFff,
});

function friendlyUnit(table, value) {
  let unit = 0;
  while (unit < table.length - 1 && value >= table[unit+1][0]) {
    unit++;
  }
  if (unit === 0) {
    return `${value} ${table[unit][1]}`;
  }
  return `${(value/table[unit][0]).toFixed(2)} ${table[unit][1]}`;
}
const UNIT_BYTES = [
  [1, 'bytes'],
  [1024, 'KB'],
  [1024*1024, 'MB'],
  [1024*1024*1024, 'GB'],
];
const UNIT_COUNT = [
  [1, ''],
  [1000, 'k'],
  [1000*1000, 'm'],
  [1000*1000*1000, 'g'],
];
export function friendlyBytes(bytes) {
  return friendlyUnit(UNIT_BYTES, bytes);
}
function friendlyCount(count) {
  return friendlyUnit(UNIT_COUNT, count);
}

function showMetric(y, metric) {
  let font = engine.font;
  let pad = METRIC_PAD;
  let font_height = uiTextHeight();
  let line_height = settings.render_scale_all < 1 ? font_height / settings.render_scale_all : font_height;
  let METRIC_VALUE_WIDTH = line_height * (metric.width || 2.5);
  let x = camera2d.x1Real() - METRIC_VALUE_WIDTH - pad;
  let y0 = y;
  y += pad;
  let max_label_w = 0;
  let max_labels = metric.show_all ? Infinity : settings[metric.show_stat];
  let drew_any = false;
  let alpha = 1;
  for (let label in metric.labels) {
    let value = metric.labels[label]();
    if (value) {
      let style = fps_style;
      if (value.alpha) {
        alpha = value.alpha;
        value = value.value;
        style = glov_font.styleAlpha(fps_style, alpha);
      }
      let label_w = font.drawSizedAligned(style, x, y, Z.FPSMETER + 3, line_height,
        glov_font.ALIGN.HRIGHT, 0, 0, label);
      max_label_w = max(max_label_w, label_w);
      font.drawSizedAligned(style, x, y, Z.FPSMETER + 3, line_height,
        glov_font.ALIGN.HFIT, METRIC_VALUE_WIDTH, 0, value);
      y += line_height;
      drew_any = true;
    }
    if (!--max_labels) {
      break;
    }
  }
  let w = METRIC_VALUE_WIDTH + max_label_w + METRIC_PAD;
  x -= max_label_w + METRIC_PAD;

  if (!drew_any) {
    return y - pad;
  }

  y += pad;
  let bg = bg_default;
  let pos_param = {
    x: x - pad,
    y: y0,
    w: w + pad * 2,
    h: y - y0,
  };
  if (metric.interactable) {
    if (input.mouseUpEdge(pos_param)) {
      if (metric.num_labels > 1 && settings[metric.show_stat] <= 1) {
        settings.set(metric.show_stat, metric.num_labels);
      } else if (metric.show_graph && !settings[metric.show_graph]) {
        settings.set(metric.show_graph, 1);
      } else {
        if (metric.show_graph) {
          settings.set(metric.show_graph, 0);
        }
        settings.set(metric.show_stat, 1);
      }
    }
    if (input.mouseOver(pos_param)) {
      bg = bg_mouse_over;
    }
  }
  if (alpha !== 1) {
    bg_fade[3] = bg[3] * alpha;
    bg = v3copy(bg_fade, bg);
  }
  ui.drawRect(pos_param.x, pos_param.y, pos_param.x + pos_param.w, y, Z.FPSMETER+2, bg);
  return y;
}

function showMetricGraph(y, metric) {
  const small = engine.game_height < 300;
  const LINE_WIDTH = small ? 1 : 3;
  const LINE_PAD = small ? 0 : 1;
  const LINE_HEIGHT = small ? 64 : 128;
  const NUM_LINES = metric.history_size - 1;
  let w = (LINE_WIDTH + LINE_PAD) * NUM_LINES;
  let x = camera2d.x1Real() - w;
  let h = LINE_HEIGHT + LINE_PAD * 2;
  let z = Z.FPSMETER;
  spriteChainedStart();
  ui.drawRect(x, y - h, x + w, y, z++, bg_default);
  x += LINE_PAD;
  y -= LINE_PAD;
  let history_index = metric.data.index;
  let line_scale = LINE_HEIGHT / metric.line_scale_top;
  for (let ii = 0; ii < NUM_LINES; ii++) {
    let line_index = ((ii + history_index + 1) % metric.history_size) * metric.num_lines;
    let data = metric.data.history;
    let bar_max = 0;
    for (let jj = 0; jj < metric.num_lines; jj++) {
      let line_jj = data[line_index + jj];
      let bar_min;
      if (metric.bars_stack) {
        bar_min = bar_max;
        bar_max += line_jj;
      } else {
        // bars overlap, figure out how big this bar should be relative to next smallest
        let lesser = 0;
        for (let kk = 0; kk < metric.num_lines; kk++) {
          if (kk === jj) {
            continue;
          }
          let line_kk = data[line_index + kk];
          if ((line_kk < line_jj || line_kk === line_jj && kk < jj) && line_kk > lesser) {
            lesser = line_kk;
          }
        }
        bar_min = lesser;
        bar_max = line_jj;
      }
      let color = metric.colors[jj];
      ui.drawRect(x, y - bar_max * line_scale, x + LINE_WIDTH, y - bar_min * line_scale, z, color);
    }
    x += LINE_WIDTH + LINE_PAD;
  }
  z += NUM_LINES;
  y -= LINE_HEIGHT + LINE_PAD;
  spriteChainedStop();
  return y;
}

function perfDefaultAutoChannel() {
  let client_id = netClientId();
  if (client_id) {
    return `client.${client_id}`;
  }
  return null;
}
let auto_channel_cb = perfDefaultAutoChannel;
export function perfSetAutoChannel(cb) {
  auto_channel_cb = cb;
}
const PERF_NET_CACHE_TIME = 10000;
const PERF_NET_CACHE_TIME_MEM = 2500;
let perf_provider_data = {
  last_update: -Infinity,
  data: null,
};
function updatePerfProvider() {
  let cache_time = PERF_NET_CACHE_TIME;
  let fields = {
  };
  if (settings.show_perf_counters) {
    fields.counters = 1;
  }
  if (settings.show_perf_memory) {
    fields.memory = 1;
    cache_time = PERF_NET_CACHE_TIME_MEM;
  }
  let provider = settings.perf_provider.toLowerCase();
  if (provider === 'client') {
    let ret = {
      source: 'client',
    };
    if (fields.counters) {
      ret.counters = perfCounterHistory();
    }
    if (fields.memory) {
      ret.memory = perf_mem_counters;
    }
    return ret;
  }
  // Fetch from server
  if (perf_provider_data.in_flight || netDisconnected()) {
    return perf_provider_data.data;
  }
  let now = engine.frame_timestamp;
  if (now - perf_provider_data.last_update < cache_time) {
    return perf_provider_data.data;
  }
  let channel_id;
  if (provider === 'auto') {
    channel_id = auto_channel_cb();
  } else if (provider.match(/^[^.]+\.[^.]+$/)) { // seemingly valid channel ID
    channel_id = provider;
  }
  if (channel_id) {
    perf_provider_data.in_flight = true;
    netClient().send('perf_fetch', { channel_id, fields }, null, function (err, data) {
      if (err) {
        console.error(`Error getting perf data: ${Object.keys(fields)}: ${err}`);
      }
      perf_provider_data.data = data;
      perf_provider_data.last_update = engine.frame_timestamp;
      perf_provider_data.in_flight = false;
    });
  }
  return perf_provider_data.data;
}

function perfMemObjToLines(out, obj, prefix) {
  for (let key in obj) {
    let v = obj[key];
    if (v && typeof v === 'object') {
      perfMemObjToLines(out, v, `${prefix}${key}.`);
    } else {
      if (typeof v === 'number') {
        if (key.endsWith('bytes') || prefix.includes('data_size')) {
          v = friendlyBytes(v);
        } else {
          v = friendlyCount(v);
        }
      }
      out.push(`${prefix}${key}: ${v}`);
    }
  }
}

let graph_override = null;
// `override` is like a `metric` passed to addMetric.  Contains:
// history_size
// num_lines
// data: { history[history_size * num_lines], index }
// line_scale_top
// bars_stack : boolean
// colors : vec4[]
export function perfGraphOverride(override) {
  graph_override = override;
}

export function draw() {
  camera2d.push();
  profilerUI();
  camera2d.setAspectFixed(engine.game_width, engine.game_height);
  if (settings.show_metrics) {
    let y = camera2d.y0Real();
    let y_graph = camera2d.y1Real();
    if (graph_override) {
      y_graph = showMetricGraph(y_graph, graph_override);
      y_graph -= METRIC_PAD;
    }
    for (let ii = 0; ii < metrics.length; ++ii) {
      let metric = metrics[ii];
      if (settings[metric.show_stat]) {
        y = showMetric(y, metric);
        y += METRIC_PAD;
      }
      if (!graph_override && settings[metric.show_graph]) {
        y_graph = showMetricGraph(y_graph, metric);
        y_graph -= METRIC_PAD;
      }
    }
  }
  if (settings.show_perf_counters || settings.show_perf_memory) {
    let font = engine.font;
    let perf_data = updatePerfProvider() || {};
    let y = camera2d.y0Real();
    let y0 = y;
    let font_height = uiTextHeight();
    let line_height = settings.render_scale_all < 1 ? font_height / settings.render_scale_all : font_height;
    let column_width = line_height * 6;
    let x0 = camera2d.x0Real();
    let x = x0 + column_width * 2;
    let maxx = x + column_width;
    let z = Z.FPSMETER + 1;
    let header_x = x0 + column_width;
    if (perf_data.source) {
      font.drawSized(fps_style, header_x, y, z, line_height, `Source: ${perf_data.source}`);
      y += line_height;
    }
    if (perf_data.log) {
      let w = camera2d.wReal() *0.67;
      maxx = max(maxx, header_x + w);
      y += font.drawSizedWrapped(fps_style, header_x, y, z, w, 20, line_height, perf_data.log) + 4;
    }

    if (perf_data.memory && settings.show_perf_memory) {
      let lines = [];
      perfMemObjToLines(lines, perf_data.memory, '');
      for (let ii = 0; ii < lines.length; ++ii) {
        font.drawSized(fps_style, x, y, z, line_height, lines[ii]);
        y += line_height;
      }
    }

    if (perf_data.counters && settings.show_perf_counters) {
      let hist = perf_data.counters || [];
      let by_key = {};
      for (let ii = 0; ii < hist.length; ++ii) {
        let set = hist[ii];
        for (let key in set) {
          by_key[key] = by_key[key] || [];
          by_key[key][ii] = set[key];
        }
      }
      let keys = Object.keys(by_key);
      keys.sort();
      for (let ii = 0; ii < keys.length; ++ii) {
        let key = keys[ii];
        let data = by_key[key];
        font.drawSizedAligned(fps_style, x - column_width * 2, y, z, line_height,
          glov_font.ALIGN.HRIGHT|glov_font.ALIGN.HFIT, column_width * 2, 0, `${key}: `);
        for (let jj = 0; jj < data.length; ++jj) {
          if (data[jj]) {
            font.drawSizedAligned(fps_style, x + column_width * jj, y, z, line_height,
              glov_font.ALIGN.HFIT, column_width, 0, `${data[jj]} `);
          }
        }
        maxx = max(maxx, x + column_width * data.length);
        y += line_height;
      }
    }
    ui.drawRect(x0, y0, maxx, y, z - 0.1, bg_default);
  }
  camera2d.pop();
  graph_override = null;
}
