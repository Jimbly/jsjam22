const assert = require('assert');
const gb = require('glov-build');
const micromatch = require('micromatch');
const { pngRead, pngWrite } = require('./png.js');

const { abs, floor, round } = Math;

// Photoshop writes pixels with 0 alpha but a bright white color, which causes
// interpolation errors - instead spread the nearest non-alpha color.
// In this extended version, continue spreading until all alpha pixels are full

function gbif(globs, fn) {
  return function (job, done) {
    let file = job.getFile();
    if (micromatch(file.relative, globs).length) {
      fn(job, done);
    } else {
      job.out(file);
      done();
    }
  };
}

module.exports = function (globs) {
  function imgproc(job, done) {
    let file = job.getFile();
    let { err, img: pngin } = pngRead(file.contents);
    if (err) {
      return void done(err);
    }
    let { width, height, data } = pngin;
    assert.equal(width * height * 4, data.length);
    let dim = width * height;
    let is_solid = new Uint8Array(dim);
    let todo = [];
    for (let ii = 0; ii < dim; ++ii) {
      if (data[ii*4 + 3]) {
        is_solid[ii] = 1;
      } else {
        todo.push(ii);
      }
    }
    if (!todo.length) {
      job.out(file);
      return void done();
    }
    let diff = 0;
    let did_anything = true;
    while (did_anything) {
      did_anything = false;
      let done = [];
      for (let ii = todo.length - 1; ii >= 0; --ii) {
        let idx = todo[ii];
        let y = floor(idx / width);
        let x = idx - y * width;
        let c = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        if (x > 0 && is_solid[idx - 1]) {
          r += data[idx*4-4];
          g += data[idx*4-3];
          b += data[idx*4-2];
          c++;
        }
        if (x < width-1 && is_solid[idx + 1]) {
          r += data[idx*4+4];
          g += data[idx*4+5];
          b += data[idx*4+6];
          c++;
        }
        if (y > 0 && is_solid[idx - width]) {
          r += data[(idx-width)*4];
          g += data[(idx-width)*4+1];
          b += data[(idx-width)*4+2];
          c++;
        }
        if (y < height-1 && is_solid[idx + width]) {
          r += data[(idx+width)*4];
          g += data[(idx+width)*4+1];
          b += data[(idx+width)*4+2];
          c++;
        }
        if (c) {
          did_anything = true;
          todo[ii] = todo[todo.length - 1];
          todo.pop();
          done.push(idx);
          r = round(r/c);
          g = round(g/c);
          b = round(b/c);
          diff += abs(data[idx*4] - r);
          diff += abs(data[idx*4+1] - g);
          diff += abs(data[idx*4+2] - b);
          data[idx*4] = r;
          data[idx*4+1] = g;
          data[idx*4+2] = b;
        }
      }
      for (let ii = 0; ii < done.length; ++ii) {
        is_solid[done[ii]] = 1;
      }
    }

    let buffer = pngWrite(pngin);
    if (!diff && buffer.length > file.contents.length) {
      // No change, and output is larger, output original
      job.out(file);
    } else {
      job.out({
        relative: file.relative,
        contents: buffer,
      });
    }
    done();
  }
  return {
    type: gb.SINGLE,
    func: gbif(globs, imgproc),
    version: [
      globs,
      imgproc,
    ],
  };
};
