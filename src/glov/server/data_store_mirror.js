const assert = require('assert');
const { deepEqual } = require('glov/common/util.js');
const { getUID } = require('./log.js');

function DataStoreMirror(options) {
  this.readwrite_ds = options.readwrite;
  this.write_ds = options.write;
  if (!options.read_check) {
    // Simply pass through
    this.getAsync = this.readwrite_ds.getAsync.bind(this.readwrite_ds);
    if (this.readwrite_ds.getAsyncBuffer) {
      this.getAsyncBuffer = this.readwrite_ds.getAsyncBuffer.bind(this.readwrite_ds);
    } else {
      // Not supported on this kind of data store (metadata)
      this.getAsyncBuffer = null;
    }
  }
  if (this.readwrite_ds.search) {
    this.search = this.readwrite_ds.search.bind(this.readwrite_ds);
  } else if (this.write_ds.search) {
    this.search = this.write_ds.search.bind(this.write_ds);
  }
}

DataStoreMirror.prototype.unload = function (obj_name) {
  this.readwrite_ds.unload(obj_name);
  this.write_ds.unload(obj_name);
};

const ERR_TIMEOUT_FORCED = 'ERR_TIMEOUT_FORCED';

function DoubleCall(type, obj_name, cb) {
  this.type = type;
  this.obj_name = obj_name;
  this.cb = cb;
  this.left = 2;
  this.err_ret = [];
  this.data_ret = [];
  this.received = [];
  this.uid = getUID();
  this.start = Date.now();
  this.timeout_error = [];
  this.timeout = setTimeout(() => {
    let missing = [];
    let got_rw = this.received[0];
    let got_w = this.received[1];
    if (!got_rw) {
      missing.push('readwrite');
      this.timeout_error[0] = true;
    }
    if (!got_w) {
      missing.push('write-only');
      this.timeout_error[1] = true;
    }
    console.error(`DATASTOREMIRROR(${type}:${this.uid}) Error: No response to ${obj_name}` +
      ` received after 60s from ${missing.join(',')}`);
    if (got_rw && !got_w) {
      console.warn(`DATASTOREMIRROR(${type}:${this.uid}) Error: forcing completion of ${obj_name}`);
      this.onDone(1, ERR_TIMEOUT_FORCED);
    }
  }, 60000);
}
DoubleCall.prototype.onDone = function (idx, err, data) {
  let { received } = this;
  if (err === ERR_TIMEOUT_FORCED) {
    assert(!received[idx]);
    received[idx] = -1;
  } else {
    let dt = Date.now() - this.start;
    if (dt > 15000) {
      let msg = 'Slow response for ' +
        `${idx?'write-only':'readwrite'}:${this.obj_name}` +
        ` (${(dt/1000).toFixed(1)}s elapsed)`;
      if (this.timeout_error[idx]) {
        console.error(`DATASTOREMIRROR(${this.type}:${this.uid}) Finally received ${msg}`);
      } else {
        console.warn(`DATASTOREMIRROR(${this.type}:${this.uid}) ${msg}`);
      }
    }

    if (received[idx]) {
      if (received[idx] === -1) {
        console.error(`DATASTOREMIRROR(${this.type}:${this.uid}) Callback finally called for ${idx}:${this.obj_name}`);
      } else {
        console.error(`DATASTOREMIRROR(${this.type}:${this.uid}) Error Callback ` +
          `called twice for ${idx}:${this.obj_name}`);
      }
      return;
    } else {
      received[idx] = true;
    }
  }
  this.err_ret[idx] = err;
  this.data_ret[idx] = data;
  if (!--this.left) {
    clearTimeout(this.timeout);
    this.cb(this.err_ret, this.data_ret);
  }
};

DataStoreMirror.prototype.setAsync = function (obj_name, value, cb) {
  let wrapped = new DoubleCall('set', obj_name, function (err_ret, data_ret) {
    // Neither is ever expected to error on write
    if (err_ret[0]) {
      console.error(`DATASTOREMIRROR(set:${wrapped.uid}) Write error on readwrite:${obj_name}:`, err_ret[0]);
    }
    if (err_ret[1]) {
      console.error(`DATASTOREMIRROR(set:${wrapped.uid}) Write error on write-only:${obj_name}:`, err_ret[1]);
      if (!err_ret[0]) {
        console.warn(`DATASTOREMIRROR(set:${wrapped.uid}) ...but primary succeeded, returning success`);
      }
    }
    cb(err_ret[0]);
  });
  this.readwrite_ds.setAsync(obj_name, value, wrapped.onDone.bind(wrapped, 0));
  this.write_ds.setAsync(obj_name, value, wrapped.onDone.bind(wrapped, 1));
};

function logMismatch(label, uid, obj_name, ret0, ret1) {
  if (ret0 === 'null' || ret1 === 'null') {
    // one is null, no reason to log verbosely
    if (ret0.length > 83) {
      ret0 = `${ret0.slice(0, 80)}...`;
    }
    if (ret1.length > 83) {
      ret1 = `${ret1.slice(0, 80)}...`;
    }
  }
  console.error(`DATASTOREMIRROR(${label}:${uid}) Data Mismatch on ${obj_name}`);
  console.error(`  readwrite: ${ret0}`);
  console.error(`  write-only: ${ret1}`);
}

DataStoreMirror.prototype.getAsync = function (obj_name, default_value, cb) {
  let wrapped = new DoubleCall('get', obj_name, function (err_ret, data_ret) {
    // Do data checks
    if (Boolean(err_ret[0]) !== Boolean(err_ret[1])) {
      console.error(`DATASTOREMIRROR(get:${wrapped.uid}) Error Mismatch on ${obj_name},` +
        ' err_rw:', err_ret[0], ', err_w:', err_ret[1]);
    } else if (!err_ret[0]) {
      // Both read data, should be identical
      if (!deepEqual(data_ret[0], data_ret[1])) {
        logMismatch('get', wrapped.uid, obj_name, JSON.stringify(data_ret[0]), JSON.stringify(data_ret[1]));
      }
    }

    // Trust readwrite_ds and return to caller
    cb(err_ret[0], data_ret[0]);
  });

  this.readwrite_ds.getAsync(obj_name, default_value, wrapped.onDone.bind(wrapped, 0));
  this.write_ds.getAsync(obj_name, default_value, wrapped.onDone.bind(wrapped, 1));
};

DataStoreMirror.prototype.getAsyncBuffer = function (obj_name, cb) {
  let wrapped = new DoubleCall('get(buffer)', obj_name, function (err_ret, data_ret) {
    // Do data checks
    if (Boolean(err_ret[0]) !== Boolean(err_ret[1])) {
      console.error(`DATASTOREMIRROR(get(buffer):${wrapped.uid}) Error Mismatch on ${obj_name}, err_rw:`,
        err_ret[0], ', err_w:', err_ret[1]);
    } else if (!err_ret[0]) {
      // Both read data, should be identical
      if (!data_ret[0] && !data_ret[1]) {
        // both are null
      } else if (!data_ret[0] || !data_ret[1] || data_ret[0].compare(data_ret[1]) !== 0) {
        logMismatch('get(buffer)', wrapped.uid, obj_name,
          JSON.stringify(data_ret[0] ? data_ret[0].toString() : data_ret[0]),
          JSON.stringify(data_ret[1] ? data_ret[1].toString() : data_ret[1])
        );
      }
    }

    // Trust readwrite_ds and return to caller
    cb(err_ret[0], data_ret[0]);
  });
  this.readwrite_ds.getAsyncBuffer(obj_name, wrapped.onDone.bind(wrapped, 0));
  this.write_ds.getAsyncBuffer(obj_name, wrapped.onDone.bind(wrapped, 1));
};

export function dataStoreMirrorCreate(options) {
  return new DataStoreMirror(options);
}
