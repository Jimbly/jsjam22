//////////////////////////////////////////////////////////////////////////
// Wrapper for gulp-like stream tasks to run as glov-build tasks
// Caveats:
//   Dependencies are not tracked, to get a task to re-process something, the
//     referencing source file must be re-saved.
//   All glov-build jobs are relative to the bucket root, regardless of where
//     the ** is in the glob, so some tasks may need to be adjusted (e.g.
//     gulp-rename will behave slightly differently)

const assert = require('assert');
const path = require('path');
const { Transform, Writable } = require('stream');
const gb = require('glov-build');
const { forwardSlashes } = require('glov-build');
const Vinyl = require('vinyl');

function once(f) {
  let done = false;
  return function (...args) {
    if (done) {
      return;
    }
    f(...args);
  };
}

module.exports = function (opts, streamfunc) {
  // TODO: also monkey-patch require('vinyl-fs').src to detect deps?

  opts = opts || {};
  if (typeof opts !== 'object') {
    opts = { target: opts };
  }
  let { target, sort } = opts;

  let out_base = '';
  if (typeof target === 'string' && target.includes(':')) {
    // format of 'target:sub/dir'
    target = target.split(':');
    assert.equal(target.length, 2);
    out_base = target[1];
    target = target[0];
  }

  function func(job, done) {
    done = once(done);
    // Creating a new stream per-file, might need something smarter? Or they should be gb.ALL tasks anyway?
    let source_stream = new Transform({
      objectMode: true,
    });
    let input_file = null;
    let task_base;
    if (job.getTaskType() === gb.SINGLE) {
      let the_file = job.getFile();
      let the_file_vinyl_param = the_file.toVinyl();
      task_base = the_file_vinyl_param.base;
      input_file = new Vinyl(the_file_vinyl_param);
    } else {
      // Grab from arbitrary, assuming they're all the same!
      task_base = job.getFiles()[0].toVinyl().base;
    }
    let outstream = streamfunc(source_stream, input_file);
    outstream.on('error', function (err) {
      job.error(err);
      // don't call done(err)?  many error events might be emitted!  Maybe after timeout to be safe...
    });
    let any_written = false;
    let target_stream = outstream.pipe(new Writable({
      objectMode: true,
      write: function (chunk, encoding, callback) {
        if (target) {
          // If a Vinyl object, re-map to relative to the bucket
          if (forwardSlashes(chunk.base).startsWith(task_base)) {
            chunk.base = task_base;
          }
          let out_file = {
            relative: path.join(out_base, chunk.relative).replace(/\\/g,'/'),
            contents: chunk.contents,
          };
          //assert.equal(out_file.relative, path.relative(task_base, chunk.path).replace(/\\/g, '/'));
          job.out(out_file);
        }
        any_written = true;
        callback();
      },
    }));
    target_stream.on('finish', function (err) {
      if (!any_written) {
        job.error('No files written');
      }
      done(err);
    });
    if (input_file) {
      source_stream.push(input_file);
    } else {
      let files = job.getFiles();
      if (sort) {
        files.sort(sort);
      }
      for (let ii = 0; ii < files.length; ++ii) {
        source_stream.push(new Vinyl(files[ii].toVinyl()));
      }
    }
    source_stream.end();
  }

  // Override func.toString for automatic versioning
  func.toString = function () {
    return Function.prototype.toString.call(func) + streamfunc.toString();
  };

  let ret = {
    type: gb.SINGLE,
    func,
    version: [
      opts,
      streamfunc,
    ],
  };
  if (typeof target === 'string') { // allow target=true to trigger output without explicit target
    ret.target = target;
  }
  return ret;
};
