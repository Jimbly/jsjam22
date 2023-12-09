const assert = require('assert');
const gb = require('glov-build');
const yaml = require('js-yaml');
const { hsvToRGB } = require('../src/glov/client/hsv.js');

// Handles the reading from YAML and writing to JSON so that the caller need
//   only provide an Object -> Object verification / transform function.

function roundColor(v) {
  return Number(v.toFixed(3));
}

function procColor(obj) {
  if (!obj) {
    return obj;
  }
  if (Array.isArray(obj)) {
    for (let ii = 0; ii < obj.length; ++ii) {
      obj[ii] = procColor(obj[ii]);
    }
  } else if (typeof obj === 'object') {
    for (let key in obj) {
      obj[key] = procColor(obj[key]);
    }
  } else if (typeof obj === 'string') {
    let m;
    let r;
    let g;
    let b;
    let a;
    if (obj.match(/^#[0-9a-fA-F]{6}$/)) {
      r = parseInt(obj.slice(1, 3), 16) / 255;
      g = parseInt(obj.slice(3, 5), 16) / 255;
      b = parseInt(obj.slice(5, 7), 16) / 255;
      a = 1;
    } else if (obj.match(/^#[0-9a-fA-F]{8}$/)) {
      r = parseInt(obj.slice(1, 3), 16) / 255;
      g = parseInt(obj.slice(3, 5), 16) / 255;
      b = parseInt(obj.slice(5, 7), 16) / 255;
      a = parseInt(obj.slice(7, 9), 16) / 255;
    } else if (obj.match(/^#[0-9a-fA-F]{3}$/)) {
      r = parseInt(obj.slice(1, 2), 16) / 15;
      g = parseInt(obj.slice(2, 3), 16) / 15;
      b = parseInt(obj.slice(3, 4), 16) / 15;
      a = 1;
    } else if (obj.match(/^#[0-9a-fA-F]{4}$/)) {
      r = parseInt(obj.slice(1, 2), 16) / 15;
      g = parseInt(obj.slice(2, 3), 16) / 15;
      b = parseInt(obj.slice(3, 4), 16) / 15;
      a = parseInt(obj.slice(4, 5), 16) / 15;
    } else if ((m = obj.match(/^rgba?\( *(\d+), *(\d+), *(\d+)(?:, *(\d+))? *\)$/))) {
      // 0...255, just use an array if already in 0...1!
      r = Number(m[1]) / 255;
      g = Number(m[2]) / 255;
      b = Number(m[3]) / 255;
      a = m[4] ? Number(m[4]) / 255 : 1;
    } else if ((m = obj.match(/^hsv\( *([0-9.]+), *([0-9.]+), *([0-9.]+) *\)$/))) {
      let h = Number(m[1]);
      let s = Number(m[2]);
      let v = Number(m[3]);
      let ret = [0,0,0];
      hsvToRGB(ret, h, s, v);
      r = ret[0];
      g = ret[1];
      b = ret[2];
      a = 1;
    } else {
      return obj;
    }
    return [roundColor(r),roundColor(g),roundColor(b),roundColor(a)];
  }
  return obj;
}

module.exports = function (opts) {
  let proc = opts && opts.proc || ((job, data, next) => next(null, data));
  let auto_color = opts && opts.auto_color;
  let outname_prepare = opts && opts.outname_prepare;

  function yamlproc(job, done) {
    let file = job.getFile();
    // Replace extension
    let outname = outname_prepare ? outname_prepare(file) : file.relative;
    outname = outname.replace(/\.ya?ml$/, '.json');
    let data;
    try {
      data = yaml.load(file.contents.toString('utf8')) || {};
    } catch (e) {
      return void done(e);
    }

    if (auto_color) {
      // Convert reasonable color strings into [r,g,b] vectors
      data = procColor(data);
    }
    proc(job, data, function (err, output) {
      if (err) {
        return void done(err);
      }
      assert.equal(typeof output, 'object'); // Not expecting caller to serialize
      job.out({
        relative: outname,
        contents: JSON.stringify(output),
      });
      done();
    });
  }
  return {
    type: gb.SINGLE,
    func: yamlproc,
    version: [
      procColor,
      roundColor,
      opts,
      yamlproc,
    ],
  };
};
