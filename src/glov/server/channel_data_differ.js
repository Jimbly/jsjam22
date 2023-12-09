const assert = require('assert');
const { max } = Math;
const { typeof2 } = require('glov/common/differ');
const { clone } = require('glov/common/util.js');

function walk(differ, worker, path_pre, data1, data2) {
  let type = typeof2(data1);
  if (type !== typeof2(data2)) {
    // Types changed, probably one is now undefined or null
    worker.setChannelDataBatched(path_pre, data2);
    return;
  }

  if (type === 'object') {
    let seen = Object.create(null);
    for (let key in data1) {
      seen[key] = true;
      // deletes, modifications
      walk(differ, worker, `${path_pre}.${key}`, data1[key], data2[key]);
    }
    for (let key in data2) {
      if (!seen[key]) {
        // additions
        walk(differ, worker, `${path_pre}.${key}`, data1[key], data2[key]);
      }
    }
  } else if (type === 'array') {
    let maxlen = max(data1.length, data2.length);
    for (let ii = 0; ii < maxlen; ++ii) {
      walk(differ, worker, `${path_pre}.${ii}`, data1[ii], data2[ii]);
    }
    if (data2.length < data1.length) {
      worker.setChannelDataBatched(`${path_pre}.length`, data2.length);
    }
  } else {
    // string, number, boolean
    if (data1 !== data2) {
      worker.setChannelDataBatched(path_pre, data2);
    }
  }
}

class ChannelDataDiffer {
  constructor(channel_worker) {
    this.worker = channel_worker;
    this.started = false;
    this.data_pre = null;
  }

  start() {
    // assert(!this.started);
    this.started = true;

    let { worker } = this;
    this.data_pre = clone(worker.data.public);
  }

  end() {
    assert(this.started);

    let { worker } = this;

    // worker.setChannelData('public', worker.data.public);
    assert(!worker.batched_sets);
    walk(this, worker, 'public', this.data_pre, worker.data.public);

    if (worker.batched_sets) { // any were emitted
      worker.setChannelDataBatchedFlush();
    }

    this.reset();
  }

  reset() {
    this.started = false;
    this.data_pre = null;
  }
}

export function channelDataDifferCreate(channel_worker) {
  return new ChannelDataDiffer(channel_worker);
}
