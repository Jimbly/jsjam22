const assert = require('assert');
const { PNG } = require('pngjs');

const { min } = Math;

// const PNG_GRAYSCALE = 0;
const PNG_RGB = 2;
const PNG_RGBA = 6;

// Good bilinear reduction, might not be great for expansion
exports.drawImageBilinear = function drawImageBilinear(
  dest, dbpp, dx, dy, dw, dh, src, sbpp, sx0, sy0, sw, sh, channel_mask
) {
  let dd = dest.data;
  let target_width = dest.width;
  let sd = src.data;
  let source_width = src.width;
  let ratiox = sw / dw;
  let ratioy = sh / dh;
  for (let jj = 0; jj < dh; ++jj) {
    let sy = ratioy * (jj + 0.5) - 0.5;
    let sy_low = sy | 0;
    let sy_high = min(sh - 1, sy_low + 1);
    let sy_w = sy - sy_low;
    let inv_sy_w = 1 - sy_w;
    let dyidx = (dy + jj) * target_width;
    sy_low += sy0;
    sy_high += sy0;
    sy_low *= source_width * sbpp;
    sy_high *= source_width * sbpp;
    for (let ii = 0; ii < dw; ++ii) {
      let sx = ratiox * (ii + 0.5) - 0.5;
      let sx_low = sx | 0;
      let sx_high = min(sw - 1, sx_low + 1);
      let sx_w = sx - sx_low;
      let inv_sx_w = 1 - sx_w;
      sx_low += sx0;
      sx_high += sx0;
      sx_low *= sbpp;
      sx_high *= sbpp;
      let idxa = sx_low + sy_low;
      let idxb = sx_low + sy_high;
      let idxc = sx_high + sy_low;
      let idxd = sx_high + sy_high;
      for (let kk = 0; kk < dbpp; ++kk) {
        if ((1 << kk) & channel_mask) {
          let a = sd[idxa + kk];
          let b = sd[idxb + kk];
          let c = sd[idxc + kk];
          let d = sd[idxd + kk];
          let ab = a * inv_sy_w + b * sy_w;
          let cd = c * inv_sy_w + d * sy_w;
          dd[(dx + ii + dyidx) * dbpp + kk] = ab * inv_sx_w + cd * sx_w;
        }
      }
    }
  }
};

// Returns { err, img: { width, height, data } }
function pngRead(file_contents) {
  let img;
  try {
    img = PNG.sync.read(file_contents);
  } catch (e) {
    if (e.toString().indexOf('at end of stream') !== -1) {
      // Chrome stated adding an extra 0?!
      // Also, Photoshop sometimes adds an entire extra PNG file?!
      // Slice down to the expected location derived from IEND (repeatedly, in case that's part of a zlib string)
      let contents = file_contents;
      while (true) {
        let idx = contents.lastIndexOf('IEND');
        if (idx === -1) {
          // something else at the end
          return { err: e };
        }
        contents = contents.slice(0, idx + 8);
        try {
          img = PNG.sync.read(contents);
          break;
        } catch (e2) {
          contents = contents.slice(0, idx);
        }
      }
    } else {
      return { err: e };
    }
  }
  let { width, height, data } = img;
  assert.equal(width * height * 4, data.length);
  return { img };
}
exports.pngRead = pngRead;


function pngAlloc({ width, height, byte_depth }) {
  let colorType = byte_depth === 3 ? PNG_RGB : PNG_RGBA;
  let ret = new PNG({ width, height, colorType });
  let num_bytes = width * height * 4;
  assert.equal(ret.data.length, num_bytes);
  return ret;
}
exports.pngAlloc = pngAlloc;

// img is from pngAlloc or pngRead
function pngWrite(img) {
  return PNG.sync.write(img);
}
exports.pngWrite = pngWrite;
