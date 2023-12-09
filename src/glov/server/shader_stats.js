/* eslint-disable import/order */
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { errorString, nop } = require('../common/util.js');

const regex_bound = /; Bound: (\d+)/;
const regex_ignore = new RegExp([
  // Debug information and Annotations
  'OpCapability',
  'OpExtInstImport',
  'OpMemoryModel',
  'OpEntryPoint',
  'OpName',
  'OpMemberName',
  'OpDecorate',
  'OpMemberDecorate',
  'OpExecutionMode',
  'OpSource',
  'OpType',
].join('|'));
function parseSPRIVDisassembly(text) {
  let ret = {
    op_count_raw: 0,
    count: {
      constant: 0,
      variable: 0,
      other: 0,
    },
  };
  let lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  for (let ii = 0; ii < lines.length; ++ii) {
    let line = lines[ii];
    let m;
    if (ii === 0 && line.endsWith('.in')) {
      // ignore
    } else if ((m = line.match(regex_bound))) {
      ret.bound_count = Number(m[1]);
    } else if (line.startsWith(';')) {
      // comment
    } else {
      // Actual line of disassembly
      ++ret.op_count_raw;
      if (line.match(regex_ignore)) {
        // comment, anything that's probably not an op
      } else if (line.match(/OpConstant/)) {
        ret.count.constant++;
      } else if (line.match(/OpVariable/)) {
        ret.count.variable++;
      } else {
        ret.count.other++;
        // ret.unknown_lines = ret.unknown_lines || [];
        // ret.unknown_lines.push(line);
      }
    }
  }
  ret.count_total = 0;
  for (let key in ret.count) {
    ret.count_total += ret.count[key];
  }
  return ret;
}

let glslang_validator;
function getShaderStats(stage, text, cb) {
  let validator_path;
  try {
    if (!glslang_validator) {
      // eslint-disable-next-line global-require
      glslang_validator = require('glslang-validator-prebuilt-predownloaded');
    }
    validator_path = glslang_validator.getPath();
  } catch (e) {
    return void cb(errorString(e));
  }
  let temp_dir = os.tmpdir();
  let name = crypto.randomBytes(16).toString('hex');
  let input_file = path.join(temp_dir, `${name}.in`);
  let output_file = path.join(temp_dir, `${name}.out`);
  function done(err, result) {
    fs.unlink(input_file, nop);
    fs.unlink(output_file, nop);
    cb(err, result);
  }

  if (!text.startsWith('#version')) {
    // WebGL #version 100 -> the lowest version that can go to Vulkan conversion
    if (stage === 'frag') {
      text = `#version 310 es
#define WEBGL2
#define ES310
#define varying in
out lowp vec4 fragColor;
#define gl_FragColor fragColor
#define texture2D texture
#define textureCube texture

${text}`;
    } else {
      text = `#version 310 es
#define WEBGL2
#define ES310
#define varying out
#define attribute in

${text}`;
    }
  } else {
    text = text.replace('#version 300 es\n', '#version 310 es\n#define ES310\n');
  }
  fs.writeFile(input_file, text, function (err) {
    if (err) {
      return void done(err);
    }
    let args = [
      '--client', 'opengl100',
      '--auto-map-locations', // needed
      '--auto-map-bindings', // not needed?
      '--spirv-dis', // print disassembled SPRIV
      '-Od', // disable optimization
      '-o', output_file,
      '-S', stage,
      input_file,
    ];
    execFile(validator_path, args, {}, function (err, stdout, stderr) {
      stderr = stderr.trim();
      if (stdout.startsWith(input_file)) {
        stdout = stdout.slice(input_file.length);
      }
      stdout = stdout.replaceAll(input_file, 'shader');
      stdout = stdout.trim();
      if (err || stderr) {
        console.log('TEXT', text);
        console.log('ERR', err);
        console.log('STDOUT', stdout);
        console.log('STDERR', stderr);
        return void done((stdout + stderr) || err);
      }

      fs.stat(output_file, function (err, stat) {
        if (err) {
          return void done(err);
        }

        //console.log('STDOUT', stdout);
        let dis = parseSPRIVDisassembly(stdout);
        done(null, {
          spirv: dis,
          bin_size: stat.size,
          text,
          spirv_raw: stdout,
        });
      });
    });
  });
}


export function shaderStatsInit(app) {
  app.get('/api/shaderstats', function (req, res, next) {
    let { text, stage } = req.query;
    function respond(err, data) {
      res.end(JSON.stringify(err ? { err } : data));
    }
    if (!text || !stage) {
      return void respond('Missing text');
    }
    getShaderStats(stage, text, respond);
  });
}
