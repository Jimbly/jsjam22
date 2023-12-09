// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* globals Worker */

// Do not require anything significant from this file, so it loads super quickly
// Maybe need to add a separate bootstrap if we need to require much.
import assert from 'assert';
import { webFSGetData, webFSSetToWorkerCB } from './webfs';

let workers = [];

export function numWorkers() {
  return workers.length;
}

let handlers = {};

export const WORKER_ALL = -1;
module.exports.ALL = WORKER_ALL;

// cb(worker_index, data)
export function addHandler(msg, cb) {
  assert(!handlers[msg]);
  handlers[msg] = cb;
}

export function workerCommSendMsg(worker_index, id, data, transfer) {
  if (worker_index === WORKER_ALL) {
    for (let ii = 0; ii < workers.length; ++ii) {
      workerCommSendMsg(ii, id, data);
    }
  } else {
    workers[worker_index].postMessage({ id, data }, transfer);
  }
}
module.exports.sendmsg = workerCommSendMsg;

function workerOnMessage(worker_index, evt) {
  evt = evt.data;
  if (evt instanceof Object && evt.id) {
    profilerStart(`worker:${evt.id}`);
    assert(handlers[evt.id]);
    handlers[evt.id](worker_index, evt.data);
    profilerStop();
  } else {
    console.log('worker_comm (main thread) unhandled message', evt);
  }
}
function workerOnError(e, file, line, col, errorobj) {
  if (!file && e.message && e.filename) {
    window.onerror(e.message, e.filename, e.lineno, e.colno, errorobj || e);
  } else {
    if (String(e) === '[object Event]') {
      window.onerror(`Unknown worker error (${e.message || e.type || e})`, file, line, col, errorobj);
    } else {
      window.onerror(e, file, line, col, errorobj);
    }
  }
}

let debug_names;

function allocWorker(idx, worker_filename) {
  let suffix = debug_names && debug_names[idx] && `#${debug_names[idx]}` || '';
  let worker = new Worker(`${worker_filename || 'worker.bundle.js'}${suffix}`);
  worker.onmessage = workerOnMessage.bind(null, workers.length);
  worker.onerror = workerOnError;
  workers.push(worker);

  if (webFSGetData()) {
    workerCommSendMsg(idx, 'webfs_data', webFSGetData());
  }
}

export function setNumWorkers(max_workers, worker_filename) {
  for (let ii = workers.length; ii < max_workers; ++ii) {
    allocWorker(ii, worker_filename);
  }
}

export let keep_busy = 0;

export function startup(worker_filename, debug_names_in) {
  if (String(document.location).match(/^https?:\/\/localhost/)) {
    debug_names = debug_names_in;
  }
  addHandler('debugmsg', function (source, data) {
    window.debugmsg(data.msg, data.clear);
  });
  addHandler('log', function (source, data) {
    console.log(`[Worker#${source}] ${data}`);
  });
  addHandler('error', function (source, msg) {
    console.error(msg);
    window.onerror(null, null, null, null, msg);
  });
  addHandler('busy_done', function (source) {
    if (source < keep_busy) {
      workerCommSendMsg(source, 'busy', 1000);
    }
  });
  webFSSetToWorkerCB(function (fs) {
    workerCommSendMsg(WORKER_ALL, 'webfs_data', fs);
  });

  allocWorker(0, worker_filename);
}

export function keepBusy(num_workers) {
  for (let ii = keep_busy; ii < num_workers; ++ii) {
    workerCommSendMsg(ii, 'busy', 1000);
  }
  keep_busy = num_workers;
}
