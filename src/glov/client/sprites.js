// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code from Turbulenz: Copyright (c) 2012-2013 Turbulenz Limited
// Released under MIT License: https://opensource.org/licenses/MIT

// Legacy APIs
// eslint-disable-next-line @typescript-eslint/no-use-before-define
exports.createSprite = spriteCreate;
// eslint-disable-next-line @typescript-eslint/no-use-before-define
exports.create = spriteCreate;

export const BlendMode = {
  BLEND_ALPHA: 0,
  BLEND_ADDITIVE: 1,
  BLEND_PREMULALPHA: 2,
};
export const BLEND_ALPHA = 0;
export const BLEND_ADDITIVE = 1;
export const BLEND_PREMULALPHA = 2;

/* eslint-disable import/order */
const assert = require('assert');
const camera2d = require('./camera2d.js');
const { dynGeomQueueSprite } = require('./dyn_geom.js');
const engine = require('./engine.js');
const geom = require('./geom.js');
const { cos, max, min, round, sin } = Math;
const {
  textureCmpArray,
  textureBindArray,
  textureLoad,
  textureFilterKey,
} = require('./textures.js');
const {
  SEMANTIC,
  shaderCreate,
  shadersBind,
  shadersPrelink,
} = require('./shaders.js');
const { deprecate, nextHighestPowerOfTwo } = require('glov/common/util.js');
const { vec2, vec4, v4set } = require('glov/common/vmath.js');

deprecate(exports, 'clip', 'spriteClip');
deprecate(exports, 'clipped', 'spriteClipped');
deprecate(exports, 'clipPush', 'spriteClipPush');
deprecate(exports, 'clipPop', 'spriteClipPop');
deprecate(exports, 'clipPause', 'spriteClipPause');
deprecate(exports, 'clipResume', 'spriteClipResume');
deprecate(exports, 'queuefn', 'spriteQueueFn');
deprecate(exports, 'draw', 'spriteDraw');
deprecate(exports, 'drawPartial', 'spriteDrawPartial');

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
  this.chained = false;
  this.next = null;
}

SpriteData.prototype.queue = function (z) {
  ++geom_stats.sprites;
  if (!this.chained) {
    this.z = z;
    this.uid = ++last_uid;
    sprite_queue.push(this);
  }
};

let is_chained = false;
let chained_prev = null;
export function spriteChainedStart() {
  is_chained = true;
  chained_prev = null;
}
export function spriteChainedStop() {
  is_chained = false;
  chained_prev = null;
}

export function spriteDataAlloc(texs, shader, shader_params, blend) {
  let ret;
  if (sprite_freelist.length) {
    ret = sprite_freelist.pop();
  } else {
    ret = new SpriteData();
  }
  ret.texs = texs;
  if (is_chained && chained_prev) {
    ret.chained = true;
    chained_prev.next = ret;
  } else {
    ret.chained = false;
    ret.shader = shader || null;
    if (shader_params) {
      shader_params.clip_space = sprite_shader_params.clip_space;
      ret.shader_params = shader_params;
    } else {
      ret.shader_params = null;
    }
    ret.blend = blend || 0; // BLEND_ALPHA
  }
  if (is_chained) {
    chained_prev = ret;
  }
  return ret;
}

function cmpSprite(a, b) {
  ++geom_stats.sprite_sort_cmps;
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

export function spriteQueueFn(z, fn) {
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

let qsp = {};
function queuesprite4colorObj() {
  let {
    rot, z, sprite,
    color_ul, color_ll, color_lr, color_ur,
  } = qsp;
  assert(isFinite(z));
  let elem = spriteDataAlloc(sprite.texs, qsp.shader, qsp.shader_params, qsp.blend);
  let x = (qsp.x - camera2d.data[0]) * camera2d.data[4];
  let y = (qsp.y - camera2d.data[1]) * camera2d.data[5];
  let w = qsp.w * camera2d.data[4];
  let h = qsp.h * camera2d.data[5];
  if (qsp.pixel_perfect) {
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

  fillUVs(elem.texs[0], w, h, qsp.nozoom, qsp.uvs);
  data[2] = color_ul[0];
  data[3] = color_ul[1];
  data[4] = color_ul[2];
  data[5] = color_ul[3];
  data[6] = temp_uvs[0];
  data[7] = temp_uvs[1];

  data[10] = color_ll[0];
  data[11] = color_ll[1];
  data[12] = color_ll[2];
  data[13] = color_ll[3];
  data[14] = temp_uvs[0];
  data[15] = temp_uvs[3];

  data[18] = color_lr[0];
  data[19] = color_lr[1];
  data[20] = color_lr[2];
  data[21] = color_lr[3];
  data[22] = temp_uvs[2];
  data[23] = temp_uvs[3];

  data[26] = color_ur[0];
  data[27] = color_ur[1];
  data[28] = color_ur[2];
  data[29] = color_ur[3];
  data[30] = temp_uvs[2];
  data[31] = temp_uvs[1];

  elem.queue(z);
  return elem;
}

export function queuesprite(
  sprite, x, y, z, w, h, rot, uvs, color, shader, shader_params, nozoom,
  pixel_perfect, blend,
) {
  assert(!sprite.lazy_load); // Would be pretty easy to add support if needed
  color = color || sprite.color;
  qsp.sprite = sprite;
  qsp.x = x;
  qsp.y = y;
  qsp.z = z;
  qsp.w = w;
  qsp.h = h;
  qsp.rot = rot;
  qsp.uvs = uvs;
  qsp.color_ul = color;
  qsp.color_ll = color;
  qsp.color_lr = color;
  qsp.color_ur = color;
  qsp.shader = shader;
  qsp.shader_params = shader_params;
  qsp.nozoom = nozoom;
  qsp.pixel_perfect = pixel_perfect;
  qsp.blend = blend;
  return queuesprite4colorObj(qsp);
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

let active_scissor = null;
function scissorSet(scissor) {
  if (!active_scissor) {
    gl.enable(gl.SCISSOR_TEST);
  }
  gl.scissor(scissor[0], scissor[1], scissor[2], scissor[3]);
  active_scissor = scissor;
}
function scisssorClear() {
  gl.disable(gl.SCISSOR_TEST);
  active_scissor = null;
}

export function spriteClip(z_start, z_end, x, y, w, h) {
  let scissor = clipCoordsScissor(x, y, w, h);
  spriteQueueFn(z_start - 0.01, scissorSet.bind(null, scissor));
  spriteQueueFn(z_end - 0.01, scisssorClear);
}

let clip_stack = [];
export function spriteClipped() {
  return clip_stack.length > 0;
}

export function spriteClipPush(z, x, y, w, h) {
  assert(clip_stack.length < 10); // probably leaking
  let scissor = clipCoordsScissor(x, y, w, h);
  let dom_clip = clipCoordsDom(x, y, w, h);
  camera2d.setInputClipping(dom_clip);
  spriteQueuePush();
  clip_stack.push({
    z, scissor, dom_clip,
  });
}

export function spriteClipPop() {
  assert(spriteClipped());
  spriteQueueFn(Z.TOOLTIP - 0.1, scisssorClear);
  let { z, scissor } = clip_stack.pop();
  let sprites = sprite_queue;
  spriteQueuePop(true);
  if (clip_stack.length) {
    let { dom_clip } = clip_stack[clip_stack.length - 1];
    camera2d.setInputClipping(dom_clip);
  } else {
    camera2d.setInputClipping(null);
  }
  spriteQueueFn(z, () => {
    let prev_scissor = active_scissor;
    scissorSet(scissor);
    spriteQueuePush();
    sprite_queue = sprites;
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    spriteDraw();
    spriteQueuePop();
    // already done at Z.TOOLTIP within spriteDraw(): scisssorClear();
    if (prev_scissor) {
      scissorSet(prev_scissor);
    }
  });
}

let clip_paused;
export function spriteClipPause() {
  // Queue back into the root sprite queue
  assert(spriteClipped());
  assert(!clip_paused);
  clip_paused = true;
  spriteQueuePush(sprite_queue_stack[0]);
  camera2d.setInputClipping(null);
  // push onto the clip stack so if there's another clip push/pop we get back to
  // escaped when it pops.
  clip_stack.push({ dom_clip: null });
}
export function spriteClipResume() {
  assert(spriteClipped());
  assert(clip_paused);
  clip_stack.pop(); // remove us
  clip_paused = false;
  assert(spriteClipped());
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
      shadersBind(sprite_vshader,
        state.shader || sprite_fshader,
        state.shader_params || sprite_shader_params);
      last_bound_shader = state.shader;
    }
    if (last_blend_mode !== state.blend) {
      blendModeSet(state.blend);
    }
    textureBindArray(state.texs);
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
      [SEMANTIC.POSITION, gl.FLOAT, 2, false],
      [SEMANTIC.COLOR, gl.FLOAT, 4, false],
      [SEMANTIC.TEXCOORD, gl.FLOAT, 2, false],
    ], [], null, geom.QUADS);
    sprite_buffer = new Float32Array(1024);
    sprite_buffer_len = sprite_buffer.length / 8;
  }

  profilerStart('sort');
  sprite_queue.sort(cmpSprite);
  geom_stats.sprite_sort_elems += sprite_queue.length;
  profilerStop('sort');

  batch_state = null;
  assert.equal(sprite_buffer_idx, 0);
  assert.equal(sprite_buffer_batch_start, 0);
  assert.equal(batches.length, 0);
}

function growSpriteBuffer() {
  let new_length = min((sprite_buffer_len * 1.25 + 3) & ~3, MAX_VERT_COUNT);
  sprite_buffer_len = new_length;
  sprite_buffer = new Float32Array(new_length * 8);
}

function drawElem(elem) {
  let count = 0;
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
    count++;
  } else {
    if (!batch_state ||
      textureCmpArray(elem.texs, batch_state.texs) ||
      elem.shader !== batch_state.shader ||
      elem.shader_params !== batch_state.shader_params ||
      elem.blend !== batch_state.blend
    ) {
      commit();
      batch_state = elem;
    }
    do {
      if (sprite_buffer_idx + 4 > sprite_buffer_len) {
        commitAndFlush();
        // batch_state left alone
        if (sprite_buffer_len !== MAX_VERT_COUNT) {
          growSpriteBuffer();
        }
      }

      let index = sprite_buffer_idx * 8;
      sprite_buffer_idx += 4;

      // measurably slower:
      // for (let ii = 0; ii < 32; ++ii) {
      //   sprite_buffer[index + ii] = elem.data[ii];
      // }
      sprite_buffer.set(elem.data, index);
      count++;

      sprite_freelist.push(elem);
      let next = elem.next;
      elem.next = null;
      elem = next;
    } while (elem);
  }
  return count;
}

function finishDraw() {
  commitAndFlush();
  blendModeReset();
}

export function spriteDrawReset() {
  active_scissor = null;
}

export function spriteDraw() {
  profilerStart('sprites:draw');
  drawSetup();
  profilerStart('drawElem');
  for (let ii = 0; ii < sprite_queue.length; ++ii) {
    let elem = sprite_queue[ii];
    drawElem(elem);
  }
  profilerStop('drawElem');
  sprite_queue.length = 0;
  finishDraw();
  profilerStop('sprites:draw');
}

export function spriteDrawPartial(z) {
  profilerStart('sprites:drawPartial');
  drawSetup();
  profilerStart('drawElem');
  for (let ii = 0; ii < sprite_queue.length; ++ii) {
    let elem = sprite_queue[ii];
    if (elem.z > z) {
      sprite_queue = sprite_queue.slice(ii);
      break;
    }
    drawElem(elem);
  }
  profilerStop('drawElem');
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

function flipRectHoriz(a) {
  return vec4(a[0], a[3], a[2], a[1]);
}

export function spriteFlippedUVsApplyHFlip(spr) {
  if (!spr.uidata.rects_orig) {
    spr.uidata.rects_orig = spr.uidata.rects;
  }
  if (!spr.uidata.rects_flipped) {
    spr.uidata.rects_flipped = spr.uidata.rects.map(flipRectHoriz);
  }
  spr.uidata.rects = spr.uidata.rects_flipped;
}

export function spriteFlippedUVsRestore(spr) {
  if (spr.uidata.rects_orig) {
    spr.uidata.rects = spr.uidata.rects_orig;
  }
}

function Sprite(params) {
  this.lazy_load = null;

  if (params.texs) {
    this.texs = params.texs;
  } else {
    let ext = params.ext || '.png';
    this.texs = [];
    if (params.tex) {
      assert(!params.lazy_load);
      this.texs.push(params.tex);
    } else if (params.layers) {
      assert(params.name);
      assert(!params.lazy_load); // Not currently supported for multi-layer sprites
      this.texs = [];
      for (let ii = 0; ii < params.layers; ++ii) {
        this.texs.push(textureLoad({
          url: `img/${params.name}_${ii}${ext}`,
          filter_min: params.filter_min,
          filter_mag: params.filter_mag,
          wrap_s: params.wrap_s,
          wrap_t: params.wrap_t,
        }));
      }
    } else {
      let tex_param;
      if (params.name) {
        tex_param = {
          url: `img/${params.name}${ext}#${textureFilterKey(params)}`,
          filter_min: params.filter_min,
          filter_mag: params.filter_mag,
          wrap_s: params.wrap_s,
          wrap_t: params.wrap_t,
        };
      } else {
        assert(params.url);
        tex_param = params;
      }
      if (params.lazy_load) {
        this.lazy_load = tex_param;
      } else {
        this.texs.push(textureLoad(tex_param));
      }
    }
  }

  this.origin = params.origin || vec2(0, 0); // [0,1] range
  this.size = params.size || vec2(1, 1);
  this.color = params.color || vec4(1,1,1,1);
  this.uvs = params.uvs || vec4(0, 0, 1, 1);
  if (params.ws) {
    this.uidata = buildRects(params.ws, params.hs);
  }
  this.shader = params.shader || null;

  let tex_on_load = (tex) => {
    if (!params.uvs) {
      // Fix up non-power-of-two textures
      this.uvs[2] = tex.src_width / tex.width;
      this.uvs[3] = tex.src_height / tex.height;
    }
    if (params.ws) {
      this.uidata = buildRects(params.ws, params.hs, tex);
    }
  };
  if (this.texs.length) {
    this.texs[0].onLoad(tex_on_load);
  } else {
    this.tex_on_load = tex_on_load;
  }
}

Sprite.prototype.lazyLoadInit = function () {
  let tex = textureLoad({
    ...this.lazy_load,
    auto_unload: () => {
      this.texs = [];
    },
  });
  this.texs.push(tex);
  this.loaded_at = 0;
  if (tex.loaded) {
    // already completely loaded
    this.tex_on_load(tex);
  } else {
    tex.onLoad(() => {
      this.loaded_at = engine.frame_timestamp;
      this.tex_on_load(tex);
    });
  }
};

Sprite.prototype.lazyLoad = function () {
  if (!this.texs.length) {
    this.lazyLoadInit();
  }
  if (!this.texs[0].loaded) {
    return 0;
  }
  if (!this.loaded_at) {
    return 1;
  }
  let dt = engine.frame_timestamp - this.loaded_at;
  let alpha = dt / 250;
  if (alpha >= 1) {
    this.loaded_at = 0;
    return 1;
  }
  return alpha;
};

let temp_color = vec4();

// params:
//   required: x, y
//   optional: z, w, h, uvs, color, nozoom, pixel_perfect
Sprite.prototype.draw = function (params) {
  if (params.w === 0 || params.h === 0) {
    return null;
  }
  let color = params.color || this.color;
  if (this.lazy_load) {
    let alpha = this.lazyLoad();
    if (!alpha) {
      return null;
    }
    if (alpha !== 1) {
      color = v4set(temp_color, color[0], color[1], color[2], color[3] * alpha);
    }
  }
  let w = (params.w || 1) * this.size[0];
  let h = (params.h || 1) * this.size[1];
  let uvs = (typeof params.frame === 'number') ? this.uidata.rects[params.frame] : (params.uvs || this.uvs);
  qsp.sprite = this;
  qsp.x = params.x;
  qsp.y = params.y;
  qsp.z = params.z || Z.UI;
  qsp.w = w;
  qsp.h = h;
  qsp.rot = params.rot;
  qsp.uvs = uvs;
  qsp.color_ul = color;
  qsp.color_ll = color;
  qsp.color_lr = color;
  qsp.color_ur = color;
  qsp.shader = params.shader || this.shader;
  qsp.shader_params = params.shader_params;
  qsp.nozoom = params.nozoom;
  qsp.pixel_perfect = params.pixel_perfect;
  qsp.blend = params.blend;
  return queuesprite4colorObj(qsp);
};

Sprite.prototype.drawDualTint = function (params) {
  params.shader = sprite_dual_fshader;
  params.shader_params = {
    color1: params.color1,
  };
  return this.draw(params);
};

let temp_color_ul = vec4();
let temp_color_ll = vec4();
let temp_color_ur = vec4();
let temp_color_lr = vec4();
Sprite.prototype.draw4Color = function (params) {
  if (params.w === 0 || params.h === 0) {
    return null;
  }
  qsp.color_ul = params.color_ul;
  qsp.color_ll = params.color_ll;
  qsp.color_lr = params.color_lr;
  qsp.color_ur = params.color_ur;
  if (this.lazy_load) {
    let alpha = this.lazyLoad();
    if (!alpha) {
      return null;
    }
    if (alpha !== 1) {
      qsp.color_ul = v4set(temp_color_ul, qsp.color_ul[0], qsp.color_ul[1], qsp.color_ul[2], qsp.color_ul[3] * alpha);
      qsp.color_ll = v4set(temp_color_ll, qsp.color_ll[0], qsp.color_ll[1], qsp.color_ll[2], qsp.color_ll[3] * alpha);
      qsp.color_ur = v4set(temp_color_ur, qsp.color_ur[0], qsp.color_ur[1], qsp.color_ur[2], qsp.color_ur[3] * alpha);
      qsp.color_lr = v4set(temp_color_lr, qsp.color_lr[0], qsp.color_lr[1], qsp.color_lr[2], qsp.color_lr[3] * alpha);
    }
  }
  let w = (params.w || 1) * this.size[0];
  let h = (params.h || 1) * this.size[1];
  let uvs = (typeof params.frame === 'number') ? this.uidata.rects[params.frame] : (params.uvs || this.uvs);
  qsp.sprite = this;
  qsp.x = params.x;
  qsp.y = params.y;
  qsp.z = params.z || Z.UI;
  qsp.w = w;
  qsp.h = h;
  qsp.rot = params.rot;
  qsp.uvs = uvs;
  qsp.shader = params.shader || this.shader;
  qsp.shader_params = params.shader_params;
  qsp.nozoom = params.nozoom;
  qsp.pixel_perfect = params.pixel_perfect;
  qsp.blend = params.blend;
  return queuesprite4colorObj(qsp);
};

Sprite.prototype.draw3D = function (params) {
  // Note: ignoring this.size[] for now for simplicity, is this useful?
  // let w = (params.size[0] || 1) * this.size[0];
  // let h = (params.size[1] || 1) * this.size[1];
  if (typeof params.frame === 'number') {
    params.uvs = this.uidata.rects[params.frame];
  } else if (!params.uvs) {
    params.uvs = this.uvs;
  }
  dynGeomQueueSprite(this, params);
};


export function spriteCreate(params) {
  return new Sprite(params);
}

export function spriteStartup() {
  geom_stats = geom.stats;
  clip_space[2] = -1;
  clip_space[3] = 1;
  sprite_vshader = shaderCreate('shaders/sprite.vp');
  sprite_fshader = shaderCreate('shaders/sprite.fp');
  sprite_dual_fshader = shaderCreate('shaders/sprite_dual.fp');
  shadersPrelink(sprite_vshader, sprite_fshader);
  shadersPrelink(sprite_vshader, sprite_dual_fshader);
}
