/* eslint max-len:off */

const { inspect } = require('util');
const gb = require('glov-build');
const { max } = Math;
const { pngAlloc, pngRead, pngWrite } = require('./png.js');

const preamble = `const { vec4 } = require('glov/common/vmath.js');
const { spritesheetRegister } = require('glov/client/spritesheet.js');
module.exports = `;
const postamble = `;
spritesheetRegister(module.exports);
`;

function nextHighestPowerOfTwo(x) {
  --x;
  for (let i = 1; i < 32; i <<= 1) {
    x |= x >> i;
  }
  return x + 1;
}

function Vec4(a, b, c, d) {
  this.data = [a, b, c, d];
}
Vec4.prototype[inspect.custom] = function () {
  return `vec4(${this.data.join(',')})`;
};

function vec4(an, ad, bn, bd, cn, cd, dn, dd) {
  return new Vec4(`${an}/${ad}`, `${bn}/${bd}`, `${cn}/${cd}`, `${dn}/${dd}`);
}

function cmpFileKeys(a, b) {
  return a.localeCompare(b, 'en', { numeric: true });
}

module.exports = function (opts) {
  const { name, tile_horiz_regex, clamp_regex } = opts;
  let pad = opts.pad || 0;
  function imgproc(job, done) {
    let files = job.getFiles();

    const max_tex_size = 1024;
    let file_data = {};
    let max_idx = 0;
    for (let ii = 0; ii < files.length; ++ii) {
      let img_file = files[ii];
      let { err, img } = pngRead(img_file.contents);
      if (err) {
        return void done(err);
      }
      img.source_name = img_file.relative;
      let img_name = img_file.relative.match(/^(?:.*\/)?([^/]+)\.png$/)[1].toLowerCase();
      let m = img_name.match(/^(.*)_(\d+)$/);
      let idx = 0;
      if (m) {
        img_name = m[1];
        idx = Number(m[2]);
        max_idx = max(max_idx, idx);
      }
      let img_data = file_data[img_name] = file_data[img_name] || { imgs: [] };
      img_data.imgs[idx] = img;
    }
    let file_keys = Object.keys(file_data);
    file_keys.sort(cmpFileKeys);

    if (!file_keys.length) {
      return void done('No files found');
    }

    let runtime_data = {
      name,
      tiles: {}, // file base name -> tile ID
      uidata: {
        rects: [],
        aspect: [],
      },
      layers: max_idx ? max_idx + 1 : undefined,
    };

    // Check input and pack output
    let maxx = 0;
    let maxy;
    {
      let x = 0;
      let y = 0;
      let row_height = 0;
      let any_error = false;
      for (let ii = 0; ii < file_keys.length; ++ii) {
        let img_name = file_keys[ii];
        let img_data = file_data[img_name];
        let { imgs } = img_data;
        let img0 = imgs[0];
        if (!img0) {
          any_error = true;
          job.error(`Image ${img_name} missing required base (_0) layer`);
          continue;
        }
        // Check all layers are the same size
        for (let idx = 1; idx < imgs.length; ++idx) {
          let img = imgs[idx];
          if (img) {
            if (img.width !== img0.width ||
              img.height !== img0.height
            ) {
              any_error = true;
              job.error(`Image ${img_name} layer ${idx} (${img.source_name}) resolution (${img.width}x${img.height})` +
                ` does not match base layer (${img0.source_name}) resolution (${img0.width}x${img0.height})`);
            }
          }
        }
        // Pack into output
        if (x + img0.width + pad * 2 > max_tex_size) {
          x = 0;
          y += row_height;
          row_height = 0;
        }
        row_height = max(row_height, img0.height + pad * 2);
        img_data.x = x + pad;
        img_data.y = y + pad;
        x += img0.width + pad * 2;
        maxx = max(maxx, x);
      }
      y += row_height + pad * 2;
      maxy = y;
      if (any_error) {
        return void done();
      }
    }

    // Allocate actual images and copy into them
    let width = nextHighestPowerOfTwo(maxx);
    let height = nextHighestPowerOfTwo(maxy);
    let pngouts = [];
    for (let ii = 0; ii <= max_idx; ++ii) {
      pngouts.push(pngAlloc({ width, height, byte_depth: 4 }));
    }

    let all_square = true;
    for (let ii = 0; ii < file_keys.length; ++ii) {
      let img_name = file_keys[ii];
      let img_data = file_data[img_name];
      let { imgs, x, y } = img_data;
      let { width: imgw, height: imgh } = imgs[0];
      runtime_data.tiles[img_name] = ii;
      runtime_data[`FRAME_${img_name.toUpperCase()}`] = ii;
      runtime_data.uidata.rects.push(vec4(x, width, y, height, (x + imgw), width, (y + imgh), height));
      runtime_data.uidata.aspect.push(imgw/imgh);

      for (let idx = 0; idx < imgs.length; ++idx) {
        let img = imgs[idx];
        if (!img) {
          continue;
        }
        let { data: outdata } = pngouts[idx];
        let { data: indata } = img;
        if (imgw !== imgh) {
          all_square = false;
        }
        let clamp = clamp_regex && clamp_regex.test(img_name);
        let clamp_vert = clamp || tile_horiz_regex && tile_horiz_regex.test(img_name);
        let clamp_horiz = clamp;
        for (let yy = -pad; yy < imgh + pad; ++yy) {
          let yyy;
          if (clamp_vert) {
            yyy = yy < 0 ? 0 : yy >= imgh ? imgh - 1 : yy;
          } else {
            yyy = (yy + imgh) % imgh;
          }
          for (let xx = -pad; xx < imgw + pad; ++xx) {
            let xxx;
            if (clamp_horiz) {
              xxx = xx < 0 ? 0 : xx >= imgw ? imgh - 1 : xx;
            } else {
              xxx = (xx + imgw) % imgw;
            }
            for (let jj = 0; jj < 4; ++jj) {
              outdata[(x + xx + (y + yy) * width) * 4 + jj] = indata[(xxx + yyy * imgw) * 4 + jj];
            }
          }
        }
      }
    }
    if (all_square) {
      delete runtime_data.uidata.aspect;
    }

    for (let idx = 0; idx <= max_idx; ++idx) {
      let pngout = pngouts[idx];
      job.out({
        relative: `client/img/${name}${max_idx ? `_${idx}` : ''}.png`,
        contents: pngWrite(pngout),
      });
    }
    job.out({
      relative: `client/img/${name}.js`,
      contents: `${preamble}${inspect(runtime_data, { depth: Infinity, maxArrayLength: Infinity })}${postamble}`,
    });
    done();
  }
  return {
    type: gb.ALL,
    func: imgproc,
    version: [
      preamble,
      postamble,
      cmpFileKeys,
      pad,
      tile_horiz_regex,
      clamp_regex,
    ],
  };
};
