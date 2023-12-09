// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-bitwise:off */

/* eslint-disable import/order */
const assert = require('assert');
const camera2d = require('./camera2d.js');
const { alphaDraw, alphaDrawListSize, alphaListPush, alphaListPop } = require('./draw_list.js');
const effects = require('./effects.js');
const engine = require('./engine.js');
const { framebufferCapture } = require('./framebuffer.js');
const mat4LookAt = require('gl-mat4/lookAt');
const { max, PI, tan } = Math;
const { shaderCreate, shadersPrelink } = require('./shaders.js');
const sprites = require('./sprites.js');
const { spriteCreate } = require('glov/client/sprites.js');
const {
  blendModeSet,
  BLEND_ALPHA,
} = sprites;
const { textureCreateForCapture } = require('./textures.js');
const {
  mat4,
  vec3,
  v3addScale,
  v3copy,
  vec4,
  v4copy,
  zaxis,
} = require('glov/common/vmath.js');
const {
  qRotateZ,
  qTransformVec3,
  quat,
  unit_quat
} = require('./quat.js');

export let OFFSET_GOLDEN = vec3(-1 / 1.618, -1, 1 / 1.618 / 1.618);
let snapshot_shader;

let viewport_save = vec4();

export function viewportRenderPrepare(param) {
  const { pre, viewport } = param;
  v4copy(viewport_save, engine.viewport);
  alphaListPush();
  sprites.spriteQueuePush();
  camera2d.push();
  if (pre) {
    pre();
  }

  blendModeSet(BLEND_ALPHA);
  gl.enable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.enable(gl.CULL_FACE);

  engine.setViewport(viewport);
  camera2d.setNormalized();
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(viewport[0], viewport[1], viewport[2], viewport[3]);
}

export function viewportRenderFinish(param) {
  const { post } = param;
  gl.disable(gl.SCISSOR_TEST);
  if (post) {
    post();
  }
  alphaListPop();
  camera2d.pop();
  sprites.spriteQueuePop();
  engine.setViewport(viewport_save);
  engine.startSpriteRendering();
}


let view_mat = mat4();
let target_pos = vec3();
let camera_pos = vec3();
let camera_offset_rot = vec3();
let quat_rot = quat();
let capture_uvs = vec4(0, 1, 1, 0);
const FOV = 15 / 180 * PI;
const DIST_SCALE = 0.5 / tan(FOV / 2) * 1.1;
let last_snapshot_idx = 0;
// returns sprite
// { w, h, pos, size, draw(), [rot], [sprite], [snapshot_backdrop] }
export function snapshot(param) {
  assert(!engine.had_3d_this_frame); // must be before general 3D init

  let camera_offset = param.camera_offset || OFFSET_GOLDEN;

  let name = param.name || `snapshot_${++last_snapshot_idx}`;
  let auto_unload = param.on_unload;
  let texs = param.sprite && param.sprite.texs || [
    textureCreateForCapture(`${name}(0)`, auto_unload),
    textureCreateForCapture(`${name}(1)`, auto_unload)
  ];

  param.viewport = [0, 0, param.w, param.h];
  viewportRenderPrepare(param);

  let max_dim = max(param.size[0], param.size[2]);
  let dist = max_dim * DIST_SCALE + param.size[1] / 2;
  engine.setupProjection(FOV, param.w, param.h, 0.1, dist * 2);
  v3addScale(target_pos, param.pos, param.size, 0.5);
  if (param.rot) {
    qRotateZ(quat_rot, unit_quat, param.rot);
    qTransformVec3(camera_offset_rot, camera_offset, quat_rot);
  } else {
    v3copy(camera_offset_rot, camera_offset);
  }
  v3addScale(camera_pos, target_pos, camera_offset_rot, dist);
  mat4LookAt(view_mat, camera_pos, target_pos, zaxis);
  engine.setGlobalMatrices(view_mat);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  if (param.snapshot_backdrop) {
    gl.depthMask(false);
    effects.applyCopy({ source: param.snapshot_backdrop, no_framebuffer: true });
    gl.depthMask(true);
  }
  param.draw();
  if (alphaDrawListSize()) {
    alphaDraw();
    gl.depthMask(true);
  }
  // TODO: use new framebuffer API here
  framebufferCapture(texs[0], param.w, param.h, true, false);

  gl.clearColor(1, 1, 1, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (param.snapshot_backdrop) {
    gl.depthMask(false);
    effects.applyCopy({ source: param.snapshot_backdrop, no_framebuffer: true });
    gl.depthMask(true);
  }
  param.draw();
  if (alphaDrawListSize()) {
    alphaDraw();
    gl.depthMask(true);
  }
  // PERFTODO: we only need to capture the red channel, does that speed things up and use less mem?
  framebufferCapture(texs[1], param.w, param.h, true, false);

  viewportRenderFinish(param);

  if (!param.sprite) {
    param.sprite = spriteCreate({
      texs,
      shader: snapshot_shader,
      uvs: capture_uvs,
    });
  }
  return param.sprite;
}

export function snapshotStartup() {
  snapshot_shader = shaderCreate('shaders/snapshot.fp');
  shadersPrelink(sprites.sprite_vshader, snapshot_shader);
}
