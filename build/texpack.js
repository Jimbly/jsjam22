const assert = require('assert');
const gb = require('glov-build');
const {
  FORMAT_PACK,
  TEXPACK_MAGIC,
} = require('../src/glov/common/texpack_common');

function texPackMakeTXP(flags, out) {
  let num_files = out.length;
  assert(num_files > 1);
  assert(flags & FORMAT_PACK);

  let header = Buffer.alloc((num_files + 3) * 4);
  let header_idx = 0;
  header.writeUInt32LE(TEXPACK_MAGIC, header_idx);
  header_idx += 4;
  header.writeUInt32LE(num_files, header_idx);
  header_idx += 4;
  header.writeUInt32LE(flags, header_idx);
  header_idx += 4;
  let buffs = [header];
  for (let ii = 0; ii < out.length; ++ii) {
    let buf = out[ii];
    header.writeUInt32LE(buf.length, header_idx);
    header_idx += 4;
    buffs.push(buf);
  }
  assert.equal(header_idx, header.length);
  return Buffer.concat(buffs);
}
exports.texPackMakeTXP = texPackMakeTXP;

function texPackParseTXP(buf) {
  let offs = 0;
  let magic = buf.readUint32LE(offs);
  offs+=4;
  assert.equal(magic, TEXPACK_MAGIC);
  let num_files = buf.readUint32LE(offs);
  offs+=4;
  let flags = buf.readUint32LE(offs);
  offs+=4;
  let lens = [];
  for (let ii = 0; ii < num_files; ++ii) {
    lens.push(buf.readUint32LE(offs));
    offs+=4;
  }
  let bufs = [];
  for (let ii = 0; ii < num_files; ++ii) {
    bufs.push(buf.slice(offs, offs + lens[ii]));
    offs += lens[ii];
  }
  assert.equal(offs, buf.length);
  return {
    flags,
    bufs,
  };
}

exports.texPackExtractPNG = function () {
  function extractPNG(job, done) {
    let file = job.getFile();
    assert(file.relative.endsWith('.txp'));
    let basename = file.relative.slice(0, -'.txp'.length);
    let { flags, bufs } = texPackParseTXP(file.contents);
    for (let ii = 0; ii < bufs.length; ++ii) {
      job.out({
        relative: `${basename}.extract.${ii}.${flags}.png`,
        contents: bufs[ii],
      });
    }
    done();
  }
  return {
    type: gb.SINGLE,
    func: extractPNG,
  };
};

exports.texPackRecombinePNG = function () {
  function recombinePNG(job, done) {
    let files = job.getFiles();
    let by_keys = {};
    let flags;
    for (let ii = 0; ii < files.length; ++ii) {
      let file = files[ii];
      let m = file.relative.match(/^(.*)\.extract.(\d+).(\d+)\.png$/);
      if (!m) {
        job.out(file);
      } else {
        let base = m[1];
        by_keys[base] = (by_keys[base] || []);
        by_keys[base].push([Number(m[2]), file]);
        let this_flags = Number(m[3]);
        if (flags === undefined) {
          flags = this_flags;
        } else {
          assert.equal(flags, this_flags);
        }
      }
    }
    for (let key in by_keys) {
      let list = by_keys[key];
      list.sort((a, b) => a[0] - b[0]);
      job.out({
        relative: `${key}.txp`,
        contents: texPackMakeTXP(flags, list.map((a) => a[1].contents)),
      });
    }
    done();
  }
  return {
    type: gb.ALL,
    func: recombinePNG,
  };
};
