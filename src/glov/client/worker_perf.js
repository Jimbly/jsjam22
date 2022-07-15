// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const camera2d = require('./camera2d.js');
const { cmd_parse } = require('./cmds.js');
const engine = require('./engine.js');
const { max } = Math;
const settings = require('./settings.js');
const ui = require('./ui.js');
const { vec4 } = require('glov/common/vmath.js');
const worker_comm = require('./worker_comm.js');
const { addHandler, keepBusy, numWorkers, sendmsg } = worker_comm;

const PERF_HISTORY_SIZE = 256;

let per_worker_graph = [];

let colors = [
  vec4(0,0,0, 0.75), // idle time
  vec4(0.161, 0.678, 1.000, 1), // work time #1
  vec4(1.000, 0.639, 0.000, 1), // work time #2 // vec4(0.514, 0.463, 0.612, 1)
  vec4(1.000, 0.467, 0.659, 1), // work time #3
];

const LINE_PAD = 1;
const LINE_HEIGHT = 32;
const BAR_SCALE = 4/16; // roughly flows at the same rate as fps_graph, if running at 60fps

let bg_unknown = vec4(0,0,0,0.5);

function drawGraph(y, graph) {
  let w = 507; // matching perf.js
  let x = camera2d.x1Real() - LINE_PAD;
  let x0 = x - w;
  let z = Z.FPSMETER;
  y -= LINE_PAD;
  ui.drawRect(x0, y - LINE_HEIGHT, x + w, y, z++, bg_unknown);
  let xoffs = (engine.frame_timestamp - graph.last_update) * BAR_SCALE;
  x -= xoffs;
  for (let ii = 1; ii < PERF_HISTORY_SIZE; ++ii) {
    if (x <= x0) {
      break;
    }
    let idx = (graph.index - ii + PERF_HISTORY_SIZE) % PERF_HISTORY_SIZE;
    let type = graph.type[idx];
    let time = graph.time[idx];
    if (!time) {
      continue;
    }
    let color = colors[type];
    let bar_w = max(1, time * BAR_SCALE);
    if (!type) {
      ui.drawRect(max(x0, x - bar_w), y - LINE_HEIGHT * 0.75, x, y - LINE_HEIGHT * 0.25, z, color);
    } else {
      ui.drawRect(max(x0, x - bar_w), y - LINE_HEIGHT, x, y, z, color);
    }
    x -= bar_w;
  }

  y -= LINE_HEIGHT;
  return y;
}

function tickWorkerPerf() {
  if (!settings.worker_graph) {
    return;
  }
  camera2d.setAspectFixed(engine.game_width, engine.game_height);
  let y_graph = camera2d.y1Real();
  if (settings.fps_graph) {
    y_graph -= 128 + 2;
  }
  for (let ii = 0; ii < per_worker_graph.length; ++ii) {
    y_graph = drawGraph(y_graph, per_worker_graph[ii]);
  }
}

function onTiming(source, data) {
  let graph = per_worker_graph[source];
  if (!graph) {
    // Not graphing it
    console.log(`[Worker${source}] ${(data.time_work * 100 / data.elapsed).toFixed().padStart(2)}% work` +
      ` ${(data.time_idle * 100 / data.elapsed).toFixed().padStart(2)}% idle (${data.batches.length / 2} batches)`);
    return;
  }

  let { batch_idx, index } = graph;
  for (let ii = 0; ii < data.batches.length;) {
    graph.type[index] = 0;
    graph.time[index++] = data.batches[ii++];
    graph.type[index] = batch_idx + 1;
    graph.time[index++] = data.batches[ii++];
    batch_idx = (batch_idx + 1) % 3;
    index %= PERF_HISTORY_SIZE;
  }
  graph.batch_idx = batch_idx;
  graph.index = index;
  graph.last_update = engine.frame_timestamp;
}

export function startup() {
  settings.register({
    worker_graph: {
      default_value: 0,
      type: cmd_parse.TYPE_INT,
      range: [0,1],
    },
  });
  cmd_parse.registerValue('worker_busy', {
    type: cmd_parse.TYPE_INT,
    label: 'Worker Busy',
    range: [0,8],
    get: () => worker_comm.keep_busy,
    set: keepBusy,
    access_show: ['hidden'],
  });

  for (let ii = 0; ii < numWorkers(); ++ii) {
    per_worker_graph[ii] = {
      index: 0,
      batch_idx: 0,
      last_update: 0,
      type: new Uint8Array(PERF_HISTORY_SIZE),
      time: new Float32Array(PERF_HISTORY_SIZE),
    };
  }

  addHandler('timing', onTiming);
  for (let ii = 0; ii < numWorkers(); ++ii) {
    sendmsg(ii, 'timing_enable', true);
  }
  engine.addTickFunc(tickWorkerPerf);
}
