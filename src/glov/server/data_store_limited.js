const assert = require('assert');

function limit(limit_time, state, fn) {
  function doit() {
    fn(function () {
      state.last_call = Date.now();
    });
  }
  let now = Date.now();
  let time_since = now - (state.last_call || 0);
  if (time_since >= limit_time) {
    doit();
  } else {
    setTimeout(doit, limit_time - time_since);
  }
}

function DataStoreLimited(actual_ds, limit_time, set_delay_time, get_delay_time) {
  this.limit_time = limit_time;
  this.set_delay_time = set_delay_time || 0;
  this.get_delay_time = get_delay_time || 0;
  this.actual_ds = actual_ds;
  this.per_obj_state = {};
}

export function dataStoreLimitedCreate(actual_ds, limit_time, set_delay_time, get_delay_time) {
  return new DataStoreLimited(actual_ds, limit_time, set_delay_time, get_delay_time);
}

DataStoreLimited.prototype.unload = function (obj_name) {
  let state = this.per_obj_state[obj_name];
  if (state && state.next_cbs) { // `next_cbs` is set whenever there is a write in-flight
    state.need_unload = true;
    return;
  }
  delete this.per_obj_state[obj_name];
  this.actual_ds.unload(obj_name);
};

DataStoreLimited.prototype.setAsync = function (obj_name, value, cb) {
  let state = this.per_obj_state[obj_name];
  if (!state) {
    state = this.per_obj_state[obj_name] = {};
  }
  assert(!state.need_unload);
  if (state.next_cbs) {
    state.next_cbs.push(cb);
    state.next_value = value;
    return;
  }
  state.next_value = value;
  state.next_cbs = [cb];
  let self = this;
  function doWrite(done) {
    let cbs = state.next_cbs;
    if (!cbs.length) {
      // next write is ready, nothing queued up, just clean up instead
      if (state.need_unload) {
        self.unload(obj_name);
      }
      delete self.per_obj_state[obj_name];
      return;
    }
    let next_value = state.next_value;
    state.next_cbs = [];
    state.next_value = null;
    state.writing = true;
    setTimeout(function () {
      self.actual_ds.setAsync(obj_name, next_value, function (err) {
        state.writing = false;
        for (let ii = 0; ii < cbs.length; ++ii) {
          cbs[ii](err);
        }
        done();
        limit(self.limit_time, state, doWrite);
      });
    }, self.set_delay_time);
  }
  limit(self.limit_time, state, doWrite);
};

DataStoreLimited.prototype.getAsync = function (obj_name, default_value, cb) {
  let state = this.per_obj_state[obj_name];
  assert(!state || !state.writing && !state.next_cbs.length,
    `Cannot get something that is still being written: ${obj_name}`);
  setTimeout(() => {
    state = this.per_obj_state[obj_name];
    assert(!state || !state.writing && !state.next_cbs.length,
      `Cannot get something that is still being written: ${obj_name}`);
    this.actual_ds.getAsync(obj_name, default_value, cb);
  }, this.get_delay_time);
};

DataStoreLimited.prototype.getAsyncBuffer = function (obj_name, cb) {
  let state = this.per_obj_state[obj_name];
  assert(!state || !state.writing && !state.next_cbs.length,
    `Cannot get something that is still being written: ${obj_name}`);
  setTimeout(() => {
    state = this.per_obj_state[obj_name];
    assert(!state || !state.writing && !state.next_cbs.length,
      `Cannot get something that is still being written: ${obj_name}`);
    this.actual_ds.getAsyncBuffer(obj_name, cb);
  }, this.get_delay_time);
};
