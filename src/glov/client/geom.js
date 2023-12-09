// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-bitwise:off */

const assert = require('assert');
const { cmd_parse } = require('./cmds.js');
const engine = require('./engine.js');
const perf = require('./perf.js');
const settings = require('./settings.js');
const { MAX_SEMANTIC } = require('./shaders.js');
const { ceil, max, min } = Math;

export const TRIANGLES = 4;
export const TRIANGLE_FAN = 6;
export const QUADS = 7;

const MAX_VERT_COUNT = 65536 - 4; // WebGL2 treats 65535 as "primitive restart" and also dies on iOS 15

settings.register({
  show_render_stats: {
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
});

export let stats = {
  draw_calls: 0,
  draw_calls_geom: 0,
  draw_calls_sprite: 0,
  draw_calls_dyn: 0,
  tris: 0,
  verts: 0,
  sprites: 0,
  dyn: 0,
  sprite_sort_elems: 0,
  sprite_sort_cmps: 0,
  font_calls: 0,
  font_params: 0,
};
let last_stats = {};
let perf_labels = {};
for (let key in stats) {
  perf_labels[`${key}: `] = () => String(last_stats[key]);
}
perf.addMetric({
  name: 'render_stats',
  show_stat: 'show_render_stats',
  show_all: true,
  labels: perf_labels,
});


const gl_byte_size = {
  0x1400: 1, // GL_BYTE
  0x1401: 1, // GL_UNSIGNED_BYTE
  0x1402: 2, // GL_SHORT
  0x1403: 2, // GL_UNSIGNED_SHORT
  0x1406: 4, // GL_FLOAT
};

// let unit_buf;
// let unit_buf_len = 0;

let bound_geom;

let bound_array_buf = null;
let bound_index_buf = null;

let quad_index_buf;
let quad_index_buf_len = 0;

function deleteBuffer(handle) {
  if (!handle) {
    return;
  }
  if (bound_array_buf === handle) {
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    bound_array_buf = null;
  }
  if (bound_index_buf === handle) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    bound_index_buf = null;
  }
  gl.deleteBuffer(handle);
}

let attrib_enabled = 0;
function enableVertexAttribArray(bits) {
  if (bits === attrib_enabled) {
    return;
  }
  let disable_mask = (attrib_enabled & (~bits));
  let enable_mask = ((~attrib_enabled) & bits);
  attrib_enabled = bits;

  if (disable_mask) {
    let n = 0;
    do {
      if (disable_mask & 1) {
        gl.disableVertexAttribArray(n);
      }
      n++;
      disable_mask >>= 1;
    } while (disable_mask);
  }

  if (enable_mask) {
    let n = 0;
    do {
      if (enable_mask & 1) {
        gl.enableVertexAttribArray(n);
      }
      n++;
      enable_mask >>= 1;
    } while (enable_mask);
  }
}

// function bindUnitBuf(arr_idx, len) {
//   if (len > unit_buf_len) {
//     deleteBuffer(unit_buf);
//     unit_buf = gl.createBuffer();
//     unit_buf_len = max(ceil(unit_buf_len * 1.5), len);
//     gl.bindBuffer(gl.ARRAY_BUFFER, unit_buf);
//     bound_array_buf = unit_buf;
//     let arr = new Uint8Array(unit_buf_len * 4);
//     for (let ii = 0; ii < unit_buf_len * 4; ++ii) {
//       arr[ii] = 255;
//     }
//     gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
//   } else {
//     if (bound_array_buf !== unit_buf) {
//       gl.bindBuffer(gl.ARRAY_BUFFER, unit_buf);
//       bound_array_buf = unit_buf;
//     }
//   }
//   gl.vertexAttribPointer(arr_idx, 4, gl.UNSIGNED_BYTE, true, 0, 0);
// }

// Verts should be ordered counter-clockwise from the upper left
function getQuadIndexBuf(quad_count) {
  assert(quad_count <= MAX_VERT_COUNT/4);
  // If not, need to split into multiple vertex and index buffers (fairly easy),
  //   or use the OES_element_index_uint extension (trivial, but probably slower, maybe not supported on mobile?)
  if (quad_count * 6 > quad_index_buf_len) {
    if (!quad_index_buf) {
      quad_index_buf = gl.createBuffer();
    } else {
      // freeing old one
      engine.perf_state.gpu_mem.geom -= quad_index_buf_len * 2;
    }
    quad_index_buf_len = min(max(ceil(quad_index_buf_len * 1.5), quad_count * 6), MAX_VERT_COUNT*6/4);
    if (bound_index_buf !== quad_index_buf) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad_index_buf);
      bound_index_buf = quad_index_buf;
    }
    let arr = new Uint16Array(quad_index_buf_len);
    let vidx = 0;
    for (let ii = 0; ii < quad_index_buf_len;) {
      arr[ii++] = vidx + 1;
      arr[ii++] = vidx + 3;
      arr[ii++] = vidx++; // 0
      arr[ii++] = vidx++; // 1
      arr[ii++] = vidx++; // 2
      arr[ii++] = vidx++; // 3
    }
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    engine.perf_state.gpu_mem.geom += quad_index_buf_len * 2;
  }
  return quad_index_buf;
}

export function geomCreateIndices(idxs) {
  let ret = {
    ibo: gl.createBuffer(),
    ibo_size: idxs.length,
  };
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ret.ibo);
  bound_index_buf = ret.ibo;
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxs, gl.STATIC_DRAW);
  engine.perf_state.gpu_mem.geom += idxs.length * 2;
  return ret;
}

function formatInfo(format) {
  if (!format.info) {
    let stride = 0;
    let elem_count = 0;
    let used_attribs = 0;
    let common_byte_size = 0;
    for (let ii = 0; ii < format.length; ++ii) {
      let fmt = format[ii];
      let sem = fmt[0];
      let gltype = fmt[1];
      let count = fmt[2];
      used_attribs |= (1 << sem);
      let byte_size = gl_byte_size[gltype];
      assert(byte_size);
      assert(!common_byte_size || byte_size === common_byte_size);
      common_byte_size = byte_size;
      fmt[3] = fmt[3] || false;
      fmt[4] = byte_size;
      stride += count * byte_size;
      elem_count += count;
    }
    format.info = {
      stride, elem_count, used_attribs, common_byte_size
    };
  }
  return format.info;
}

// format is [shaders.SEMANTIC.foo, gl.FLOAT/UNSIGNED_BYTE/etc, count, normalized]
function Geom(format, verts, idxs, mode) {
  this.mode = mode || TRIANGLES;
  this.format = format;
  let info = this.format_info = formatInfo(format);
  this.stride = info.stride;
  this.used_attribs = info.used_attribs;

  this.vert_count = verts.length / this.format_info.elem_count;
  this.vert_gpu_mem = verts.length * this.format_info.common_byte_size;
  if (verts.length) {
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    bound_array_buf = this.vbo;
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    engine.perf_state.gpu_mem.geom += this.vert_gpu_mem;
  }
  this.orig_mode = mode;
  if (idxs) {
    if (idxs.ibo) {
      this.ibo = idxs.ibo;
      this.ibo_owned = false;
      this.ibo_size = idxs.ibo_size;
    } else if (idxs.length) {
      this.ibo = gl.createBuffer();
      this.ibo_owned = true;
      this.ibo_size = idxs.length;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      bound_index_buf = this.ibo;
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxs, gl.STATIC_DRAW);
      engine.perf_state.gpu_mem.geom += idxs.length * 2;
    } else {
      // presumably updated later with .updateIndex
      this.ibo = null;
      this.ibo_owned = true;
      this.ibo_size = 0;
    }
  } else if (mode === QUADS) {
    assert.equal(this.vert_count % 4, 0);
    let quad_count = this.vert_count / 4;
    // PERFTODO: Use GL_QUADS_OES extension
    this.ibo = getQuadIndexBuf(quad_count);
    this.ibo_owned = false;
    this.ibo_size = quad_count * 6;
    this.mode = TRIANGLES;
  } else if (mode === TRIANGLE_FAN) {
    this.mode = TRIANGLE_FAN;
  } else {
    this.ibo = null;
    this.ibo_owned = false;
  }
  this.updateTriCount();
}

function trianglesFromMode(mode, eff_vert_count) {
  if (mode === TRIANGLES) {
    return eff_vert_count / 3;
  } else if (mode === TRIANGLE_FAN) {
    return eff_vert_count - 2;
  } else {
    assert(!eff_vert_count);
    return 0;
  }
}

Geom.prototype.updateTriCount = function () {
  let eff_vert_count = this.ibo ? this.ibo_size : this.vert_count;
  this.tri_count = trianglesFromMode(this.mode, eff_vert_count);
};

Geom.prototype.updateIndex = function (idxs, num_idxs) {
  assert.equal(this.ibo_owned, true);
  if (num_idxs > this.ibo_size) {
    if (bound_geom === this) {
      bound_geom = null;
    }
    engine.perf_state.gpu_mem.geom -= this.ibo_size * 2;
    deleteBuffer(this.ibo);
    this.ibo_size = idxs.length;
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    bound_index_buf = this.ibo;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxs, gl.DYNAMIC_DRAW);
    engine.perf_state.gpu_mem.geom += idxs.length * 2;
  } else {
    // Fits
    if (bound_index_buf !== this.ibo) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      bound_index_buf = this.ibo;
    }
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, idxs.subarray(0, num_idxs));
  }
  this.updateTriCount();
};

Geom.prototype.updateSub = function (offset, verts) {
  if (bound_array_buf !== this.vbo) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    bound_array_buf = this.vbo;
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, offset, verts);
};

Geom.prototype.update = function (verts, num_verts) {
  if (num_verts > this.vert_count) {
    if (bound_geom === this) {
      bound_geom = null;
    }
    engine.perf_state.gpu_mem.geom -= this.vert_gpu_mem;
    deleteBuffer(this.vbo);
    // Note: matching size, ignoring num_verts
    this.vert_count = verts.length / this.format_info.elem_count;
    this.vert_gpu_mem = verts.length * this.format_info.common_byte_size;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    bound_array_buf = this.vbo;
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    engine.perf_state.gpu_mem.geom += this.vert_gpu_mem;
  } else {
    // Fits
    if (bound_array_buf !== this.vbo) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      bound_array_buf = this.vbo;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, num_verts * this.format_info.elem_count));
    // gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  }
  if (this.orig_mode === QUADS) {
    assert.equal(this.ibo_owned, false);
    let quad_count = num_verts / 4;
    this.ibo = getQuadIndexBuf(quad_count);
    this.ibo_size = quad_count * 6;
  }
  this.updateTriCount();
};

Geom.prototype.dispose = function () {
  if (this.ibo_owned) {
    deleteBuffer(this.ibo);
  }
  this.ibo = null;
  deleteBuffer(this.vbo);
  this.vbo = null;
  engine.perf_state.gpu_mem.geom -= this.vert_gpu_mem;
  this.vert_gpu_mem = 0;
};

let bound_attribs = (function () {
  let r = [];
  for (let ii = 0; ii < 16; ++ii) {
    r.push({
      vbo: null,
      offset: 0,
    });
  }
  return r;
}());

export function geomResetState() {
  // Resetting this avoids a state management bug on Chrome 71-73 on Redmi 6A -
  //   it seems the browser was leaving something bound at a low level, perhaps
  //   from generating mipmaps or something?
  bound_geom = null;
  bound_index_buf = null;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  bound_array_buf = null;
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  for (let ii = 0; ii < MAX_SEMANTIC; ++ii) {
    gl.disableVertexAttribArray(ii);
  }
  attrib_enabled = 0;
  for (let ii = 0; ii < bound_attribs.length; ++ii) {
    bound_attribs[ii].vbo = null;
  }
  // Also resetting stats for metrics here, but could do that separately if needed
  stats.draw_calls = stats.draw_calls_geom + stats.draw_calls_sprite;
  for (let key in stats) {
    last_stats[key] = stats[key];
    stats[key] = 0;
  }
}

Geom.prototype.bind = function () {
  if (bound_geom !== this) {
    bound_geom = this;
    let vbo = this.vbo;

    let offset = 0;
    for (let ii = 0; ii < this.format.length; ++ii) {
      let fmt = this.format[ii];
      let count = fmt[2];
      let byte_size = fmt[4];
      let sem = fmt[0];
      if (bound_attribs[sem].vbo === vbo) { //  && bound_attribs[sem].offset = offset
        // already bound
      } else {
        if (bound_array_buf !== vbo) {
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          bound_array_buf = vbo;
        }
        let gltype = fmt[1];
        let normalized = fmt[3];
        gl.vertexAttribPointer(sem, count, gltype, normalized, this.stride, offset);
        bound_attribs[sem].vbo = bound_array_buf;
        // bound_attribs[sem].offset = offset;
      }
      offset += count * byte_size;
    }
    // if (!used[1]) { // COLOR
    //   used_attribs |= 1 << shader.semantics.COLOR;
    //   bindUnitBuf(1, this.vert_count);
    // }
    enableVertexAttribArray(this.used_attribs);
  }

  if (this.ibo && bound_index_buf !== this.ibo) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    bound_index_buf = this.ibo;
  }
};
Geom.prototype.draw = function () {
  this.bind();
  ++stats.draw_calls_geom;
  stats.tris += this.tri_count;
  stats.verts += this.vert_count;
  if (this.ibo) {
    gl.drawElements(this.mode, this.ibo_size, gl.UNSIGNED_SHORT, 0);
  } else {
    gl.drawArrays(this.mode, 0, this.vert_count);
  }
};
Geom.prototype.drawSub = function (start, tri_count) {
  assert.equal(this.mode, TRIANGLES);
  this.bind();
  ++stats.draw_calls_geom;
  if (this.ibo) {
    stats.tris += tri_count;
    stats.verts += tri_count*2; // assumes quads
    gl.drawElements(this.mode, tri_count * 3, gl.UNSIGNED_SHORT, start * 2);
  } else {
    gl.drawArrays(this.mode, start, tri_count * 3);
  }
};

function GeomMultiQuads(format, verts) {
  let format_info = formatInfo(format);
  let ec = format_info.elem_count;
  let vert_count = verts.length / ec;
  this.geoms = [];
  for (let idx = 0; idx < vert_count; idx += MAX_VERT_COUNT) {
    let num_sub_verts = min(vert_count - idx, MAX_VERT_COUNT);
    let sub_data = new Uint8Array(verts.buffer, idx * ec, num_sub_verts * ec);
    this.geoms.push(new Geom(format, sub_data, null, QUADS));
  }
}
GeomMultiQuads.prototype.draw = function () {
  for (let ii = 0; ii < this.geoms.length; ++ii) {
    this.geoms[ii].draw();
  }
};
GeomMultiQuads.prototype.drawSub = function (start, tri_count) {
  for (let ii = 0; ii < this.geoms.length && tri_count; ++ii) {
    let geom = this.geoms[ii];
    let num_quads = geom.vert_count / 4;
    if (start < num_quads * 6) {
      let start_quad = start / 6;
      let these = min(tri_count, (num_quads - start_quad) * 2);
      geom.drawSub(start, these);
      tri_count -= these;
      start = 0;
    } else {
      start -= num_quads * 6;
    }
  }
};
GeomMultiQuads.prototype.dispose = function () {
  for (let ii = 0; ii < this.geoms.length; ++ii) {
    this.geoms[ii].dispose();
  }
  this.geoms = null;
};

export function geomCreate(format, verts, idxs, mode) {
  return new Geom(format, verts, idxs, mode);
}

export function geomCreateQuads(format, verts, fixed_size) {
  let format_info = formatInfo(format);
  assert(fixed_size || verts instanceof Uint8Array); // only one handled by GeomMultiQuads for now
  let vert_count = verts.length / format_info.elem_count;
  if (vert_count > MAX_VERT_COUNT) {
    return new GeomMultiQuads(format, verts);
  }
  return new Geom(format, verts, null, QUADS);
}

export function geomStartup() {
  // Nothing for now.
}

// Legacy APIs
exports.createIndices = geomCreateIndices;
exports.create = geomCreate;
exports.createQuads = geomCreateQuads;
