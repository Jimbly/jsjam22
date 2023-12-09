// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint-env browser */

/* eslint-disable import/order */
require('./bootstrap.js'); // Just in case it's not in app.js

const client_config = require('./client_config.js');
export let DEBUG = client_config.MODE_DEVELOPMENT;

let startup_funcs = [];

exports.require = require; // For browser console debugging

const assert = require('assert');
const { is_ios_safari } = require('./browser.js');
const { buildUIStartup } = require('./build_ui.js');
const camera2d = require('./camera2d.js');
const cmds = require('./cmds.js');
const { dataErrorQueueEnable } = require('glov/common/data_error.js');
const effects = require('./effects.js');
const { effectsReset, effectsTopOfFrame, effectsIsFinal, effectsPassAdd, effectsPassConsume } = effects;
const {
  errorReportDisable,
  errorReportSetTimeAccum,
  errorReportSetDetails,
  glovErrorReportDisableSubmit,
  glovErrorReportSetCrashCB,
} = require('./error_report.js');
const glov_font = require('./font.js');
const { fontTick } = glov_font;
const { framebufferStart, framebufferEndOfFrame } = require('./framebuffer.js');
const { geomResetState, geomStartup } = require('./geom.js');
const input = require('./input.js');
const { inputAllowAllEvents } = require('./input.js');
const local_storage = require('./local_storage.js');
const mat3FromMat4 = require('gl-mat3/fromMat4');
const mat4Copy = require('gl-mat4/copy');
const mat4Invert = require('gl-mat4/invert');
const mat4Mul = require('gl-mat4/multiply');
const mat4Transpose = require('gl-mat4/transpose');
const mat4Perspective = require('gl-mat4/perspective');
const { asin, cos, floor, min, max, PI, round, sin, sqrt } = Math;
const { modelLoadCount, modelStartup } = require('./models.js');
const perf = require('./perf.js');
const { profilerFrameStart, profilerGarbageEstimate } = require('./profiler.js');
const { profilerUIStartup } = require('./profiler_ui.js');
const { perfCounterTick } = require('glov/common/perfcounters.js');
const settings = require('./settings.js');
const shaders = require('./shaders.js');
const {
  shadersAddGlobal,
  shadersHandleDefinesChanged,
  shadersStartup,
  shadersResetState,
} = require('./shaders.js');
const { shaderDebugUIStartup } = require('./shader_debug_ui.js');
const { soundLoading, soundStartup, soundTick } = require('./sound.js');
const { spotEndInput } = require('./spot.js');
const {
  blendModeReset,
  spriteDraw,
  spriteDrawReset,
  spriteStartup,
} = require('./sprites.js');
const {
  textureBind,
  textureDefaultFilters,
  textureError,
  textureLoadCount,
  textureResetState,
  textureStartup,
  textureTick,
} = require('./textures.js');
const glov_transition = require('./transition.js');
const {
  drawRect,
  internal: {
    cleanupDOMElems,
    uiEndFrame,
    uiSetFonts,
    uiStartup,
    uiTick,
  },
  uiBindSounds,
} = require('./ui.js');
const urlhash = require('./urlhash.js');
const { callEach, clamp, nearSame, ridx } = require('glov/common/util.js');
const verify = require('glov/common/verify.js');
const {
  mat3, mat4,
  mat4isFinite,
  vec3, vec4, v3mulMat4, v3iNormalize, v4copy, v4same, v4set,
} = require('glov/common/vmath.js');
const { webFSStartup } = require('./webfs.js');
const { profanityStartupLate } = require('./words/profanity.js');

export let canvas;
export let webgl2;
export let glov_particles;

export let width;
export let height;
let width_3d;
let height_3d;
export let pixel_aspect = 1;
export let dom_to_canvas_ratio = window.devicePixelRatio || 1;
export let antialias;
export let antialias_unavailable;

export let game_width;
export let game_height;
let game_aspect;

export let render_width;
export let render_height;

//eslint-disable-next-line @typescript-eslint/no-use-before-define
export let defines = urlhash.register({ key: 'D', type: urlhash.TYPE_SET, change: definesChanged });

urlhash.register({ key: 'nocoop' }); // needed if server is using request_utils:setupRequestHeaders

export let ZFAR;
export let ZNEAR;
export let fov_y = 1;
export let fov_x = 1;

export let mat_projection = mat4();
export let mat_view = mat4();
let mat_m = mat4();
export let mat_vp = mat4();
let mat_mv = mat4();
let mat_mv_no_skew = mat4();
let mat_mvp = mat4();
let mat_mv_inv_transform = mat3();
let mat_inv_view = mat3();
// let projection_inverse = vec4();

export let light_diffuse = vec3(0.75, 0.75, 0.75);
export let light_ambient = vec3(0.25, 0.25, 0.25);
export let light_dir_ws = vec3(-1, -2, -3);

export let font;
export let app_state = null;
export const border_color = vec4(0, 0, 0, 1);
export let border_clear_color = vec4(0, 0, 0, 1);

let no_render = false;
let dirty_render = false;
let render_frames_needed = 3;

export function renderNeeded(frames) {
  // default 3 frames - 1 gets eaten immediately, one to show the result of the input, one to get back to steady state
  render_frames_needed = max(render_frames_needed, frames || 3);
}

export function disableRender(new_value) {
  no_render = new_value;
  inputAllowAllEvents(no_render);
  if (no_render) {
    cleanupDOMElems();
  }
}

let view_space_globals = [];
export function addViewSpaceGlobal(name) {
  let ws_name = `${name}_ws`;
  let ws_vec = shaders.globals[ws_name];
  assert(ws_vec);
  assert.equal(ws_vec.length, 3);
  let vs_name = `${name}_vs`;
  let vs_vec = vec3();
  shadersAddGlobal(vs_name, vs_vec);
  view_space_globals.push({
    vs: vs_vec,
    ws: ws_vec,
  });
}

let mat_temp = mat4();
export function setGlobalMatrices(_mat_view) {
  assert(mat4isFinite(_mat_view));
  mat4Copy(mat_view, _mat_view);
  mat4Mul(mat_vp, mat_projection, mat_view);
  v3iNormalize(light_dir_ws);
  for (let ii = 0; ii < view_space_globals.length; ++ii) {
    let vsg = view_space_globals[ii];
    v3mulMat4(vsg.vs, vsg.ws, mat_view);
  }
  mat4Invert(mat_temp, mat_view);
  mat3FromMat4(mat_inv_view, mat_temp);
}

// Just set up mat_vp and mat_projection
export function setMatVP(_mat_view) {
  assert(mat4isFinite(_mat_view));
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  setupProjection(fov_y, width_3d, height_3d, ZNEAR, ZFAR);
  mat4Copy(mat_view, _mat_view);
  mat4Mul(mat_vp, mat_projection, mat_view);
}

export function setFOV(fov_min) {
  let w = width_3d;
  let h = height_3d;
  let aspect = w / h;
  if (aspect > game_aspect) {
    fov_y = fov_min;
    let rise = sin(fov_y / 2) / cos(fov_y / 2) * aspect;
    fov_x = 2 * asin(rise / sqrt(rise * rise + 1));
  } else {
    // Calculate what fov_x would be if the screen was game_aspect, then derive fov_y from that
    let rise = sin(fov_min / 2) / cos(fov_min / 2) * game_aspect;
    fov_x = 2 * asin(rise / sqrt(rise * rise + 1));
    // Old method, just apply fov to x (it's the same thing, if game_aspect is 1.0)
    // fov_x = fov_min;
    let rise2 = sin(fov_x / 2) / cos(fov_x / 2) / aspect;
    fov_y = 2 * asin(rise2 / sqrt(rise2 * rise2 + 1));
  }
}

export function setGameDims(w, h) {
  game_width = w;
  game_height = h;
  game_aspect = game_width / game_height;
}

// Didn't need this for a while, but got slow on iOS recently :(
// Better when using FBOs for postprocessing now, though!
const postprocessing_reset_version = '5';
export let postprocessing = local_storage.get('glov_no_postprocessing') !== postprocessing_reset_version;
export function postprocessingAllow(allow) {
  local_storage.set('glov_no_postprocessing', allow ? undefined : postprocessing_reset_version);
  postprocessing = allow;
}

export function glCheckError() {
  let gl_err = gl.getError();
  if (gl_err) {
    console.error(gl_err);
    throw new Error(gl_err);
  }
}

export function releaseCanvas() {
  try {
    if (gl) {
      let ext = gl.getExtension('WEBGL_lose_context');
      if (ext) {
        ext.loseContext();
      }
    }
  } catch (ignored) {
    // nothing, it's fine
  }
}

export function reloadSafe() {
  // Do not report any errors after this point
  errorReportDisable();
  // Release canvas to not leak memory on Firefox
  releaseCanvas();
  if (window.FBInstant) {
    try {
      window.top.location.reload();
    } catch (e) {
      try {
        document.location.reload();
      } catch {
        // Not good, but better than the alternatives, I guess
        window.FBInstant.quit();
      }
    }
  } else {
    document.location.reload();
  }
}
window.reloadSafe = reloadSafe;

let reloading_defines = {};
export function defineCausesReload(define) {
  reloading_defines[define] = defines[define];
}
defineCausesReload('FORCEWEBGL2');
defineCausesReload('NOWEBGL2');
let define_change_cbs = {};
export function defineOnChange(define, cb) {
  let elem = define_change_cbs[define] = define_change_cbs[define] || {
    value: defines[define],
    cbs: [],
  };
  elem.cbs.push(cb);
}
export function definesChanged() {
  for (let key in reloading_defines) {
    if (defines[key] !== reloading_defines[key]) {
      urlhash.onURLChange(reloadSafe);
      break;
    }
  }
  for (let key in define_change_cbs) {
    let elem = define_change_cbs[key];
    if (defines[key] !== elem.value) {
      elem.value = defines[key];
      callEach(elem.cbs);
    }
  }
  shadersHandleDefinesChanged();
}
export function definesClearAll() {
  let any_changed = false;
  for (let key in defines) {
    defines[key] = false;
    any_changed = true;
  }
  if (any_changed) {
    definesChanged();
  }
  return any_changed;
}

function normalizeRow(m, idx) {
  let len = m[idx]*m[idx] + m[idx+1]*m[idx+1] + m[idx+2]*m[idx+2];
  if (len > 0) {
    len = 1 / sqrt(len);
    m[idx] *= len;
    m[idx+1] *= len;
    m[idx+2] *= len;
  }
}

export function updateMatrices(mat_model) {
  // PERFTODO: depending on rendering path, only some of these are needed (m + vp or just mvp)
  mat4Copy(mat_m, mat_model);

  mat4Mul(mat_mv, mat_view, mat_model);
  mat4Mul(mat_mvp, mat_projection, mat_mv);
  // TODO: Can expand and simplify all of this, especially below
  // Compute the inverse transform of thee model_view matrix, discarding scale,
  // to be used for getting normals into view space
  mat4Copy(mat_temp, mat_model);
  normalizeRow(mat_temp, 0);
  normalizeRow(mat_temp, 4);
  normalizeRow(mat_temp, 8);
  mat4Mul(mat_mv_no_skew, mat_view, mat_temp);
  mat4Invert(mat_temp, mat_mv_no_skew);
  mat4Transpose(mat_temp, mat_temp);
  mat3FromMat4(mat_mv_inv_transform, mat_temp);
}
export let frame_timestamp = 0;
export function getFrameTimestamp() {
  return frame_timestamp;
}

export let frame_index = 0;
export function getFrameIndex() {
  return frame_index;
}

export let frame_dt = 0;
export function getFrameDt() {
  return frame_dt;
}

export let hrtime = 0;

// Wall time, may contain large jumps, may be 0 or negative
let this_frame_time_actual = 0;
export function getFrameDtActual() {
  return this_frame_time_actual;
}

let after_loading_state = null;
export let is_loading = true;
export function setState(new_state) {
  if (is_loading) {
    after_loading_state = new_state;
  } else {
    app_state = new_state;
  }
  renderNeeded();
}

export function stateActive(test_state) {
  if (is_loading) {
    return after_loading_state === test_state;
  } else {
    return app_state === test_state;
  }
}

let mspf = 1000;
let mspf_update_time = 0;
let mspf_frame_count = 0;
let last_tick_cpu = 0;
let mspf_tick = 1000;
// let net_time = 1000;
let mspf_tick_accum = 0;
// let net_time_accum = 0;
let garbage_estimate = 0;
export const PERF_HISTORY_SIZE = 128;
export let perf_state = window.glov_perf_state = {
  fpsgraph: {
    index: 0,
    history: new Float32Array(PERF_HISTORY_SIZE * 2),
  },
  gpu_mem: {
    tex: 0,
    geom: 0,
  },
};
let fpsgraph = perf_state.fpsgraph;

perf.addMetric({
  name: 'fps',
  show_stat: 'show_fps', // always, if we're showing any metrics
  show_graph: 'fps_graph',
  labels: {
    'fps: ': () => (1000 / mspf).toFixed(1),
    'ms/f: ': () => mspf.toFixed(0),
    'cpu: ': () => mspf_tick.toFixed(0),
    'gc/f: ': () => (garbage_estimate ? garbage_estimate.toFixed(1) : ''),
    // 'net: ': () => net_time.toFixed(0),
  },
  data: fpsgraph, // contain .index and .history (stride of colors.length)
  line_scale_top: 50,
  colors: [
    // vec4(0.161, 0.678, 1, 1), // net time
    vec4(1, 0.925, 0.153, 1), // cpu/tick time
    vec4(0, 0.894, 0.212, 1), // total time (GPU)
  ],
}, true);

let do_borders = true;
let do_viewport_postprocess = false;
let need_repos = 0;

export function resizing() {
  return need_repos;
}

let app_tick_functions = [];
export function addTickFunc(cb) {
  app_tick_functions.push(cb);
}

export function removeTickFunc(cb) {
  let idx = app_tick_functions.indexOf(cb);
  if (idx !== -1) {
    app_tick_functions.splice(idx, 1);
    return true;
  }
  return false;
}

let post_tick = [];
export function postTick(opts) {
  opts.ticks = opts.ticks || 1; // run in how many ticks?
  opts.inactive = opts.inactive || false; // run even if inactive?
  assert.equal(typeof opts.fn, 'function');
  post_tick.push(opts);
}

let pre_sprite_render = null;
export function preSpriteRender(fn) {
  if (!pre_sprite_render) {
    pre_sprite_render = [];
  }
  pre_sprite_render.push(fn);
}

let post_render = null;
export function postRender(fn) {
  if (!post_render) {
    post_render = [];
  }
  post_render.push(fn);
}

function resetEffects() {
  effectsReset();
  framebufferEndOfFrame();
}

export function renderWidth() {
  return render_width || width;
}
export function renderHeight() {
  return render_height || height;
}

const SAFARI_FULLSCREEN_ASPECT = (function () {
  let screen = window.screen;
  if (!is_ios_safari || !screen) {
    return 0;
  }
  const SAFARI_DIMS = { // wxh : [fullscreen aspect]
    // iPhone XR
    // iPhone 11 Pro Max
    // iPhone XS Max
    // iPhone 11
    '896,414': 896/414,
    // iPhone 11 Pro
    // iPhone X (probably)
    '812,375': 812/375,
    // iPhone 8 Plus
    '736,414': 736/414,
    // iPhone 6s+
    // iPhone 6+
    '716,414': 736/414, // (screen.availWidth reports 20 less)
    // iPhone 8
    // iPhone 7 (10.1)
    // iPhone 7 (11.4)
    '667,375': 667/375,
    // iPhone 6s
    // iPhone 6
    '647,375': 667/375, // (screen.availWidth reports 20 less)
    // iPhone 5s
    '548,320': 568/320, // (screen.availWidth reports 20 less)
  };
  let key = `${max(screen.availWidth, screen.availHeight)},${min(screen.availWidth, screen.availHeight)}`;
  return SAFARI_DIMS[key] || 0;
}());
function safariTopSafeArea(view_w, view_h) {
  // Detect if the URL bar is hidden, but should be a safe area
  if (SAFARI_FULLSCREEN_ASPECT && nearSame(view_w/view_h, SAFARI_FULLSCREEN_ASPECT, 0.001)) {
    // Note: if user has scaling enabled, the padding required might be different
    //   but the same holds true for the safe area padding detected via CSS!
    return 50 * (window.devicePixelRatio || 1); // seems to be 50pts on all devices
  }
  return 0;
}


let last_canvas_width;
let last_canvas_height;
let last_body_height;
let safearea_elem;
let safearea_ignore_bottom = false;
let safearea_values = [0,0,0,0];
let last_safearea_values = [0,0,0,0];
function checkResize() {
  profilerStart('checkResize');
  // use VisualViewport on at least iOS Safari - deal with tabs and keyboard
  //   shrinking the viewport without changing the window height
  let vv = window.visualViewport || {};
  dom_to_canvas_ratio = window.devicePixelRatio || 1;
  dom_to_canvas_ratio *= settings.render_scale_all;
  let view_w = (vv.width || window.innerWidth);
  let view_h = (vv.height || window.innerHeight);
  if (view_h !== last_body_height) {
    // set this *before* getting canvas and safearea_elem dims below
    last_body_height = view_h;
    if (document.body) {
      document.body.style.height = `${view_h}px`;
    }
  }
  let rect = canvas.getBoundingClientRect();
  let new_width = round(rect.width * dom_to_canvas_ratio) || 1;
  let new_height = round(rect.height * dom_to_canvas_ratio) || 1;

  if (cmds.safearea[0] === -1) {
    if (safearea_elem) {
      let sa_width = safearea_elem.offsetWidth;
      let sa_height = safearea_elem.offsetHeight;
      if (sa_width && sa_height) {
        v4set(safearea_values,
          safearea_elem.offsetLeft * dom_to_canvas_ratio,
          new_width - (sa_width + safearea_elem.offsetLeft) * dom_to_canvas_ratio,
          max(safearea_elem.offsetTop * dom_to_canvas_ratio,
            safariTopSafeArea(view_w, view_h) * settings.render_scale_all),
          // Note: Possibly ignoring bottom safe area, it seems not useful on iPhones (does not
          //  adjust when keyboard is up, only obscured in the middle, if obeying left/right safe area)
          safearea_ignore_bottom ? 0 : new_height - (sa_height + safearea_elem.offsetTop) * dom_to_canvas_ratio);
      }
    }
  } else {
    v4set(safearea_values,
      new_width * clamp(cmds.safearea[0], 0, 25)/100,
      new_width * clamp(cmds.safearea[1], 0, 25)/100,
      new_height * clamp(cmds.safearea[2], 0, 25)/100,
      new_height * clamp(cmds.safearea[3], 0, 25)/100);
  }
  if (!v4same(safearea_values, last_safearea_values)) {
    v4copy(last_safearea_values, safearea_values);
    camera2d.setSafeAreaPadding(safearea_values[0], safearea_values[1], safearea_values[2], safearea_values[3]);
    need_repos = max(need_repos, 1);
  }

  if (new_width !== last_canvas_width || new_height !== last_canvas_height) {
    window.pixel_scale = dom_to_canvas_ratio; // for debug
    last_canvas_width = canvas.width = new_width || 1;
    last_canvas_height = canvas.height = new_height || 1;

    width = canvas.width;
    height = canvas.height;

    // For the next 10 frames, make sure font size is correct
    need_repos = 10;
    renderNeeded();
  }
  if (is_ios_safari && (window.visualViewport || need_repos)) {
    // we have accurate view information, or screen was just rotated / resized
    // force scroll to top
    window.scroll(0,0);
  }
  profilerStop('checkResize');
}

export let viewport = vec4(0,0,1,1);
export function setViewport(xywh) {
  v4copy(viewport, xywh);
  gl.viewport(xywh[0], xywh[1], xywh[2], xywh[3]);
}

let frames_requested = 0;
function requestFrame(user_time) {
  let max_fps = settings.max_fps;
  let desired_frames = (max_fps >= 250) ? 10 : 1;
  if (frames_requested >= desired_frames) {
    return;
  }
  if (defines.SLOWLOAD && is_loading) {
    // Safari on CrossBrowserTesting needs this in order to have some time to load/decode audio data
    // TODO: Instead, generally, if loading, compare last_tick_cpu vs dt, and if
    //   we're not idle for at least half of the time and we have *internal*
    //   loads (textures, sounds, models, NOT user code), delay so that we are.
    max_fps = 2;
  }
  if (desired_frames > 1) {
    // Ensure we have at least that many frames queued up at any point in time, so they
    // can fire at less than the normal 4ms browser delay of setTimeout()
    while (frames_requested < desired_frames) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      setTimeout(tick, 1);
      frames_requested++;
    }
  } else if (max_fps && max_fps > settings.use_animation_frame) {
    let desired_delay = max(0, round(1000 / max_fps - (user_time || 0)));
    frames_requested++;
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    setTimeout(tick, desired_delay);
  } else {
    frames_requested++;
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    requestAnimationFrame(tick);
  }
}

let mat_projection_10;
export let had_3d_this_frame;

export function clearHad3DThisFrame() {
  had_3d_this_frame = false;
}

export function setupProjection(use_fov_y, use_width, use_height, znear, zfar) {
  mat4Perspective(mat_projection, use_fov_y, use_width/use_height, znear, zfar);
  mat_projection_10 = mat_projection[10];
  // v4set(projection_inverse,
  //   2 / (use_width * mat_projection[0]), // projection_matrix.m00),
  //   2 / (use_height * mat_projection[5]), // projection_matrix.m11),
  //   -(1 + mat_projection[8]) / mat_projection[0], // projection_matrix.m20) / projection_matrix.m00,
  //   -(1 + mat_projection[9]) / mat_projection[5] // projection_matrix.m21) / projection_matrix.m11
  // );
}

export function setZRange(znear, zfar) {
  ZNEAR = znear;
  ZFAR = zfar;
  if (had_3d_this_frame) {
    setupProjection(fov_y, width_3d, height_3d, ZNEAR, ZFAR);
  }
}

function set3DRenderResolution(w, h) {
  width_3d = w;
  height_3d = h;
}

let want_render_scale_3d_this_frame;
let had_render_scale_3d_this_frame;
export function start3DRendering(opts) {
  opts = opts || {};
  if (opts.width) {
    set3DRenderResolution(opts.width, opts.height);
  }
  setFOV(opts.fov || (settings.fov * PI / 180));
  had_3d_this_frame = true;
  if (!opts.width && want_render_scale_3d_this_frame && !defines.NOCOPY) {
    had_render_scale_3d_this_frame = true;
    effectsPassAdd();
  }
  blendModeReset(true);
  gl.enable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  let backbuffer_width = width_3d;
  let backbuffer_height = height_3d;
  if (opts.viewport) {
    // Rendering to a viewport within the backbuffer, and postprocessing must be
    // UI-level and want to grab the whole thing.
    backbuffer_width = render_width || width;
    backbuffer_height = render_height || height;
  }
  framebufferStart({
    width: backbuffer_width,
    height: backbuffer_height,
    final: effectsIsFinal(),
    need_depth: opts.need_depth || true,
    clear: true,
    clear_all: opts.clear_all === undefined ? settings.render_scale_clear : opts.clear_all,
    viewport: opts.viewport,
  });

  setupProjection(fov_y, width_3d, height_3d, ZNEAR, ZFAR);

  gl.enable(gl.CULL_FACE);
}

function renderScaleFinish() {
  if (defines.NOCOPY) {
    gl.disable(gl.SCISSOR_TEST);
    v4set(viewport, 0, 0, width, height);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  } else {
    effectsPassConsume();
    if (settings.render_scale_mode === 2) {
      effects.applyPixelyExpand({ final: effectsIsFinal(), clear: false });
    } else {
      effects.applyCopy({ filter_linear: settings.render_scale_mode === 0 });
    }
  }
}

export function startSpriteRendering() {
  gl.disable(gl.CULL_FACE);
  blendModeReset(true);
  gl.enable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  spriteDrawReset();
}

export function projectionZBias(dist, at_z) {
  if (!dist) {
    mat_projection[10] = mat_projection_10;
    return;
  }
  //let e = 2 * ZFAR * ZNEAR / (ZFAR - ZNEAR) * (dist / (at_z * (at_z + dist)));
  let e = 0.2 * (dist / (at_z * (at_z + dist)));
  e = max(e, 2e-7);
  mat_projection[10] = mat_projection_10 + e;
}

export function fixNatives(is_startup) {
  // If any browser extensions have added things to the Array prototype, remove them!
  let b = [];
  for (let a in b) {
    console[is_startup ? 'log' : 'error'](`Found invasive enumerable property "${a}" on Array.prototype, removing...`);
    let old_val = b[a];
    errorReportSetDetails(`had_native_${a}`, typeof old_val);
    delete Array.prototype[a];
    // If this fails to work, perhaps try using Object.preventExtensions(Array.prototype) in an inline header script?
    // eslint-disable-next-line no-extend-native
    Object.defineProperty(Array.prototype, a, { value: old_val, enumerable: false });
  }
  for (let a in b) {
    // Failed: code that iterates arrays will fail
    assert(false, `Array.prototype has unremovable member ${a}`);
  }
}

function resetState() {
  // Only geomResetState appears to have been strictly needed to work around
  //  a bug on Chrome 71, but doing the rest of this to be safe.
  profilerStart('resetState');
  profilerStart('textures');
  textureResetState();
  profilerStopStart('shaders');
  shadersResetState();
  profilerStopStart('geom;gl');
  geomResetState();

  // These should already be true:
  blendModeReset(true);
  // gl.disable(gl.BLEND);
  gl.enable(gl.BLEND);
  // gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.DEPTH_TEST);
  // gl.depthMask(false);
  gl.depthMask(true);
  // gl.disable(gl.CULL_FACE);
  gl.enable(gl.CULL_FACE);
  // gl.depthFunc(gl.GEQUAL);
  gl.depthFunc(gl.LEQUAL);
  // gl.enable(gl.SCISSOR_TEST);
  gl.disable(gl.SCISSOR_TEST);
  // gl.cullFace(gl.FRONT);
  gl.cullFace(gl.BACK);
  gl.viewport(0, 0, width, height);
  profilerStop();
  profilerStop('resetState');
}

let in_background = false;
let enter_background_cb = [];
let exit_background_cb = [];
export function isInBackground() {
  return in_background;
}
export function onEnterBackground(fn) {
  enter_background_cb.push(fn);
}
export function onExitBackground(fn) {
  exit_background_cb.push(fn);
}

export function dirtyRenderSet(value) {
  dirty_render = value;
}

export const hrnow = window.performance && window.performance.now ?
  window.performance.now.bind(window.performance) :
  Date.now.bind(Date);

let last_tick = 0;
let last_tick_hr = 0;
let frame_limit_time_left = 0;
function tick(timestamp) {
  profilerFrameStart();
  profilerStart('tick');
  profilerStart('top');
  frames_requested--;

  if (render_frames_needed) {
    --render_frames_needed;
  }
  if (dirty_render && !render_frames_needed) {
    resetEffects();
    input.tickInputInactive();
    last_tick_cpu = 0;
    for (let ii = post_tick.length - 1; ii >= 0; --ii) {
      if (post_tick[ii].inactive && !--post_tick[ii].ticks) {
        post_tick[ii].fn();
        ridx(post_tick, ii);
      }
    }
    requestFrame();
    profilerStop();
    return profilerStop('tick');
  }


  // if (timestamp < 1e12) { // high resolution timer
  //   this ends up being a value way back in time, relative to what hrnow() returns,
  //   and even back in time relative to input events already dispatched,
  //   causing timing confusion, so ignore it, just call hrnow()
  //   hrtime = timestamp;
  // } else { // probably integer milliseconds since epoch, or nothing
  hrtime = hrnow();
  // }

  let dt_raw = hrtime - last_tick_hr;
  last_tick_hr = hrtime;
  let max_fps = settings.max_fps;
  if (max_fps && max_fps <= settings.use_animation_frame) {
    // using requestAnimationFrame, need to apply max_fps ourselves
    let frame_time = 1000 / max_fps - 0.1;
    frame_limit_time_left -= dt_raw;
    if (frame_limit_time_left > 0) {
      // too early, skip this frame, do not count any of this time, pretend this frame never happened.
      requestFrame();
      profilerStop('top');
      return profilerStop('tick');
    }
    frame_limit_time_left += frame_time;
    if (frame_limit_time_left < 0) {
      // more than two frames passed, don't accumulate extra frames
      frame_limit_time_left = 0;
    }
  }

  let now = round(hrtime); // Code assumes integer milliseconds
  if (!last_tick) {
    last_tick = now;
  }
  this_frame_time_actual = now - last_tick;
  let dt = min(max(this_frame_time_actual, 1), 250);
  frame_dt = dt;
  last_tick = now;
  frame_timestamp += dt;
  ++frame_index;
  errorReportSetTimeAccum(frame_timestamp);

  fixNatives(false);

  // let this_net_time = wsclient.getNetTime();
  // fpsgraph.history[(fpsgraph.index % PERF_HISTORY_SIZE) * 3 + 0] = this_net_time;
  fpsgraph.history[(fpsgraph.index % PERF_HISTORY_SIZE) * 2 + 1] = this_frame_time_actual;
  fpsgraph.index++;
  fpsgraph.history[(fpsgraph.index % PERF_HISTORY_SIZE) * 2 + 0] = 0;

  ++mspf_frame_count;
  mspf_tick_accum += last_tick_cpu;
  // net_time_accum += this_net_time;
  if (now - mspf_update_time > settings.fps_window * 1000) {
    if (!mspf_update_time) {
      mspf_update_time = now;
    } else {
      mspf = (now - mspf_update_time) / mspf_frame_count;
      mspf_tick = mspf_tick_accum / mspf_frame_count;
      mspf_tick_accum = 0;
      garbage_estimate = profilerGarbageEstimate() / 1024;
      // net_time = net_time_accum / mspf_frame_count;
      // net_time_accum = 0;
      mspf_frame_count = 0;
      mspf_update_time = now;
    }
  }

  perfCounterTick(dt);

  effectsTopOfFrame();

  if (document.hidden || document.webkitHidden || no_render) {
    resetEffects();
    input.tickInputInactive();
    last_tick_cpu = 0;
    for (let ii = post_tick.length - 1; ii >= 0; --ii) {
      if (post_tick[ii].inactive && !--post_tick[ii].ticks) {
        post_tick[ii].fn();
        ridx(post_tick, ii);
      }
    }
    requestFrame();
    profilerStop();
    return profilerStop('tick');
  }
  if (in_background) {
    in_background = false;
    callEach(exit_background_cb);
  }

  checkResize();
  had_3d_this_frame = false;
  want_render_scale_3d_this_frame = false;
  had_render_scale_3d_this_frame = false;
  if (render_width) {
    // render_scale not supported with render_width, doesn't make much sense, just use render_width
    set3DRenderResolution(render_width, render_height);
    effectsPassAdd();
  } else {
    width_3d = max(1, round(width * settings.render_scale));
    height_3d = max(1, round(height * settings.render_scale));
    if (width_3d !== width) {
      want_render_scale_3d_this_frame = true;
    }
  }

  resetState();

  textureBind(0, textureError());

  fontTick();
  camera2d.tickCamera2D();
  glov_transition.render(dt);
  camera2d.setAspectFixed(game_width, game_height);

  profilerStopStart('mid');

  soundTick(dt);
  input.tickInput();
  uiTick(dt);

  if (need_repos) {
    --need_repos;
    let ul = [];
    camera2d.virtualToDom(ul, [0,0]);
    let lr = [];
    camera2d.virtualToDom(lr, [game_width-1,game_height-1]);
    let viewport2 = [ul[0], ul[1], lr[0], lr[1]];
    let view_height = viewport2[3] - viewport2[1];
    // default font size of 16 when at height of game_height
    let font_size = min(256, max(2, floor(view_height/800 * 16)));
    let elem_fullscreen = document.getElementById('fullscreen');
    if (elem_fullscreen) {
      elem_fullscreen.style['font-size'] = `${font_size}px`;
    }
  }

  if (do_borders) {
    // Borders
    drawRect(camera2d.x0Real(), camera2d.y0Real(), camera2d.x1Real(), 0, Z.BORDERS, border_color);
    drawRect(camera2d.x0Real(), game_height, camera2d.x1Real(), camera2d.y1Real(), Z.BORDERS, border_color);
    drawRect(camera2d.x0Real(), 0, 0, game_height, Z.BORDERS, border_color);
    drawRect(game_width, 0, camera2d.x1Real(), game_height, Z.BORDERS, border_color);
  }

  perf.draw();

  profilerStopStart('app_state');
  for (let ii = 0; ii < app_tick_functions.length; ++ii) {
    app_tick_functions[ii](dt);
  }
  if (app_state) {
    app_state(dt);
  }

  profilerStopStart('bottom');
  spotEndInput();
  glov_particles.tick(dt); // *after* app_tick, so newly added/killed particles can be queued into the draw list

  if (had_3d_this_frame) {
    if (had_render_scale_3d_this_frame) {
      renderScaleFinish();
    }
  } else {
    // delayed clear (and general GL init) until after app_state, app might change clear color
    if (render_width) {
      // assert(!effectsIsFinal());
      framebufferStart({
        width: render_width,
        height: render_height,
        clear: true,
        clear_all: settings.render_scale_clear, // Not sure if this is ever faster in this case?
        final: effectsIsFinal(),
        need_depth: false,
      });
    } else {
      framebufferStart({
        width,
        height,
        clear: true,
        final: effectsIsFinal(),
        need_depth: false,
      });
    }
  }

  if (pre_sprite_render) {
    callEach(pre_sprite_render, pre_sprite_render = null);
  }

  startSpriteRendering();
  spriteDraw();

  uiEndFrame();

  if (post_render) {
    callEach(post_render, post_render = null);
  }

  if (render_width) {
    effectsPassConsume();
    let final_viewport = [
      camera2d.render_offset_x, camera2d.render_offset_y_bottom,
      camera2d.render_viewport_w, camera2d.render_viewport_h
    ];
    let params = {
      clear: true,
      clear_all: true,
      clear_color: border_clear_color,
      viewport: final_viewport,
    };
    if (do_viewport_postprocess) {
      effects.applyPixelyExpand(params);
    } else {
      effects.applyCopy(params);
    }
  }

  input.endFrame();
  resetEffects();
  textureTick();

  for (let ii = post_tick.length - 1; ii >= 0; --ii) {
    if (!--post_tick[ii].ticks) {
      post_tick[ii].fn();
      ridx(post_tick, ii);
    }
  }

  last_tick_cpu = hrnow() - now;
  fpsgraph.history[(fpsgraph.index % PERF_HISTORY_SIZE) * 2 + 0] = last_tick_cpu;
  requestFrame(hrnow() - hrtime);
  profilerStop('bottom');
  return profilerStop('tick');
}

let blurred = false;
function onBlur(evt) {
  blurred = true;
}

function onFocus(evt) {
  blurred = false;
}

function periodiclyRequestFrame() {
  requestFrame();
  setTimeout(periodiclyRequestFrame, 1000);

  if (!in_background && blurred) {
    let now = round(hrnow());
    if (now - last_tick > 400) {
      in_background = true;
      callEach(enter_background_cb);
    }
  }
}

// Must be called out-of-frame (use setTimeout) if not at startup
export function setPixelyStrict(on) {
  if (on) {
    render_width = game_width;
    render_height = game_height;
  } else {
    render_width = undefined;
    render_height = undefined;
  }
}

export function getViewportPostprocess() {
  return do_viewport_postprocess;
}
export function setViewportPostprocess(viewport_postprocess) {
  do_viewport_postprocess = viewport_postprocess;
}

export function setFonts(new_font, title_font) {
  font = new_font;
  uiSetFonts(new_font, title_font);
}

export function engineStartupFunc(func) {
  startup_funcs.push(func);
}

export function startup(params) {
  fixNatives(true);

  assert(window.glov_webfs, 'Failed to load fsdata.js');
  webFSStartup(window.glov_webfs, urlhash.getURLBase());

  canvas = document.getElementById('canvas');
  safearea_elem = document.getElementById('safearea');

  if (params.error_report === false) {
    glovErrorReportDisableSubmit();
  }

  if (DEBUG) {
    dataErrorQueueEnable(true);
  }

  if (DEBUG && !window.spector) {
    // Add check to catch common error of `const FOO=10; for (let i=0; i < FOO.length; i++) {}`
    // eslint-disable-next-line no-extend-native
    Object.defineProperty(Number.prototype, 'length', {
      get: function () {
        assert(false, 'Numbers do not have a length property');
        return undefined;
      }
    });
  }

  safearea_ignore_bottom = params.safearea_ignore_bottom || false;

  // resize the canvas to fill browser window dynamically
  window.addEventListener('resize', checkResize, false);
  checkResize();

  let is_pixely = params.pixely && params.pixely !== 'off';
  antialias = params.antialias || !is_pixely && params.antialias !== false;
  let powerPreference = params.high ? 'high-performance' : 'default';
  let context_names = ['webgl2', 'webgl', 'experimental-webgl'];
  let force_webgl1 = defines.NOWEBGL2;
  let disable_data = local_storage.getJSON('webgl2_disable');
  // Check if a previous, recent run had an error that hinted we should disable WebGL2
  if (disable_data && disable_data.ua === navigator.userAgent && disable_data.ts > Date.now() - 7*24*60*60*1000) {
    console.log('Disabling WebGL2 because a previous run encountered a related error');
    force_webgl1 = true;
  }
  if (DEBUG && !defines.FORCEWEBGL2) {
    let rc = local_storage.getJSON('run_count', 0) + 1;
    local_storage.setJSON('run_count', rc);
    if (rc % 2) {
      force_webgl1 = true;
    }
  }
  if (force_webgl1) {
    context_names.splice(0, 1);
  }
  let context_opts = [
    { antialias, powerPreference, alpha: false },
    { powerPreference, alpha: false },
    { antialias, alpha: false },
    { alpha: false },
    {},
  ];
  let good = false;
  webgl2 = false;
  for (let i = 0; !good && i < context_names.length; i += 1) {
    for (let jj = 0; !good && jj < context_opts.length; ++jj) {
      try {
        window.gl = canvas.getContext(context_names[i], context_opts[jj]);
        if (window.gl) {
          if (context_names[i] === 'webgl2') {
            webgl2 = true;
          }
          if (antialias && !context_opts[jj].antialias) {
            antialias_unavailable = true;
            antialias = false;
          }
          good = true;
          break;
        }
      } catch (e) {
        // ignore
      }
    }
  }
  if (!window.requestAnimationFrame) {
    // SamsungBrowser/1.1 - apparently has WebGL, but not requestAnimationFrame; also not binary WebSockets
    good = false;
  }
  if (good) {
    // ensure at least basic shaders compile
    let shaders_supported = shadersStartup({
      light_diffuse,
      light_dir_ws,
      ambient: light_ambient,
      mat_m: mat_m,
      mat_mv: mat_mv,
      mat_vp: mat_vp,
      mvp: mat_mvp,
      mv_inv_trans: mat_mv_inv_transform,
      mat_inv_view: mat_inv_view,
      view: mat_view,
      projection: mat_projection,
      // projection_inverse,
    });
    if (!shaders_supported) {
      good = false;
    }
  }

  if (!good) {
    // eslint-disable-next-line no-alert
    window.alert(`${
      window.gl ?
        'Error initializing WebGL.\n' :
        'Error initializing WebGL: your browser does not support WebGL or does not have it enabled.\n'}` +
      'Try completely closing and re-opening the app or browser.' +
      '  If the problem persists, try restarting your device.');
    document.getElementById('loading').style.visibility = 'hidden';
    document.getElementById('nowebgl').style.visibility = 'visible';
    return false;
  }

  glovErrorReportSetCrashCB(function () {
    setTimeout(requestFrame, 1);
  });

  let nocanvas = document.getElementById('nocanvas');
  if (verify(nocanvas)) {
    // hide the interior of the <canvas> elements, so that the get.webgl.org link is not focusable!
    nocanvas.style.visibility = 'hidden';
  }
  console.log(`Using WebGL${webgl2?2:1}`);

  assert(gl);
  canvas.focus();
  setGameDims(params.game_width || 1280, params.game_height || 960);
  ZNEAR = params.znear || 0.7;
  ZFAR = params.zfar || 10000;
  setPixelyStrict(params.pixely === 'strict');
  if (params.viewport_postprocess) {
    do_viewport_postprocess = true;
  }
  pixel_aspect = params.pixel_aspect || 1;

  gl.depthFunc(gl.LEQUAL);
  // gl.enable(gl.SCISSOR_TEST);
  gl.cullFace(gl.BACK);
  gl.clearColor(0, 0.1, 0.2, 1);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // Allow RGB texture data with non-mult-4 widths

  textureStartup();
  geomStartup();
  addViewSpaceGlobal('light_dir');
  camera2d.startup();
  spriteStartup();
  input.startup(canvas, params);
  modelStartup();

  window.addEventListener('blur', onBlur, false);
  window.addEventListener('focus', onFocus, false);

  /* eslint-disable global-require */
  glov_particles = require('./particles.js').create();

  if (is_pixely) {
    textureDefaultFilters(gl.NEAREST, gl.NEAREST);
    settings.runTimeDefault('render_scale_mode', 1);
  } else {
    textureDefaultFilters(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
  }

  assert(params.font);
  // If not, something like:
  // const font_info_04b03x2 = require('../img/font/04b03_8x2.json');
  // const font_info_04b03x1 = require('../img/font/04b03_8x1.json');
  // const font_info_palanquin32 = require('../img/font/palanquin32.json');
  // if (params.pixely === 'strict') {
  //   font = glov_font.create(font_info_04b03x1, 'font/04b03_8x1');
  // } else if (is_pixely) {
  //   font = glov_font.create(font_info_04b03x2, 'font/04b03_8x2');
  // } else {
  //   font = glov_font.create(font_info_palanquin32, 'font/palanquin32');
  // }
  params.font = font = glov_font.create(params.font.info, params.font.texture);
  if (params.title_font) {
    params.title_font = glov_font.create(params.title_font.info, params.title_font.texture);
  }
  uiStartup(params);

  soundStartup(params.sound);
  uiBindSounds(params.ui_sounds);

  buildUIStartup();
  shaderDebugUIStartup();
  profilerUIStartup();

  callEach(startup_funcs, startup_funcs = null);

  camera2d.setAspectFixed(game_width, game_height);

  if (params.state) {
    setState(params.state);
  }
  if (params.do_borders !== undefined) {
    do_borders = params.do_borders;
  }
  if (params.show_fps !== undefined) {
    settings.show_fps = params.show_fps;
  }
  dirty_render = Boolean(params.dirty_render);

  periodiclyRequestFrame();
  return true;
}

let custom_loads_pending = 0;
export function loadPendingDelta(delta) {
  custom_loads_pending += delta;
}

export function loadsPending() {
  return textureLoadCount() + soundLoading() + modelLoadCount() + custom_loads_pending;
}

let on_load_metrics = [];
export function onLoadMetrics(cb) {
  on_load_metrics.push(cb);
}

onLoadMetrics((obj) => {
  console.log([
    'Load time summary',
    `  ${obj.time_js_load}ms JS load`,
    `  ${obj.time_js_init}ms JS init`,
    `  ${obj.time_resource_load}ms resource load`,
    `${obj.time_total}ms total`
  ].join('\n'));
});

function loadingFinished() {
  let now = Date.now();
  let time_js_load = window.time_load_onload - window.time_load_start;
  let time_js_init = window.time_load_init - window.time_load_onload;
  let time_resource_load = now - window.time_load_init;
  let time_total = now - window.time_load_start;
  callEach(on_load_metrics, null, {
    time_js_load,
    time_js_init,
    time_resource_load,
    time_total,
  });
  profanityStartupLate();
}

function loading() {
  let load_count = loadsPending();
  let elem_loading_text = document.getElementById('loading_text');
  if (elem_loading_text) {
    elem_loading_text.innerText = `Loading (${load_count})...`;
  }
  renderNeeded();
  if (!load_count) {
    is_loading = false;
    app_state = after_loading_state;
    // Clear after next frame, so something is rendered to the canvas
    postTick({
      ticks: 2,
      fn: function () {
        loadingFinished();
        renderNeeded();
        let loading_elem = document.getElementById('loading');
        if (loading_elem) {
          loading_elem.style.visibility = 'hidden';
        }
      }
    });
  }
}
app_state = loading;

window.glov_engine = exports;
