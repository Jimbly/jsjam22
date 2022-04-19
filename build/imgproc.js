/* eslint max-len:off */
/*
  To use, in config.project.js, add:

  const imgproc = require('./imgproc.js');

  let img_proc = 'client/img/proc/*.png';
  config.client_static.push(`!${img_proc}`);
  config.client_register_cbs.push((gb) => {
    config.extra_client_tasks.push('client_img_proc');
    gb.task({
      name: 'client_img_proc',
      input: img_proc,
      target: 'dev',
      ...imgproc()
    });
  });

*/
const gb = require('glov-build');
const { floor } = Math;
const { PNG } = require('pngjs');
const resize = require('./resize.js');

let target_size = 16;
let colorType = 6;

module.exports = function () {
  function imgproc(job, done) {
    let file = job.getFile();
    let out_path = file.relative.replace(/\/proc\//, '/');
    job.depAdd(`${file.relative}.opt`, function (err, dep_file) {
      let opts = {};
      if (!err && dep_file.contents) {
        try {
          opts = JSON.parse(dep_file.contents);
        } catch (e) {
          return void done(e);
        }
      }
      let pngin;
      try {
        pngin = PNG.sync.read(file.contents);
      } catch (e) {
        if (e.toString().indexOf('at end of stream') !== -1) {
          // Chrome stated adding an extra 0?!
          let extra = 0;
          while (file.contents[file.contents.length - 1 - extra] === 0) {
            ++extra;
          }
          try {
            pngin = PNG.sync.read(file.contents.slice(0, -extra));
          } catch (e2) {
            return void done(e2);
          }
        } else {
          return void done(e);
        }
      }
      let ret;
      let { tile } = opts;
      let targetw = opts.target_size || target_size;
      let targeth = opts.target_size || target_size;
      if (tile) {
        let num_tx = floor(pngin.width / tile);
        let num_ty = floor(pngin.height / tile);
        ret = new PNG({ width: num_tx * targetw, height: num_ty * targeth, colorType });
        // resize tile by tile
        for (let ty=0; ty < num_ty; ++ty) {
          for (let tx=0; tx < num_tx; ++tx) {
            let imgdata = Buffer.alloc(tile*tile*4);
            for (let jj = 0; jj < tile; ++jj) {
              for (let ii = 0; ii < tile; ++ii) {
                for (let kk = 0; kk < 4; ++kk) {
                  imgdata[(jj * tile + ii) * 4 + kk] = pngin.data[((ty * tile + jj) * pngin.width + tx * tile + ii) * 4 + kk];
                }
              }
            }
            let dest = { width: targetw, height: targeth, data: Buffer.alloc(targetw * targeth * 4) };
            resize.bicubicInterpolation({ data: imgdata, width: tile, height: tile }, dest);
            for (let jj = 0; jj < targeth; ++jj) {
              for (let ii = 0; ii < targetw; ++ii) {
                for (let kk = 0; kk < 4; ++kk) {
                  ret.data[((ty * targeth + jj) * ret.width + tx * targetw + ii) * 4 + kk] = dest.data[(jj * targetw + ii) * 4 + kk];
                }
              }
            }
          }
        }
      } else {
        // resize all at once
        let dest = { width: targetw, height: targeth, data: Buffer.alloc(targetw * targeth * 4) };
        resize.bicubicInterpolation({
          data: pngin.data,
          width: pngin.width,
          height: pngin.height,
        }, dest);
        ret = new PNG({ width: targetw, height: targeth, colorType });
        ret.data = dest.data;
      }
      let buffer = PNG.sync.write(ret);
      job.out({
        relative: out_path,
        contents: buffer,
      });
      done();
    });
  }
  return {
    type: gb.SINGLE,
    func: imgproc,
  };
};
