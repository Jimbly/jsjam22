const assert = require('assert');
const path = require('path');
const gb = require('glov-build');
const {
  FORMAT_PACK,
  FORMAT_PNG,
} = require('../src/glov/common/texpack_common');
const {
  drawImageBilinear,
  pngAlloc,
  pngRead,
  pngWrite,
} = require('./png.js');
const { texPackMakeTXP } = require('./texpack');

const { floor } = Math;

module.exports = function () {
  function findTexOpt(job, base_name, next) {
    function searchFolder(filename) {
      let folder = path.dirname(filename);
      if (!folder || folder === '.') {
        return void next(null);
      }
      job.depAdd(`client_texopt:${folder}/folder.texopt`, function (err, file) {
        if (!err && file) {
          assert(file.contents);
          let obj = JSON.parse(file.contents);
          return void next(obj);
        }
        searchFolder(folder);
      });
    }
    job.depAdd(`client_texopt:${base_name}.texopt`, function (err, file) {
      if (!err && file) {
        assert(file.contents);
        let obj = JSON.parse(file.contents);
        return void next(obj);
      }
      searchFolder(base_name);
    });
  }
  function makeMipmapsArray(img) {
    let { width, height } = img;
    let tile_w = width;
    let num_images = height / tile_w;
    assert.equal(floor(num_images), num_images);
    let last_x = 0;
    let last_y = 0;
    let last_w = tile_w;
    const next_x = 0;
    const next_y = 0;
    let ret = [];
    while (last_w > 1) {
      let next_w = floor(last_w/2);

      let dest2 = pngAlloc({ width: next_w, height: next_w * num_images, byte_depth: 4 });
      ret.push(dest2);

      // resize and copy from last_x/y -> next_x/y
      for (let frame = 0; frame < num_images; ++frame) {
        drawImageBilinear(dest2, 4, next_x, next_y + next_w * frame, next_w, next_w,
          img, 4, last_x, last_y + last_w * frame, last_w, last_w, 0xF);
      }

      last_w = next_w;
      img = dest2;
    }
    return ret;
  }
  function texproc(job, done) {
    let file = job.getFile();
    let filename = file.relative;
    let base_name = filename.slice(0, -path.extname(filename).length);
    findTexOpt(job, base_name, function (texopt) {
      if (!texopt) {
        job.out(file);
        return void done();
      }
      let flags = 0;
      if (texopt.packed_mipmaps) {
        flags |= FORMAT_PACK;
      } else {
        // no mipmaps?  does nothing currently
        return void done('Unknown texopt format: expected packed_mipmaps: true');
      }
      let formats = texopt.formats || ['png'];
      let out_by_format = [];
      for (let ii = 0; ii < formats.length; ++ii) {
        let format = formats[ii];
        let out_elem = {
          out: [],
        };
        out_by_format.push(out_elem);
        if (format === 'png') {
          flags |= FORMAT_PNG;
          out_elem.out.push(file.contents);
          out_elem.writer = pngWrite;
          out_elem.ext = 'png';
          out_elem.packext = 'txp';
        } else {
          return void done(`Unknown texopt format: "${format}"`);
        }
      }

      job.out({
        contents: JSON.stringify(flags),
        relative: `${base_name}.tflag`,
      });

      let { err, img } = pngRead(file.contents);
      if (err) {
        return void done(err);
      }

      if (texopt.packed_mipmaps) {
        let is_array = filename.includes('.array.');
        let mipmaps;
        if (is_array) {
          mipmaps = makeMipmapsArray(img);
          assert(mipmaps.length);
        } else {
          assert(!'TODO');
        }
        for (let jj = 0; jj < out_by_format.length; ++jj) {
          let out_elem = out_by_format[jj];
          for (let ii = 0; ii < mipmaps.length; ++ii) {
            out_elem.out.push(out_elem.writer(mipmaps[ii]));
          }
        }
      }

      for (let jj = 0; jj < out_by_format.length; ++jj) {
        let out_elem = out_by_format[jj];
        let { out, ext, packext } = out_elem;
        let num_files = out.length;
        if (flags & FORMAT_PACK) {
          assert(num_files > 1);
          job.out({
            relative: `${base_name}.${packext}`,
            contents: texPackMakeTXP(flags, out),
          });
        } else {
          assert.equal(num_files, 1);
          job.out({
            relative: `${base_name}.${ext}`,
            contents: out[0],
          });
        }
      }

      done();
    });

  }
  return {
    type: gb.SINGLE,
    func: texproc,
    version: [
      texproc,
      findTexOpt,
      makeMipmapsArray,
    ],
  };
};
