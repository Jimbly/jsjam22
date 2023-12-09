const assert = require('assert');
const path = require('path');
const { forwardSlashes } = require('glov-build');
const concat = require('glov-build-concat');
const JSON5 = require('json5');

const preamble = `(function () {
var fs = window.glov_webfs = window.glov_webfs || {};`;
const postamble = '}());';

let chars = (function () {
  const ESC = String.fromCharCode(27);
  let ret = [];
  for (let ii = 0; ii < 256; ++ii) {
    ret[ii] = String.fromCharCode(ii);
  }
  // ASCII text must encode directly
  // single-byte nulls
  ret[0] = String.fromCharCode(126);
  // escape our escape character and otherwise overlapped values
  ret[27] = `${ESC}${String.fromCharCode(27)}`;
  ret[126] = `${ESC}${String.fromCharCode(126)}`;
  // escape things not valid in Javascript strings
  ret[8] = '\\b';
  ret[9] = '\\t';
  ret[10] = '\\n';
  ret[11] = '\\v';
  ret[12] = '\\f';
  ret[13] = '\\r';
  ret['\''.charCodeAt(0)] = '\\\'';
  ret['\\'.charCodeAt(0)] = '\\\\';
  // All other characters are fine (though many get turned into 2-byte UTF-8 strings)
  return ret;
}());

function encodeString(buf) {
  let ret = [];
  for (let ii = 0; ii < buf.length; ++ii) {
    let c = buf[ii];
    ret.push(chars[c]);
  }
  return ret.join('');
}

function encodeObj(obj) {
  return JSON5.stringify(obj);
}

function fileFSName(opts, name) {
  name = forwardSlashes(name).replace('autogen/', '');
  if (opts.base) {
    name = forwardSlashes(path.relative(opts.base, name));
  }
  // Remap `../glov/client/shaders/foo.fp` to be just `shaders/foo.fp`
  let non_glov_name = name.replace(/(.*glov\/(?:client|common)\/)/, '');
  if (name !== non_glov_name) {
    return { name: non_glov_name, priority: 1 };
  } else {
    return { name, priority: 2 };
  }
}

module.exports = function webfsBuild(opts) {
  let { output, embed, strip } = opts;
  let ext_list = embed || ['.json'];
  let strip_ext_list = strip || ['.json'];
  assert(output);

  let embed_exts = {};
  for (let ii = 0; ii < ext_list.length; ++ii) {
    embed_exts[ext_list[ii]] = true;
  }
  let strip_exts = {};
  for (let ii = 0; ii < strip_ext_list.length; ++ii) {
    strip_exts[strip_ext_list[ii]] = true;
  }

  return concat({
    preamble,
    postamble,
    output: output,
    key: 'name',
    proc: function (job, file, next) {
      let { name, priority } = fileFSName(opts, file.relative);
      let data = file.contents;
      let line;
      let ext_idx = name.lastIndexOf('.');
      let ext = '';
      if (ext_idx !== -1) {
        ext = name.slice(ext_idx);
      }
      if (strip_exts[ext]) {
        name = name.slice(0, -ext.length);
      }
      if (embed_exts[ext]) {
        line = `fs['${name}'] = ${encodeObj(JSON.parse(data))};`;
      } else {
        line = `fs['${name}'] = [${data.length},'${encodeString(data)}'];`;
      }
      next(null, { name, contents: line, priority });
    },
    version: [
      encodeObj,
      encodeString,
      fileFSName,
      ext_list,
      strip_ext_list,
    ],
  });
};
