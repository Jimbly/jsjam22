// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code from Turbulenz: Copyright (c) 2012-2013 Turbulenz Limited
// Released under MIT License: https://opensource.org/licenses/MIT

// eslint-disable-next-line no-use-before-define
exports.createSprite = create;
// eslint-disable-next-line no-use-before-define
exports.spritesClip = clip;

export const BLEND_ALPHA = 0;
export const BLEND_ADDITIVE = 1;
export const BLEND_PREMULALPHA = 2;

/* eslint-disable import/order */
const assert = require('assert');
const camera2d = require('./camera2d.js');
const engine = require('./engine.js');
const geom = require('./geom.js');
const { cos, max, min, round, sin } = Math;
const textures = require('./textures.js');
const { cmpTextureArray } = textures;
const shaders = require('./shaders.js');
const { nextHighestPowerOfTwo } = require('glov/common/util.js');
const { vec2, vec4 } = require('glov/common/vmath.js');

export let sprite_vshader;
export let sprite_fshader;
let sprite_dual_fshader;
let clip_space = vec4();
let sprite_shader_params = {
  clip_space
};
let last_uid = 0;
let geom_stats;

let sprite_queue = [];

let sprite_freelist = [];

let sprite_queue_stack = [];
export function spriteQueuePush(new_list) {
  assert(sprite_queue_stack.length < 10); // probably leaking
  sprite_queue_stack.push(sprite_queue);
  sprite_queue = new_list || [];
}
export function spriteQueuePop(for_pause) {
  assert(sprite_queue_stack.length);
  assert(for_pause || !sprite_queue.length);
  sprite_queue = sprite_queue_stack.pop();
}

function SpriteData() {
  // x y cr cg cb ca u v (x4)
  // data for GL queuing
  this.data = new Float32Array(32);
  // data for sorting/binding/etc
  this.texs = null;
  this.shader = null;
  this.shader_params = null;
  this.x = 0;
  this.y = 0;
  this.z = 0;
  this.blend = 0; // BLEND_ALPHA
  this.uid = 0;
}

SpriteData.prototype.queue = function (z) {
  this.z = z;
  this.uid = ++last_uid;
  ++geom_stats.sprites;
  sprite_queue.push(this);
};


export function spriteDataAlloc(texs, shader, shader_params, blend) {
  let ret;
  if (sprite_freelist.length) {
    ret = sprite_freelist.pop();
  } else {
    ret = new SpriteData();
  }
  ret.texs = texs;
  ret.shader = shader || null;
  if (shader_params) {
    shader_params.clip_space = sprite_shader_params.clip_space;
    ret.shader_params = shader_params;
  } else {
    ret.shader_params = null;
  }
  ret.blend = blend || 0; // BLEND_ALPHA
  return ret;
}

function cmpSprite(a, b) {
  if (a.z !== b.z) {
    return a.z - b.z;
  }
  if (a.blend === BLEND_ADDITIVE && b.blend === BLEND_ADDITIVE) {
    // both additive at the same Z, do not sort for performance reasons
    return 0;
  }
  if (a.y !== b.y) {
    return a.y - b.y;
  }
  if (a.x !== b.x) {
    return a.x - b.x;
  }
  return a.uid - b.uid;
}

export function queuefn(z, fn) {
  assert(isFinite(z));
  sprite_queue.push({
    fn,
    x: 0,
    y: 0,
    z,
    uid: ++last_uid,
  });
}

// 4 arbitrary positions, colors, uvs
// coordinates must be in counter-clockwise winding order
export function queueraw4color(
  texs,
  x0, y0, c0, u0, v0,
  x1, y1, c1, u1, v1,
  x2, y2, c2, u2, v2,
  x3, y3, c3, u3, v3,
  z,
  shader, shader_params, blend
) {
  assert(isFinite(z));
  let elem = spriteDataAlloc(texs, shader, shader_params, blend);
  let data = elem.data;
  // x1 y1 x2 y2 x3 y3 x4 y4 - vertices [0,8)
  // cr cg cb ca u1 v1 u2 v2 - normalized color + texture [8,16)
  // Minor perf improvement: convert by clip_space here (still just a single MAD
  //   if pre-calculated in the camera) and remove it from the shader.
  data[0] = (x0 - camera2d.data[0]) * camera2d.data[4];
  data[1] = (y0 - camera2d.data[1]) * camera2d.data[5];
  // Note: measurably slower: data.set(c0, 2);
  data[2] = c0[0];
  data[3] = c0[1];
  data[4] = c0[2];
  data[5] = c0[3];
  data[6] = u0;
  data[7] = v0;

  data[8] = (x1 - camera2d.data[0]) * camera2d.data[4];
  data[9] = (y1 - camera2d.data[1]) * camera2d.data[5];
  data[10] = c1[0];
  data[11] = c1[1];
  data[12] = c1[2];
  data[13] = c1[3];
  data[14] = u1;
  data[15] = v1;

  data[16] = (x2 - camera2d.data[0]) * camera2d.data[4];
  data[17] = (y2 - camera2d.data[1]) * camera2d.data[5];
  data[18] = c2[0];
  data[19] = c2[1];
  data[20] = c2[2];
  data[21] = c2[3];
  data[22] = u2;
  data[23] = v2;

  data[24] = (x3 - camera2d.data[0]) * camera2d.data[4];
  data[25] = (y3 - camera2d.data[1]) * camera2d.data[5];
  data[26] = c3[0];
  data[27] = c3[1];
  data[28] = c3[2];
  data[29] = c3[3];
  data[30] = u3;
  data[31] = v3;

  elem.x = data[0];
  elem.y = data[1];
  elem.queue(z);
  return elem;
}

// 4 arbitrary positions
// coordinates must be in counter-clockwise winding order
export function queueraw4(
  texs, x0, y0, x1, y1, x2, y2, x3, y3, z,
  u0, v0, u1, v1,
  color, shader, shader_params, blend
) {
  return queueraw4color(texs,
    x0, y0, color, u0, v0,
    x1, y1, color, u0, v1,
    x2, y2, color, u1, v1,
    x3, y3, color, u1, v0,
    z,
    shader, shader_params, blend);
}

// allocate with spriteDataAlloc() and then fill .data
export function queueSpriteData(elem, z) {
  assert(isFinite(z));
  let data = elem.data;
  data[0] = (data[0] - camera2d.data[0]) * camera2d.data[4];
  data[1] = (data[1] - camera2d.data[1]) * camera2d.data[5];

  data[8] = (data[8] - camera2d.data[0]) * camera2d.data[4];
  data[9] = (data[9] - camera2d.data[1]) * camera2d.data[5];

  data[16] = (data[16] - camera2d.data[0]) * camera2d.data[4];
  data[17] = (data[17] - camera2d.data[1]) * camera2d.data[5];

  data[24] = (data[24] - camera2d.data[0]) * camera2d.data[4];
  data[25] = (data[25] - camera2d.data[1]) * camera2d.data[5];

  elem.x = data[0];
  elem.y = data[1];
  elem.queue(z);
  return elem;
}

// Expects a buffer in the form of:
//   x, y, r, g, b, a, u, v, (x4)
export function queueraw4colorBuffer(
  texs, buf,
  z, shader, shader_params, blend
) {
  assert(isFinite(z));
  let elem = spriteDataAlloc(texs, shader, shader_params, blend);
  let data = elem.data;
  for (let ii = 0; ii < 32; ++ii) {
    data[ii] = buf[ii];
  }
  queueSpriteData(elem, z);
  return elem;
}


export function queueraw(
  texs, x, y, z, w, h,
  u0, v0, u1, v1,
  color, shader, shader_params, blend
) {
  return queueraw4color(texs,
    x, y, color, u0, v0,
    x, y + h, color, u0, v1,
    x + w, y + h, color, u1, v1,
    x + w, y, color, u1, v0,
    z,
    shader, shader_params, blend);
}

let temp_uvs = vec4();
function fillUVs(tex, w, h, nozoom, uvs) {
  let ubias = 0;
  let vbias = 0;
  if (!nozoom && !tex.nozoom) {
    // Bias the texture coordinates depending on the minification/magnification
    //   level so we do not get pixels from neighboring frames bleeding in
    // Use min here (was max in libGlov), to solve tooltip edges being wrong in strict pixely
    // Use max here to solve box buttons not lining up, but instead using nozoom in drawBox/drawHBox,
    //   but, that only works for magnification - need the max here for minification!
    let zoom_level = max(
      (uvs[2] - uvs[0]) * tex.width / w,
      (uvs[3] - uvs[1]) * tex.height / h,
    ); // in texels per pixel
    if (zoom_level < 1) { // magnification
      if (tex.filter_mag === gl.LINEAR) {
        // Need to bias by half a texel, so we're doing absolutely no blending with the neighboring texel
        ubias = vbias = 0.5;
      } else if (tex.filter_mag === gl.NEAREST) {
        if (engine.antialias) {
          // When antialiasing is on, even nearest sampling samples from adjacent texels, do slight bias
          // Want to bias by one *pixel's* worth
          ubias = vbias = zoom_level / 2;
        } else {
          // even without it, running into problems, just add a tiny bias!
          // In theory, don't want this if UVs are 0/1 and we're clamping?
          ubias = vbias = zoom_level * 0.01;
        }
      }
    } else if (zoom_level > 1) { // minification
      // need to apply this bias even with nearest filtering, not exactly sure why
      let mipped_texels = zoom_level / 2;
      ubias = vbias = 0.5 + mipped_texels;

    }
    if (uvs[0] > uvs[2]) {
      ubias *= -1;
    }
    if (uvs[1] > uvs[3]) {
      vbias *= -1;
    }
  }

  temp_uvs[0] = uvs[0] + ubias / tex.width;
  temp_uvs[1] = uvs[1] + vbias / tex.height;
  temp_uvs[2] = uvs[2] - ubias / tex.width;
  temp_uvs[3] = uvs[3] - vbias / tex.height;
}

// Colors counter-clockwise from upper-left
// c0 = upper left
// c1 = lower left
// c2 = lower right
// c3 = upper right
export function queuesprite4color(
  sprite, x, y, z, w, h, rot, uvs, c0, c1, c2, c3, shader, shader_params, nozoom,
  pixel_perfect, blend
) {
  assert(isFinite(z));
  let elem = spriteDataAlloc(sprite.texs, shader, shader_params, blend);
  x = (x - camera2d.data[0]) * camera2d.data[4];
  y = (y - camera2d.data[1]) * camera2d.data[5];
  w *= camera2d.data[4];
  h *= camera2d.data[5];
  if (pixel_perfect) {
    x |= 0;
    y |= 0;
    w |= 0;
    h |= 0;
  }
  elem.x = x;
  elem.y = y;
  let data = elem.data;
  if (!rot) {
    let x1 = x - sprite.origin[0] * w;
    let y1 = y - sprite.origin[1] * h;
    let x2 = x1 + w;
    let y2 = y1 + h;
    data[0] = x1;
    data[1] = y1;
    data[8] = x1;
    data[9] = y2;
    data[16] = x2;
    data[17] = y2;
    data[24] = x2;
    data[25] = y1;
  } else {
    let dx = sprite.origin[0] * w;
    let dy = sprite.origin[1] * h;

    let cosr = cos(rot);
    let sinr = sin(rot);

    let x1 = x - cosr * dx + sinr * dy;
    let y1 = y - sinr * dx - cosr * dy;
    let ch = cosr * h;
    let cw = cosr * w;
    let sh = sinr * h;
    let sw = sinr * w;

    data[0] = x1;
    data[1] = y1;
    data[8] = x1 - sh;
    data[9] = y1 + ch;
    data[16] = x1 + cw - sh;
    data[17] = y1 + sw + ch;
    data[24] = x1 + cw;
    data[25] = y1 + sw;
  }

  fillUVs(elem.texs[0], w, h, nozoom, uvs);
  data[2] = c0[0];
  data[3] = c0[1];
  data[4] = c0[2];
  data[5] = c0[3];
  data[6] = temp_uvs[0];
  data[7] = temp_uvs[1];

  data[10] = c1[0];
  data[11] = c1[1];
  data[12] = c1[2];
  data[13] = c1[3];
  data[14] = temp_uvs[0];
  data[15] = temp_uvs[3];

  data[18] = c2[0];
  data[19] = c2[1];
  data[20] = c2[2];
  data[21] = c2[3];
  data[22] = temp_uvs[2];
  data[23] = temp_uvs[3];

  data[26] = c3[0];
  data[27] = c3[1];
  data[28] = c3[2];
  data[29] = c3[3];
  data[30] = temp_uvs[2];
  data[31] = temp_uvs[1];

  elem.queue(z);
  return elem;
}

export function queuesprite(
  sprite, x, y, z, w, h, rot, uvs, color, shader, shader_params, nozoom,
  pixel_perfect, blend
) {
  color = color || sprite.color;
  return queuesprite4color(
    sprite, x, y, z, w, h, rot, uvs,
    color, color, color, color,
    shader, shader_params, nozoom,
    pixel_perfect, blend);
}

let clip_temp_xy = vec2();
let clip_temp_wh = vec2();
function clipCoordsScissor(x, y, w, h) {
  camera2d.virtualToCanvas(clip_temp_xy, [x, y]);
  clip_temp_xy[0] = round(clip_temp_xy[0]);
  clip_temp_xy[1] = round(clip_temp_xy[1]);
  camera2d.virtualToCanvas(clip_temp_wh, [x + w, y + h]);
  clip_temp_wh[0] = round(clip_temp_wh[0]) - clip_temp_xy[0];
  clip_temp_wh[1] = round(clip_temp_wh[1]) - clip_temp_xy[1];

  // let gd_w = engine.render_width || engine.width;
  let gd_h = engine.render_height || engine.height;
  return [clip_temp_xy[0], gd_h - (clip_temp_xy[1] + clip_temp_wh[1]), clip_temp_wh[0], clip_temp_wh[1]];
}

function clipCoordsDom(x, y, w, h) {
  let xywh = vec4();
  camera2d.virtualToDom(xywh, [x + w, y + h]);
  xywh[2] = xywh[0];
  xywh[3] = xywh[1];
  camera2d.virtualToDom(xywh, [x, y]);
  xywh[0] = round(xywh[0]);
  xywh[1] = round(xywh[1]);
  xywh[2] = round(xywh[2]) - xywh[0];
  xywh[3] = round(xywh[3]) - xywh[1];

  return xywh;
}

export function clip(z_start, z_end, x, y, w, h) {
  let scissor = clipCoordsScissor(x, y, w, h);
  queuefn(z_start - 0.01, () => {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(scissor[0], scissor[1], scissor[2], scissor[3]);
  });
  queuefn(z_end - 0.01, () => {
    gl.disable(gl.SCISSOR_TEST);
  });
}

let clip_stack = [];
export function clipped() {
  return clip_stack.length > 0;
}

export function clipPush(z, x, y, w, h) {
  assert(clip_stack.length < 10); // probably leaking
  let scissor = clipCoordsScissor(x, y, w, h);
  let dom_clip = clipCoordsDom(x, y, w, h);
  camera2d.setInputClipping(dom_clip);
  spriteQueuePush();
  clip_stack.push({
    z, scissor, dom_clip,
  });
}

export function clipPop() {
  assert(clipped());
  queuefn(Z.TOOLTIP - 0.1, () => {
    gl.disable(gl.SCISSOR_TEST);
  });
  let { z, scissor } = clip_stack.pop();
  let sprites = sprite_queue;
  spriteQueuePop(true);
  if (clip_stack.length) {
    let { dom_clip } = clip_stack[clip_stack.length - 1];
    camera2d.setInputClipping(dom_clip);
  } else {
    camera2d.setInputClipping(null);
  }
  queuefn(z, () => {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(scissor[0], scissor[1], scissor[2], scissor[3]);
    spriteQueuePush();
    sprite_queue = sprites;
    exports.draw();
    spriteQueuePop();
    // done at Z.TOOLTIP: gl.disable(gl.SCISSOR_TEST);
  });
}

let clip_paused;
export function clipPause() {
  // Queue back into the root sprite queue
  assert(clipped());
  assert(!clip_paused);
  clip_paused = true;
  spriteQueuePush(sprite_queue_stack[0]);
  camera2d.setInputClipping(null);
  // push onto the clip stack so if there's another clip push/pop we get back to
  // escaped when it pops.
  clip_stack.push({ dom_clip: null });
}
export function clipResume() {
  assert(clipped());
  assert(clip_paused);
  clip_stack.pop(); // remove us
  clip_paused = false;
  assert(clipped());
  let { dom_clip } = clip_stack[clip_stack.length - 1];
  spriteQueuePop(true);
  camera2d.setInputClipping(dom_clip);
}

let batch_state;
let sprite_geom;
let sprite_buffer; // Float32Array with 8 entries per vert
let sprite_buffer_len = 0; // in verts
let sprite_buffer_batch_start = 0;
let sprite_buffer_idx = 0; // in verts

let last_blend_mode;
let last_bound_shader;
const MAX_VERT_COUNT = 65532; // strictly less than 65536, as index 65535 is special in WebGL2
let batches = [];

function commit() {
  if (sprite_buffer_idx === sprite_buffer_batch_start) {
    return;
  }
  batches.push({
    state: batch_state,
    start: sprite_buffer_batch_start,
    end: sprite_buffer_idx,
  });
  sprite_buffer_batch_start = sprite_buffer_idx;
}

export function blendModeSet(blend) {
  if (last_blend_mode !== blend) {
    last_blend_mode = blend;
    if (last_blend_mode === BLEND_ADDITIVE) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    } else if (last_blend_mode === BLEND_PREMULALPHA) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }
}

export function blendModeReset(force) {
  if (last_blend_mode !== BLEND_ALPHA || force) {
    // always reset to this
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    last_blend_mode = BLEND_ALPHA;
  }
}

function commitAndFlush() {
  commit();
  if (!batches.length) {
    return;
  }
  assert(sprite_buffer_idx);
  sprite_geom.update(sprite_buffer, sprite_buffer_idx);
  sprite_geom.bind();

  for (let ii = 0; ii < batches.length; ++ii) {
    let batch = batches[ii];
    let { state, start, end } = batch;
    if (last_bound_shader !== state.shader || state.shader_params) {
      shaders.bind(sprite_vshader,
        state.shader || sprite_fshader,
        state.shader_params || sprite_shader_params);
      last_bound_shader = state.shader;
    }
    if (last_blend_mode !== state.blend) {
      blendModeSet(state.blend);
    }
    textures.bindArray(state.texs);
    ++geom_stats.draw_calls_sprite;
    gl.drawElements(sprite_geom.mode, (end - start) * 3 / 2, gl.UNSIGNED_SHORT, start * 3);
  }

  batches.length = 0;
  sprite_buffer_idx = 0;
  sprite_buffer_batch_start = 0;
}

function drawSetup() {
  if (engine.defines.NOSPRITES) {
    sprite_queue.length = 0;
  }
  if (!sprite_queue.length) {
    return;
  }

  clip_space[0] = 2 / engine.viewport[2];
  clip_space[1] = -2 / engine.viewport[3];

  last_blend_mode = -1;
  last_bound_shader = -1;

  if (!sprite_geom) {
    sprite_geom = geom.create([
      [shaders.semantic.POSITION, gl.FLOAT, 2, false],
      [shaders.semantic.COLOR, gl.FLOAT, 4, false],
      [shaders.semantic.TEXCOORD, gl.FLOAT, 2, false],
    ], [], null, geom.QUADS);
    sprite_buffer = new Float32Array(1024);
    sprite_buffer_len = sprite_buffer.length / 8;
  }

  profilerStart('sort');
  sprite_queue.sort(cmpSprite);
  profilerStop('sort');

  batch_state = null;
  assert.equal(sprite_buffer_idx, 0);
  assert.equal(sprite_buffer_batch_start, 0);
  assert.equal(batches.length, 0);
}

function drawElem(elem) {
  if (elem.fn) {
    commitAndFlush();
    batch_state = null;
    elem.fn();
    last_bound_shader = -1;
    last_blend_mode = -1;
    assert.equal(sprite_buffer_idx, 0);
    assert.equal(sprite_buffer_batch_start, 0);
    assert.equal(batches.length, 0);

    clip_space[0] = 2 / engine.viewport[2];
    clip_space[1] = -2 / engine.viewport[3];
  } else {
    if (!batch_state ||
      cmpTextureArray(elem.texs, batch_state.texs) ||
      elem.shader !== batch_state.shader ||
      elem.shader_params !== batch_state.shader_params ||
      elem.blend !== batch_state.blend
    ) {
      commit();
      batch_state = elem;
    }
    if (sprite_buffer_idx + 4 > sprite_buffer_len) {
      commitAndFlush();
      // batch_state left alone
      if (sprite_buffer_len !== MAX_VERT_COUNT) {
        let new_length = min((sprite_buffer_len * 1.25 + 3) & ~3, MAX_VERT_COUNT);
        sprite_buffer_len = new_length;
        sprite_buffer = new Float32Array(new_length * 8);
      }
    }

    let index = sprite_buffer_idx * 8;
    sprite_buffer_idx += 4;

    // measurably slower:
    // for (let ii = 0; ii < 32; ++ii) {
    //   sprite_buffer[index + ii] = elem.data[ii];
    // }
    sprite_buffer.set(elem.data, index);

    sprite_freelist.push(elem);
  }
}

function finishDraw() {
  commitAndFlush();
  blendModeReset();
}

export function draw() {
  profilerStart('sprites:draw');
  drawSetup();
  profilerStart('drawElem');
  for (let ii = 0; ii < sprite_queue.length; ++ii) {
    let elem = sprite_queue[ii];
    drawElem(elem);
  }
  profilerStop('drawElem', sprite_queue.length);
  sprite_queue.length = 0;
  finishDraw();
  profilerStop('sprites:draw', sprite_queue.length);
}

export function drawPartial(z) {
  profilerStart('sprites:drawPartial');
  drawSetup();
  profilerStart('drawElem');
  let ii;
  for (ii = 0; ii < sprite_queue.length; ++ii) {
    let elem = sprite_queue[ii];
    if (elem.z > z) {
      sprite_queue = sprite_queue.slice(ii);
      break;
    }
    drawElem(elem);
  }
  profilerStop('drawElem', ii);
  finishDraw();
  profilerStop('sprites:drawPartial');
}

export function buildRects(ws, hs, tex) {
  let rects = [];
  let total_w = 0;
  for (let ii = 0; ii < ws.length; ++ii) {
    total_w += ws[ii];
  }
  let total_h = 0;
  for (let ii = 0; ii < hs.length; ++ii) {
    total_h += hs[ii];
  }
  let tex_w;
  let tex_h;
  if (!tex || nextHighestPowerOfTwo(tex.src_width) === tex.width &&
    nextHighestPowerOfTwo(tex.src_height) === tex.height
  ) {
    // texture is in fact power of two, or assume it will be
    tex_w = nextHighestPowerOfTwo(total_w);
    tex_h = nextHighestPowerOfTwo(total_h);
  } else {
    // Assume snuggly fitting, use the summed w/h, which might be a multiple of
    //   the actual w/h, but should be correct relative to the specified `ws` and `hs`
    tex_w = total_w;
    tex_h = total_h;
  }
  let wh = [];
  for (let ii = 0; ii < ws.length; ++ii) {
    wh.push(ws[ii] / total_h);
  }
  let hw = [];
  for (let ii = 0; ii < hs.length; ++ii) {
    hw.push(hs[ii] / total_w);
  }
  let aspect = [];
  let non_square = false;
  let y = 0;
  for (let jj = 0; jj < hs.length; ++jj) {
    let x = 0;
    for (let ii = 0; ii < ws.length; ++ii) {
      let r = vec4(x / tex_w, y / tex_h,
        (x + ws[ii]) / tex_w, (y + hs[jj]) / tex_h);
      rects.push(r);
      let asp = ws[ii] / hs[jj];
      if (asp !== 1) {
        non_square = true;
      }
      aspect.push(asp);
      x += ws[ii];
    }
    y += hs[jj];
  }
  return {
    widths: ws,
    heights: hs,
    wh,
    hw,
    rects,
    aspect: non_square ? aspect : null,
    total_w,
    total_h,
  };
}

function Sprite(params) {
  if (params.texs) {
    this.texs = params.texs;
  } else {
    let ext = params.ext || '.png';
    this.texs = [];
    if (params.tex) {
      this.texs.push(params.tex);
    } else if (params.layers) {
      assert(params.name);
      this.texs = [];
      for (let ii = 0; ii < params.layers; ++ii) {
        this.texs.push(textures.load({
          url: `img/${params.name}_${ii}${ext}`,
          filter_min: params.filter_min,
          filter_mag: params.filter_mag,
          wrap_s: params.wrap_s,
          wrap_t: params.wrap_t,
        }));
      }
    } else if (params.name) {
      this.texs.push(textures.load({
        url: `img/${params.name}${ext}`,
        filter_min: params.filter_min,
        filter_mag: params.filter_mag,
        wrap_s: params.wrap_s,
        wrap_t: params.wrap_t,
      }));
    } else {
      assert(params.url);
      this.texs.push(textures.load(params));
    }
  }

  this.origin = params.origin || vec2(0, 0); // [0,1] range
  this.size = params.size || vec2(1, 1);
  this.color = params.color || vec4(1,1,1,1);
  this.uvs = params.uvs || vec4(0, 0, 1, 1);
  if (!params.uvs) {
    // Fix up non-power-of-two textures
    this.texs[0].onLoad((tex) => {
      this.uvs[2] = tex.src_width / tex.width;
      this.uvs[3] = tex.src_height / tex.height;
    });
  }

  if (params.ws) {
    this.uidata = buildRects(params.ws, params.hs);
    this.texs[0].onLoad((tex) => {
      this.uidata = buildRects(params.ws, params.hs, tex);
    });
  }
  this.shader = params.shader || null;
}

// params:
//   required: x, y
//   optional: z, w, h, uvs, color, nozoom, pixel_perfect
Sprite.prototype.draw = function (params) {
  if (params.w === 0 || params.h === 0) {
    return null;
  }
  let w = (params.w || 1) * this.size[0];
  let h = (params.h || 1) * this.size[1];
  let uvs = (typeof params.frame === 'number') ? this.uidata.rects[params.frame] : (params.uvs || this.uvs);
  return queuesprite(this, params.x, params.y, params.z || Z.UI, w, h, params.rot, uvs, params.color || this.color,
    params.shader || this.shader, params.shader_params, params.nozoom, params.pixel_perfect, params.blend);
};

Sprite.prototype.drawDualTint = function (params) {
  params.shader = sprite_dual_fshader;
  params.shader_params = {
    color1: params.color1,
  };
  return this.draw(params);
};

Sprite.prototype.draw4Color = function (params) {
  if (params.w === 0 || params.h === 0) {
    return null;
  }
  let w = (params.w || 1) * this.size[0];
  let h = (params.h || 1) * this.size[1];
  let uvs = (typeof params.frame === 'number') ? this.uidata.rects[params.frame] : (params.uvs || this.uvs);

  return queuesprite4color(this,
    params.x, params.y, params.z || Z.UI, w, h,
    params.rot, uvs,
    params.color_ul, params.color_ll, params.color_lr, params.color_ur,
    params.shader || this.shader,
    params.shader_params, params.nozoom,
    params.pixel_perfect, params.blend);
};

export function create(params) {
  return new Sprite(params);
}

export function startup() {
  geom_stats = geom.stats;
  clip_space[2] = -1;
  clip_space[3] = 1;
  sprite_vshader = shaders.create('shaders/sprite.vp');
  sprite_fshader = shaders.create('shaders/sprite.fp');
  sprite_dual_fshader = shaders.create('shaders/sprite_dual.fp');
  shaders.prelink(sprite_vshader, sprite_fshader);
  shaders.prelink(sprite_vshader, sprite_dual_fshader);
}
