// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export const MAX_SEMANTIC = 5;

export const SEMANTIC = {
  'ATTR0': 0,
  'POSITION': 0,
  'ATTR1': 1,
  'COLOR': 1,
  'COLOR_0': 1,
  'ATTR2': 2,
  'TEXCOORD': 2,
  'TEXCOORD_0': 2,
  'ATTR3': 3,
  'NORMAL': 3,
  'ATTR4': 4,
  'TEXCOORD_1': 4,
};

/* eslint-disable import/order */
const assert = require('assert');
const engine = require('./engine.js');
const {
  errorReportClear,
  errorReportSetDetails,
  errorReportSetDynamicDetails,
  glovErrorReport,
} = require('./error_report.js');
const { filewatchOn } = require('./filewatch.js');
const { matchAll, nop } = require('glov/common/util.js');
const { textureUnloadDynamic } = require('./textures.js');
const { webFSGetFile } = require('./webfs.js');

let last_id = 0;

let bound_prog = null;

export let globals;
let globals_used;
let global_defines;

let error_fp;
let error_fp_webgl2;
let error_vp;

let shaders = [];

const vp_attr_regex = /attribute [^ ]+ ([^ ;]+);/g;
const uniform_regex = /uniform (?:(?:low|medium|high)p )?((?:(?:vec|mat)\d(?:x\d)?|float) [^ ;]+);/g;
const sampler_regex = /uniform sampler(?:2D|Cube) ([^ ;]+);/g;
const include_regex = /\n#include "([^"]+)"/g;

const type_size = {
  float: 1,
  vec2: 2*1,
  vec3: 3*1,
  vec4: 4*1,
  mat3: 3*3,
  mat4: 4*4,
};

function loadInclude(filename) {
  let text = webFSGetFile(filename, 'text');
  return `\n// from include "${filename}":\n${text}\n`;
}

export function shadersResetState() {
  for (let ii = 0; ii < shaders.length; ++ii) {
    let shader = shaders[ii];
    if (shader.programs) {
      for (let fpid in shader.programs) {
        let prog = shader.programs[fpid];
        //gl.useProgram(prog.handle);
        for (let jj = 0; jj < prog.uniforms.length; ++jj) {
          let unif = prog.uniforms[jj];
          for (let kk = 0; kk < unif.size; ++kk) {
            unif.value[kk] = NaN;
          }
          //uniformSetValue(unif);
        }
      }
    }
  }
  bound_prog = null;
  gl.useProgram(null);
}

export function shadersSetGLErrorReportDetails() {
  // Set some debug details we might want
  let details = {
    max_fragment_uniform_vectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    max_varying_vectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
    max_vertex_attribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    max_vertex_uniform_vectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
    webgl: engine.webgl2 ? 2 : 1,
  };
  let debug_info = gl.getExtension('WEBGL_debug_renderer_info');
  if (debug_info) {
    details.renderer_unmasked = gl.getParameter(debug_info.UNMASKED_RENDERER_WEBGL);
    details.vendor_unmasked = gl.getParameter(debug_info.UNMASKED_VENDOR_WEBGL);
  }
  for (let key in details) {
    errorReportSetDetails(key, details[key]);
  }
}

errorReportSetDynamicDetails('context_lost', function () {
  if (window.gl && gl.isContextLost()) {
    return '1';
  }
  return '';
});

let report_timeout = null;
let shader_errors;
let shader_errors_any_fatal;
let reported_shader_errors = false;
function reportShaderError(non_fatal, err) {
  function doReport() {
    report_timeout = null;
    let msg = `Shader error(s):\n    ${shader_errors.join('\n    ')}`;
    shader_errors = null;
    if (!gl.isContextLost()) {
      shadersSetGLErrorReportDetails();
      reported_shader_errors = true;
      if (!shader_errors_any_fatal) {
        glovErrorReport(false, msg, 'shaders.js');
      } else {
        assert(false, msg);
      }
    }
  }
  if (!report_timeout) {
    report_timeout = setTimeout(doReport, 1000);
    shader_errors = [];
    shader_errors_any_fatal = false;
  }
  shader_errors_any_fatal = shader_errors_any_fatal || !non_fatal;
  shader_errors.push(err);
}

function parseIncludes(parent_name, text) {
  let supplied_uniforms = {};
  text.replace(uniform_regex, function (str, key) {
    supplied_uniforms[key] = true;
  });
  text = text.replace(include_regex, function (str, filename) {
    let include_path = parent_name.split('/');
    include_path.pop();
    include_path.push(filename);
    include_path = include_path.join('/');
    let replacement = loadInclude(include_path);
    if (!replacement) {
      console.error(`Could not evaluate ${str}`);
      return str;
    }
    // Remove duplicate uniforms
    replacement = replacement.replace(uniform_regex, function (str2, key) {
      if (supplied_uniforms[key]) {
        return `// [removed ${key}]`;
      }
      supplied_uniforms[key] = true;
      return str2;
    });
    return replacement;
  });
  return text;
}

const webgl2_header = [
  '#version 300 es',
  '#define WEBGL2',
].join('\n');
const webgl2_header_fp = [
  webgl2_header,
  '#define varying in',
  'out lowp vec4 fragColor;',
  '#define gl_FragColor fragColor',
  '#define texture2D texture',
  '#define textureCube texture',
  ''
].join('\n');
const webgl2_header_vp = [
  webgl2_header,
  '#define varying out',
  '#define attribute in',
  ''
].join('\n');

function Shader(params) {
  let { filename, defines, non_fatal } = params;
  assert.equal(typeof filename, 'string');
  let type = filename.endsWith('.fp') ? gl.FRAGMENT_SHADER : filename.endsWith('.vp') ? gl.VERTEX_SHADER : 0;
  assert(type);
  this.type = type;
  this.filename = filename;
  this.non_fatal = non_fatal;
  this.defines_arr = (defines || []);
  this.defines = this.defines_arr.map((a) => `#define ${a}\n`).join('');
  this.shader = gl.createShader(type);
  this.id = ++last_id;
  if (type === gl.VERTEX_SHADER) {
    this.programs = {};
  }
  shaders.push(this);
  this.compile();
}

export function shadersGetDebug() {
  return shaders;
}

function cleanShaderError(error_text) {
  if (error_text) { // sometimes null on iOS
    error_text = error_text.replace(/\0/g, '').trim();
  }
  return error_text;
}

Shader.prototype.compile = function () {
  let { type, filename } = this;
  let header = '';
  let text = webFSGetFile(filename, 'text');
  if (engine.webgl2 && text.includes('#pragma WebGL2')) {
    header = type === gl.VERTEX_SHADER ? webgl2_header_vp : webgl2_header_fp;
  }
  text = `${header}${global_defines}${this.defines}${text}`;
  text = parseIncludes(filename, text);
  text = text.replace(/#pragma WebGL2?/g, '');
  if (type === gl.VERTEX_SHADER) {
    this.attributes = matchAll(text, vp_attr_regex);
    // Ensure they are known names so we can give them indices
    // Add to SEMANTIC[] above as needed
    this.attributes.forEach((v) => assert(SEMANTIC[v] !== undefined));
  } else {
    this.samplers = matchAll(text, sampler_regex);
    // Ensure all samplers end in a unique number
    let found = [];
    this.samplers.forEach((v) => {
      let num = Number(v.slice(-1));
      assert(!isNaN(num));
      assert(!found[num]);
      found[num] = true;
    });
  }
  this.uniforms = matchAll(text, uniform_regex);
  // Ensure a known type
  this.uniforms.forEach((v) => {
    let type_name = v.split(' ')[0];
    assert(type_size[type_name]);
  });
  this.shader_source_text = text;

  if (gl.isContextLost()) {
    // will throw in gl.shaderSource on iOS or presumably error on other platforms
    this.valid = false;
    let error_text = this.error_text = 'Context lost';
    if (this.defines_arr.length) {
      filename += `(${this.defines_arr.join(',')})`;
    }
    console[this.non_fatal ? 'warn' : 'error'](`Error compiling ${filename}: ${error_text}`);
    // Just silently fail, presumably context lost because the tab is being closed
    // reportShaderError(this.non_fatal, `${filename}: ${error_text}`);
    return;
  }

  gl.shaderSource(this.shader, text);
  gl.compileShader(this.shader);

  if (!gl.getShaderParameter(this.shader, gl.COMPILE_STATUS)) {
    this.valid = false;
    let error_text = this.error_text = cleanShaderError(gl.getShaderInfoLog(this.shader));
    if (this.defines_arr.length) {
      filename += `(${this.defines_arr.join(',')})`;
    }
    console[this.non_fatal ? 'warn' : 'error'](`Error compiling ${filename}: ${error_text}`);
    reportShaderError(this.non_fatal, `${filename}: ${error_text}`);
    console.log(text.split('\n').map((line, idx) => `${idx+1}: ${line}`).join('\n'));
  } else {
    this.valid = true;
    if (this.error_text) {
      delete this.error_text;
    }
  }
};

export function shaderCreate(filename) {
  if (typeof filename === 'object') {
    return new Shader(filename);
  }
  return new Shader({ filename });
}

function uniformSetValue(unif) {
  switch (unif.width) { // eslint-disable-line default-case
    case 1:
      gl.uniform1fv(unif.location, unif.value);
      break;
    case 2:
      gl.uniform2fv(unif.location, unif.value);
      break;
    case 3:
      gl.uniform3fv(unif.location, unif.value);
      break;
    case 4:
      gl.uniform4fv(unif.location, unif.value);
      break;
    case 9:
      gl.uniformMatrix3fv(unif.location, false, unif.value);
      break;
    case 16:
      gl.uniformMatrix4fv(unif.location, false, unif.value);
      break;
  }
}

let require_prelink = false;
export function shadersRequirePrelink(ensure) {
  let old = require_prelink;
  require_prelink = ensure;
  return old;
}

function link(vp, fp, on_error) {
  assert(!require_prelink);
  let prog = vp.programs[fp.id] = {
    handle: gl.createProgram(),
    uniforms: null,
  };
  let error_text;
  if (!prog.handle) {
    // Presumably due to context loss?
    error_text = `gl.createProgram() returned ${prog.handle}`;
    prog.valid = false;
  } else {
    gl.attachShader(prog.handle, vp.shader);
    gl.attachShader(prog.handle, fp.shader);
    // call this for all relevant semantic
    for (let ii = 0; ii < vp.attributes.length; ++ii) {
      gl.bindAttribLocation(prog.handle, SEMANTIC[vp.attributes[ii]], vp.attributes[ii]);
    }
    gl.linkProgram(prog.handle);

    prog.valid = gl.getProgramParameter(prog.handle, gl.LINK_STATUS);
  }
  if (!prog.valid) {
    error_text = error_text || cleanShaderError(gl.getProgramInfoLog(prog.handle));
    let report = true;
    if (gl.isContextLost()) {
      error_text = `(Context lost) ${error_text}`;
      report = false;
    }
    console.error(`Shader link error: ${error_text}`);
    // Currently, not calling on_error if `engine.DEBUG`, we want to see our
    //   shader errors immediately!
    if (on_error && (!engine.DEBUG || on_error === nop)) {
      on_error(error_text);
    } else {
      if (report) {
        reportShaderError(false, `Shader link error (${vp.filename} & ${fp.filename}):` +
          ` ${error_text}`);
      }
    }
    prog.uniforms = [];
    return prog;
  }

  gl.useProgram(prog.handle);
  bound_prog = prog;

  let uniforms = vp.uniforms.slice(0);
  for (let ii = 0; ii < fp.uniforms.length; ++ii) {
    let name = fp.uniforms[ii];
    if (uniforms.indexOf(name) === -1) {
      uniforms.push(name);
    }
  }
  prog.uniforms = uniforms.map((v) => {
    v = v.split(' ');
    let type = v[0];
    let name = v[1];
    let count = 1;
    let m = name.match(/([^[]+)\[(\d+)\]/);
    if (m) {
      name = m[1];
      count = Number(m[2]);
    }
    let location = gl.getUniformLocation(prog.handle, name);
    if (location === null) {
      // Not in either shader, (commented out?), remove (via filter below)
      return null;
    }
    let width = type_size[type];
    let size = width * count;
    let glob = globals[name];
    globals_used[name] = true;
    let value = new Float32Array(size);
    // set initial value
    let unif = {
      name,
      size,
      width,
      count,
      value,
      location,
      glob,
    };
    uniformSetValue(unif);
    return unif;
  }).filter((v) => v);

  for (let ii = 0; ii < fp.samplers.length; ++ii) {
    let name = fp.samplers[ii];
    let num = Number(name.slice(-1));
    let location = gl.getUniformLocation(prog.handle, name);
    if (location !== null) {
      gl.uniform1i(location, num);
    }
  }
  return prog;
}

function autoLink(vp, fp, on_error) {
  let prog = vp.programs[fp.id];
  if (!prog) {
    prog = link(vp, fp, on_error);
  }
  if (!prog.valid) {
    prog = link(vp, error_fp, nop);
    if (!prog.valid && error_fp_webgl2) {
      prog = link(vp, error_fp_webgl2, nop);
    }
    if (!prog.valid) {
      prog = link(error_vp, error_fp, nop);
    }
    vp.programs[fp.id] = prog;
  }
  return prog;
}

export function shadersBind(vp, fp, params) {
  let prog = vp.programs[fp.id];
  if (!prog) {
    prog = autoLink(vp, fp);
  }
  if (prog !== bound_prog) {
    bound_prog = prog;
    gl.useProgram(prog.handle);
  }
  for (let ii = 0; ii < prog.uniforms.length; ++ii) {
    let unif = prog.uniforms[ii];
    let value = params[unif.name] || unif.glob;
    if (!value) {
      continue;
    }
    let diff = false;
    for (let jj = 0; jj < unif.size; ++jj) {
      if (value[jj] !== unif.value[jj]) {
        diff = true;
        break;
      }
    }
    if (diff) {
      for (let jj = 0; jj < unif.size; ++jj) {
        unif.value[jj] = value[jj];
      }
      uniformSetValue(unif);
    }
  }
}

export function shadersPrelink(vp, fp, params = {}, on_error) {
  let prog = autoLink(vp, fp, on_error);
  // In theory, only need to link, not bind, but let's push it through the pipe as far as it can to be safe.
  if (prog.valid) {
    shadersBind(vp, fp, params);
  }
  return prog.valid;
}

const reserved = { WEBGL2: 1 };
export function addReservedDefine(key) {
  reserved[key] = 1;
}
let internal_defines = {};
function applyDefines() {
  global_defines = Object.keys(engine.defines).filter((v) => !reserved[v])
    .concat(Object.keys(internal_defines))
    .map((v) => `#define ${v}\n`)
    .join('');
}

function shaderReload() {
  shadersRequirePrelink(false);
  if (shaders.length) {
    if (reported_shader_errors) {
      errorReportClear();
      reported_shader_errors = false;
    }
    gl.useProgram(null);
    for (let ii = 0; ii < shaders.length; ++ii) {
      let programs = shaders[ii].programs;
      if (programs) {
        for (let id in programs) {
          gl.deleteProgram(programs[id].handle);
        }
        shaders[ii].programs = {};
      }
    }
    for (let ii = 0; ii < shaders.length; ++ii) {
      shaders[ii].compile();
    }
    textureUnloadDynamic();
  }
}

export function shadersHandleDefinesChanged() {
  applyDefines();
  shaderReload();
}

export function shadersSetInternalDefines(new_values) {
  for (let key in new_values) {
    if (new_values[key]) {
      internal_defines[key] = new_values[key];
    } else {
      delete internal_defines[key];
    }
  }
  shadersHandleDefinesChanged();
}

function onShaderChange(filename) {
  shaderReload();
}

export function shadersStartup(_globals) {
  applyDefines();
  globals = _globals;
  globals_used = {};

  error_fp = shaderCreate('shaders/error.fp');
  if (engine.webgl2) {
    error_fp_webgl2 = shaderCreate('shaders/error_gl2.fp');
  }
  error_vp = shaderCreate('shaders/error.vp');

  filewatchOn('.fp', onShaderChange);
  filewatchOn('.vp', onShaderChange);

  let valid = error_fp.valid && error_vp.valid;
  if (!valid) {
    // do _not_ send immediate error reports about these, we have an invalid context of some kind
    clearTimeout(report_timeout);
  }
  return valid;
}

export function shadersAddGlobal(key, vec) {
  assert(!globals[key]);
  assert(!globals_used[key]); // A shader has already been prelinked referencing this global
  globals[key] = vec;
  for (let ii = 0; ii < vec.length; ++ii) {
    assert(isFinite(vec[ii]));
  }
}

// Legacy APIs
exports.create = shaderCreate;
exports.semantic = SEMANTIC;
exports.addGlobal = shadersAddGlobal;
exports.bind = shadersBind;
exports.prelink = shadersPrelink;
