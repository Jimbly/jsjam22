export const BUCKET_OPAQUE = 1; // sorted by state, depth writes, no blend
export const BUCKET_DECAL = 2; // sorted by state, no depth writes, blended
export const BUCKET_ALPHA = 3; // sorted by dist, blended

export const FACE_NONE = 0;
export const FACE_XY = 1<<0;
export const FACE_XYZ = 1<<1;
export const FACE_FRUSTUM = 1<<2;
export const FACE_CAMERA = 1<<3;
export const FACE_DEFAULT = FACE_XY|FACE_FRUSTUM;
export const FACE_CUSTOM = 1<<4;


const DYN_VERT_SIZE = 4*3;

const assert = require('assert');
const mat4LookAt = require('gl-mat4/lookAt');
const { log2, nextHighestPowerOfTwo } = require('glov/common/util.js');
const {
  mat4,
  v3addScale,
  v3copy,
  v3cross,
  v3iNormalize,
  v3scale,
  v3sub,
  vec3,
  zero_vec,
} = require('glov/common/vmath.js');
const { cmd_parse } = require('./cmds.js');
const engine = require('./engine.js');
const { engineStartupFunc, setGlobalMatrices } = engine;
const geom = require('./geom.js');
const { ceil, max, min } = Math;
const settings = require('./settings.js');
const {
  SEMANTIC,
  shaderCreate,
  shadersBind,
  shadersPrelink,
} = require('./shaders.js');
const sprites = require('./sprites.js');
const {
  BLEND_ALPHA,
  blendModeReset,
  blendModeSet,
} = sprites;
const { textureCmpArray, textureBindArray } = require('./textures.js');

settings.register({
  gl_polygon_offset_a: {
    default_value: 0.1,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,100],
    access_show: ['sysadmin'],
  },
  gl_polygon_offset_b: {
    default_value: 4,
    type: cmd_parse.TYPE_FLOAT,
    range: [0,100],
    access_show: ['sysadmin'],
  },
});

let mat_vp;
let mat_view = mat4();

let geom_stats;
let last_uid = 0;
let sprite_fshader;
export let sprite3d_vshader;

const sprite3d_shader_params = {};

let buckets = [
  null,
  [],
  [],
  [],
];

const TRI_QUAD = new Uint16Array([1, 3, 0, 1, 2, 3]);
const TRI_QUAD_DOUBLE = new Uint16Array([1, 3, 0, 1, 2, 3, 0, 3, 1, 3, 2, 1]);

let dyn_freelist = [];

function DynGeomData() {
  // geometry data
  this.num_tris = 0;
  this.tris = null;
  this.tri_pool_idx = 0;
  this.num_verts = 0;
  this.verts = null;
  this.vert_pool_idx = 0;
  // data for sorting/binding/etc
  this.texs = null;
  this.shader = null;
  this.vshader = null;
  this.shader_params = null;
  this.blend = 0; // BLEND_ALPHA; only if bucket > BUCKET_OPAQUE
  this.sort_z = 0;
  this.uid = 0;
}

export function dynGeomAlloc() {
  let ret;
  if (dyn_freelist.length) {
    ret = dyn_freelist.pop();
  } else {
    ret = new DynGeomData();
  }
  return ret;
}

DynGeomData.prototype.queue = function (bucket, sort_z) {
  assert(isFinite(sort_z));
  assert(this.texs);
  assert(this.shader);
  assert(this.vshader);
  this.sort_z = sort_z;
  this.uid = ++last_uid;
  ++geom_stats.dyn;
  buckets[bucket].push(this);
};

// Pool for vert and index counts up to 16k
let vert_pool = new Array(15).join(',').split(',').map(() => []);
vert_pool[0] = null;
let tri_pool = new Array(15).join(',').split(',').map(() => []);
tri_pool[0] = null;
const POOL_UPPER_LIMIT = 4096;
// Max size per vert count - use at most 1MB per pool (1MB/DYN_VERT_SIZE/4~=1<<14), max of POOL_UPPER_LIMIT entries
const VERT_POOL_MAX_SIZE = vert_pool.map((a, idx) => min(POOL_UPPER_LIMIT, 1<<(14-idx)));
// Max size per index count - use at most 1MB per pool (1MB/3/2~=1<<17), max of POOL_UPPER_LIMIT entries
const TRI_POOL_MAX_SIZE = vert_pool.map((a, idx) => min(POOL_UPPER_LIMIT, 1<<(17-idx)));

DynGeomData.prototype.allocVerts = function (num_verts) {
  this.num_verts = num_verts;
  let vert_pool_idx = log2(this.num_verts);
  assert(vert_pool_idx > 0);
  this.vert_pool_idx = vert_pool_idx;
  let pool = vert_pool[this.vert_pool_idx];
  if (pool && pool.length) {
    this.verts = pool.pop();
  } else {
    let alloc_num_verts = pool ? nextHighestPowerOfTwo(num_verts) : num_verts;
    this.verts = new Float32Array(DYN_VERT_SIZE * alloc_num_verts);
  }
};

DynGeomData.prototype.allocTris = function (num_tris) {
  this.num_tris = num_tris;
  let tri_pool_idx = log2(this.num_tris);
  assert(tri_pool_idx > 0);
  this.tri_pool_idx = tri_pool_idx;
  let pool = tri_pool[this.tri_pool_idx];
  if (pool && pool.length) {
    this.tris = pool.pop();
  } else {
    let alloc_num_tris = pool ? nextHighestPowerOfTwo(num_tris) : num_tris;
    this.tris = new Uint16Array(3 * alloc_num_tris);
  }
};

DynGeomData.prototype.alloc = function (num_verts, num_tris) {
  this.allocVerts(num_verts);
  this.allocTris(num_tris);
};

DynGeomData.prototype.allocQuad = function (doublesided) {
  this.allocVerts(4);
  this.tris = doublesided ? TRI_QUAD_DOUBLE : TRI_QUAD;
  this.num_tris = this.tris.length / 3;
  this.tri_pool_idx = 0;
};

DynGeomData.prototype.dispose = function () {
  let pool = vert_pool[this.vert_pool_idx];
  if (pool && pool.length < VERT_POOL_MAX_SIZE[this.vert_pool_idx]) {
    pool.push(this.verts);
  }
  this.verts = null;
  pool = tri_pool[this.tri_pool_idx];
  if (pool && pool.length < TRI_POOL_MAX_SIZE[this.tri_pool_idx]) {
    pool.push(this.tris);
  }
  this.tris = null;
  dyn_freelist.push(this);
};

let down = vec3();
let up = vec3();
let cam_down = vec3();
let cam_pos = vec3();
let right = vec3();
let forward = vec3();
let look_at_called = false;
export function dynGeomLookAt(cam_pos_in, target_pos, up_in) {
  look_at_called = true;
  v3copy(cam_pos, cam_pos_in);
  v3copy(up, up_in);
  v3scale(down, up, -1);
  v3sub(forward, target_pos, cam_pos);
  v3iNormalize(forward);
  v3cross(right, forward, up);
  v3iNormalize(right);
  v3cross(cam_down, forward, right);
  v3iNormalize(cam_down);
  mat4LookAt(mat_view, cam_pos, target_pos, up);
  setGlobalMatrices(mat_view);
}

let temp = vec3();
const xaxis = vec3(1,0,0);
let target_right = vec3();
export function dynGeomSpriteSetup(params) {
  assert(look_at_called); // Must call dynGeomLookAt each frame!
  let {
    pos, // 3D world position
    shader, shader_params,
    bucket,
    facing,
    vshader,
  } = params;
  bucket = bucket || BUCKET_ALPHA;
  facing = facing === undefined ? FACE_DEFAULT : facing;
  shader = shader || sprite_fshader;
  vshader = vshader || sprite3d_vshader;
  shader_params = shader_params || null;

  let my_right;
  let my_down;
  if (facing === FACE_CUSTOM) {
    my_right = params.face_right;
    my_down = params.face_down;
  } else if (facing & FACE_XY) {
    my_right = right;
    my_down = down;
  } else if (facing & FACE_XYZ) {
    my_right = right;
    my_down = cam_down;
  } else {
    my_right = xaxis;
    my_down = down;
  }
  if (my_right === right && (facing & FACE_CAMERA)) {
    v3sub(temp, pos, cam_pos);
    v3cross(target_right, temp, up);
    my_right = v3iNormalize(target_right);
  }

  let sort_z = mat_vp[2] * pos[0] +
    mat_vp[6] * pos[1] +
    mat_vp[10] * pos[2] +
    mat_vp[14];
  return {
    bucket,
    my_right,
    my_down,
    sort_z,
    shader,
    vshader,
    shader_params,
  };
}
let pos0 = vec3();
export function dynGeomQueueSprite(sprite, params) {
  let {
    bucket,
    my_right,
    my_down,
    sort_z,
    shader,
    vshader,
    shader_params,
  } = dynGeomSpriteSetup(params);
  let {
    pos, // 3D world position
    offs, // 2D offset (-x/-y is upper left), in world scale
    size, // 2D w,h, in world scale
    uvs,
    blend,
    color,
    doublesided,
  } = params;
  let elem = dynGeomAlloc();
  color = color || sprite.color;
  offs = offs || zero_vec;
  elem.shader = shader;
  elem.vshader = vshader;
  elem.shader_params = shader_params;
  elem.texs = sprite.texs;
  elem.blend = blend || BLEND_ALPHA;
  doublesided = doublesided || false;

  let { origin } = sprite;
  let [w, h] = size;
  v3addScale(pos0, pos, my_right, -origin[0] * w + offs[0]);
  v3addScale(pos0, pos0, my_down, -origin[1] * h + offs[1]);

  // TODO: rot?
  elem.allocQuad(doublesided);
  let { verts } = elem;
  // upper left
  verts[0] = pos0[0];
  verts[1] = pos0[1];
  verts[2] = pos0[2];
  verts[4] = color[0];
  verts[5] = color[1];
  verts[6] = color[2];
  verts[7] = color[3];
  verts[8] = uvs[0];
  verts[9] = uvs[1];

  // lower left
  verts[12] = pos0[0] + my_down[0] * h;
  verts[13] = pos0[1] + my_down[1] * h;
  verts[14] = pos0[2] + my_down[2] * h;
  verts[16] = color[0];
  verts[17] = color[1];
  verts[18] = color[2];
  verts[19] = color[3];
  verts[20] = uvs[0];
  verts[21] = uvs[3];

  verts[24] = pos0[0] + my_right[0] * w + my_down[0] * h;
  verts[25] = pos0[1] + my_right[1] * w + my_down[1] * h;
  verts[26] = pos0[2] + my_right[2] * w + my_down[2] * h;
  verts[28] = color[0];
  verts[29] = color[1];
  verts[30] = color[2];
  verts[31] = color[3];
  verts[32] = uvs[2];
  verts[33] = uvs[3];

  verts[36] = pos0[0] + my_right[0] * w;
  verts[37] = pos0[1] + my_right[1] * w;
  verts[38] = pos0[2] + my_right[2] * w;
  verts[40] = color[0];
  verts[41] = color[1];
  verts[42] = color[2];
  verts[43] = color[3];
  verts[44] = uvs[2];
  verts[45] = uvs[1];

  elem.queue(bucket, sort_z);
}


let batch_state;
let sprite_geom;
let sprite_buffer_vert; // Float32Array with DYN_VERT_SIZE floats per vert
let sprite_buffer_vert_cur = 0; // in floats
let sprite_buffer_idx; // Uint16Array with 3 entries per tri
let sprite_buffer_idx_cur = 0; // in indices
let sprite_buffer_idx_batch_start = 0;

let do_blending;
let last_bound_shader;
let last_bound_vshader;
const MAX_VERT_ELEM_COUNT = 65532 * DYN_VERT_SIZE; // strictly less than 65536, as index 65535 is special in WebGL2
let batches = [];
function commit() {
  if (sprite_buffer_idx_cur === sprite_buffer_idx_batch_start) {
    return;
  }
  batches.push({
    state: batch_state,
    start: sprite_buffer_idx_batch_start,
    end: sprite_buffer_idx_cur,
  });
  sprite_buffer_idx_batch_start = sprite_buffer_idx_cur;
}

function commitAndFlush() {
  commit();
  if (!batches.length) {
    return;
  }
  assert(sprite_buffer_idx_cur);
  sprite_geom.updateIndex(sprite_buffer_idx, sprite_buffer_idx_cur);
  let num_verts = sprite_buffer_vert_cur/DYN_VERT_SIZE;
  sprite_geom.update(sprite_buffer_vert, num_verts);
  sprite_geom.bind();
  geom_stats.tris += sprite_buffer_idx_cur / 3;
  geom_stats.verts += num_verts;

  for (let ii = 0; ii < batches.length; ++ii) {
    let batch = batches[ii];
    let { state, start, end } = batch;
    if (last_bound_shader !== state.shader || last_bound_vshader !== state.vshader || state.shader_params) {
      shadersBind(state.vshader, state.shader, state.shader_params || sprite3d_shader_params);
      last_bound_shader = state.shader;
      last_bound_vshader = state.vshader;
    }
    if (do_blending) {
      blendModeSet(state.blend);
    }
    textureBindArray(state.texs);
    ++geom_stats.draw_calls_dyn;
    gl.drawElements(sprite_geom.mode, end - start, gl.UNSIGNED_SHORT, start * 2);
  }

  batches.length = 0;
  sprite_buffer_vert_cur = 0;
  sprite_buffer_idx_cur = 0;
  sprite_buffer_idx_batch_start = 0;
}

function drawSetup(do_blend) {
  do_blending = do_blend;
  last_bound_shader = -1;
  last_bound_vshader = -1;

  if (!sprite_geom) {
    sprite_geom = geom.create([
      // needs to be multiple of 4 elements, for best performance
      [SEMANTIC.POSITION, gl.FLOAT, 4, false], // 1 unused
      [SEMANTIC.COLOR, gl.FLOAT, 4, false],
      [SEMANTIC.TEXCOORD, gl.FLOAT, 4, false], // 2 unused
    ], [], [], geom.TRIANGLES);
    sprite_buffer_vert = new Float32Array(1024);
    sprite_buffer_idx = new Uint16Array(1024);
  }
}

function drawElem(elem) {
  if (!batch_state ||
    textureCmpArray(elem.texs, batch_state.texs) ||
    elem.shader !== batch_state.shader ||
    elem.vshader !== batch_state.vshader ||
    elem.shader_params !== batch_state.shader_params ||
    do_blending && elem.blend !== batch_state.blend
  ) {
    commit();
    batch_state = elem;
  }
  let num_floats = elem.num_verts * DYN_VERT_SIZE;
  if (sprite_buffer_vert_cur + num_floats > sprite_buffer_vert.length) {
    commitAndFlush();
    // batch_state left alone
    if (sprite_buffer_vert.length !== MAX_VERT_ELEM_COUNT) {
      let cur_tris = sprite_buffer_vert.length / DYN_VERT_SIZE / 3;
      let new_length = min(max(num_floats, ceil(cur_tris * 1.25) * 3 * DYN_VERT_SIZE), MAX_VERT_ELEM_COUNT);
      sprite_buffer_vert = new Float32Array(new_length);
    }
  }
  let num_idxs = elem.num_tris * 3;
  if (sprite_buffer_idx_cur + num_idxs > sprite_buffer_idx.length) {
    commitAndFlush();
    // batch_state left alone
    let cur_tris = sprite_buffer_idx.length / 3;
    let new_length = max(elem.tris.length, ceil(cur_tris * 1.25) * 3);
    sprite_buffer_idx = new Uint16Array(new_length);
  }

  let vidx0 = sprite_buffer_vert_cur / DYN_VERT_SIZE;
  if (elem.verts.length === num_floats) {
    sprite_buffer_vert.set(elem.verts, sprite_buffer_vert_cur);
    sprite_buffer_vert_cur += num_floats;
  } else {
    // Could also do elem.verts.subarray() if that is more efficient?
    for (let ii = 0; ii < num_floats; ++ii) {
      sprite_buffer_vert[sprite_buffer_vert_cur++] = elem.verts[ii];
    }
  }
  for (let ii = 0; ii < num_idxs; ++ii) {
    sprite_buffer_idx[sprite_buffer_idx_cur++] = vidx0 + elem.tris[ii];
  }

  // TODO: pool on freelist
}

function finishDraw() {
  commitAndFlush();
  blendModeReset();
}

// draws [start_idx, end_idx)
// pools all drawn elements
function queueDraw(do_blend, queue, start_idx, end_idx) {
  drawSetup(do_blend);
  for (let ii = start_idx; ii < end_idx; ++ii) {
    let elem = queue[ii];
    drawElem(elem);
    elem.dispose();
  }
  finishDraw();
}


// TODO (later, in real-world test): compare changing sorting precedence
function cmpOpaue(a, b) {
  let d = a.vshader.id - b.vshader.id;
  if (d) {
    return d;
  }
  d = a.shader.id - b.shader.id;
  if (d) {
    return d;
  }
  d = textureCmpArray(a.texs, b.texs);
  if (d) {
    return d;
  }
  return a.uid - b.uid;
}

function cmpAlpha(a, b) {
  let d = b.sort_z - a.sort_z;
  if (d) {
    return d;
  }
  return a.uid - b.uid;
}

// draw Opaque and Decal buckets
export function dynGeomDrawOpaque() {
  profilerStartFunc();
  let queue = buckets[BUCKET_OPAQUE];
  if (queue.length) {
    queue.sort(cmpOpaue);
    queueDraw(false, queue, 0, queue.length);
    queue.length = 0;
  }
  queue = buckets[BUCKET_DECAL];
  if (queue.length) {
    queue.sort(cmpOpaue);
    gl.enable(gl.BLEND);
    gl.depthMask(false); // no depth writes
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-settings.gl_polygon_offset_a, -settings.gl_polygon_offset_b);
    queueDraw(true, queue, 0, queue.length);
    queue.length = 0;
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  profilerStopFunc();
}

export function dynGeomDrawAlpha() {
  profilerStartFunc();
  assert(!buckets[BUCKET_OPAQUE].length); // nothing called dynGeomDrawOpaque?
  assert(!buckets[BUCKET_DECAL].length);

  // TODO: merge with draw_list
  let queue = buckets[BUCKET_ALPHA];
  if (queue.length) {
    queue.sort(cmpAlpha);
    queueDraw(true, queue, 0, queue.length);
    queue.length = 0;
  }
  profilerStopFunc();
}

function dynGeomStartup() {
  geom_stats = geom.stats;
  sprite3d_vshader = shaderCreate('shaders/sprite3d.vp');
  sprite_fshader = sprites.sprite_fshader;
  shadersPrelink(sprite3d_vshader, sprite_fshader);
  mat_vp = engine.mat_vp;
}
engineStartupFunc(dynGeomStartup);
