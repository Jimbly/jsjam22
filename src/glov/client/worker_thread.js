// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-env browser */

require('./polyfill.js');

if (!self.profilerStart) {
  self.profilerStart = self.profilerStop = self.profilerStopStart = function () {
    // no profiling in the worker thread
  };
}

import assert from 'assert';
import {
  webFSApplyReload,
  webFSGetData,
  webFSStartup,
} from './webfs.js';

export function sendmsg(id, data, transfer) {
  postMessage({ id, data }, transfer);
}

export function debugmsg(msg, clear) {
  sendmsg('debugmsg', { msg, clear });
}

// Catch errors not happening inside handlers' try/catch
self.addEventListener('error', function (evt) {
  if (evt.error) {
    // Manually "cloning" the Error object, because it's toJSON (or some other
    //   serialization logic) strips the relevant bits on MacOS Safari.
    // Just send the fields we need for bootstrap.js's handling
    sendmsg('error', {
      message: evt.error.message,
      stack: evt.error.stack,
    });
    evt.preventDefault();
  }
});

let handlers = [];
export function addHandler(id, cb) {
  assert(!handlers[id]);
  handlers[id] = cb;
}

let time_work = 0;
let time_idle = 0;
let batch_timing = [];
let last_report_time = Date.now();
let timing_enabled = false;

function reportTiming(now) {
  // end work, start yield/idle
  if (now - last_report_time > 100) {
    let elapsed = time_work + time_idle;
    assert(elapsed <= now - last_report_time + 10); // this happened once, why?
    sendmsg('timing', { time_work, time_idle, elapsed, batches: batch_timing });
    last_report_time = now;
    time_idle = time_work = 0;
    batch_timing.length = 0;
  }
}

let last_work_end = last_report_time;
let last_work_start = 0;
export function startWork() {
  let now = Date.now();
  let idle_time = now - last_work_end;
  if (timing_enabled) {
    batch_timing.push(idle_time);
  }
  time_idle += idle_time;
  last_work_start = now;
}

export function endWork() {
  let now = Date.now();
  last_work_end = now;
  let batch_time = now - last_work_start;
  time_work += batch_time;
  if (timing_enabled) {
    batch_timing.push(batch_time);
    reportTiming(now);
  }
}

self.onmessage = function (evt) {
  // start work, end yield/idle
  startWork();
  evt = evt.data;
  if (evt instanceof Object && evt.id) {
    assert(handlers[evt.id], evt.id);
    try {
      handlers[evt.id](evt.data);
    } catch (e) {
      sendmsg('error', { message: e.message || String(e), stack: e.stack });
    }
  } else {
    console.log('worker (worker thread) unhandled message', evt);
  }
  endWork();
};

addHandler('busy', function (data) {
  let start = Date.now();
  let a = 1;
  let b = 1;
  while (Date.now() - start < data) {
    let c = a + b;
    a = b;
    b = c;
  }
  sendmsg('busy_done', null);
});

addHandler('timing_enable', function (data) {
  timing_enabled = data;
});

addHandler('webfs_data', function (data) {
  if (webFSGetData()) {
    webFSApplyReload(data);
  } else {
    webFSStartup(data);
  }
});

addHandler('assert_now', function () {
  assert(false);
});

addHandler('assert_later', function () {
  setTimeout(function assertLater() {
    assert(false);
  }, 100);
});

addHandler('crash_now', function () {
  let obj = null;
  obj.foo.bar++;
});

addHandler('crash_later', function () {
  setTimeout(function crashLater() {
    let obj = null;
    obj.foo.bar++;
  }, 100);
});

addHandler('reject_now', function () {
  // eslint-disable-next-line no-new
  new Promise((resolve, reject) => {
    reject(new Error('client_worker_reject_now'));
  });
});

sendmsg('log', 'WebWorker communication initialized');
