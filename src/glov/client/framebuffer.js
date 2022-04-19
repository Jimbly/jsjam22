const assert = require('assert');
const { is_ios } = require('./browser.js');
const { cmd_parse } = require('./cmds.js');
const { applyCopy } = require('./effects.js');
const engine = require('./engine.js');
const { renderWidth, renderHeight } = engine;
const perf = require('./perf.js');
const settings = require('./settings.js');
const textures = require('./textures.js');

let last_num_passes = 0;
let num_passes = 0;

let temporary_textures = {};
let temporary_depthbuffers = {};
let temporary_depthtextures = {};

let reset_fbos = false;
function resetFBOs() {
  reset_fbos = true;
}

let skip_release = false;
export function framebufferSkipRelease() {
  // Skip releases for one frame, we're making a temporary change for a screenshot/etc
  skip_release = true;
}

let last_temp_idx = 0;
function getTemporaryTexture(w, h, possibly_fbo) {
  let key = `${w}_${h}`;
  let is_fbo = possibly_fbo && settings.use_fbos;
  if (is_fbo) {
    key += '_fbo';
  }
  let temp = temporary_textures[key];
  if (!temp) {
    temp = temporary_textures[key] = { list: [], idx: 0 };
  }
  if (temp.idx >= temp.list.length) {
    let tex = textures.createForCapture(`temp_${key}_${++last_temp_idx}`);
    if (is_fbo) {
      tex.allocFBO(w, h);
    }
    temp.list.push(tex);
  }
  let tex = temp.list[temp.idx++];
  return tex;
}

function bindTemporaryDepthbuffer(w, h) {
  let key = `${w}_${h}`;
  let temp = temporary_depthbuffers[key];
  if (!temp) {
    temp = temporary_depthbuffers[key] = { list: [], idx: 0 };
  }
  if (temp.idx >= temp.list.length) {
    let depth_buffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth_buffer);
    let attachment;
    if (settings.fbo_depth16) {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      attachment = gl.DEPTH_ATTACHMENT;
    } else {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
      attachment = gl.DEPTH_STENCIL_ATTACHMENT;
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    temp.list.push({ depth_buffer, attachment });
  }
  let { depth_buffer, attachment } = temp.list[temp.idx++];
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, depth_buffer);
}

function bindTemporaryDepthbufferTexture(w, h) {
  let key = `${w}_${h}`;
  let temp = temporary_depthtextures[key];
  if (!temp) {
    temp = temporary_depthtextures[key] = { list: [], idx: 0 };
  }
  if (temp.idx >= temp.list.length) {
    let tex = textures.createForDepthCapture(`temp_${key}_${++last_temp_idx}`,
      settings.fbo_depth16 ? textures.format.DEPTH16 : textures.format.DEPTH24);
    tex.allocDepth(w, h);
    let attachment = settings.fbo_depth16 ? gl.DEPTH_ATTACHMENT : gl.DEPTH_STENCIL_ATTACHMENT;

    temp.list.push({ tex, attachment });
  }
  let { tex, attachment } = temp.list[temp.idx++];
  gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, tex.handle, 0);
  return tex;
}

export function temporaryTextureClaim(tex) {
  for (let key in temporary_textures) {
    let temp = temporary_textures[key];
    let idx = temp.list.indexOf(tex);
    if (idx !== -1) {
      temp.list.splice(idx, 1);
      if (temp.idx > idx) {
        --temp.idx;
      }
      return;
    }
  }
  assert(false);
}

// Call tex.captureEnd when done
function framebufferCaptureStart(tex, w, h, possibly_fbo) {
  assert.equal(engine.viewport[0], 0); // maybe allow/require setting viewport *after* starting capture instead?
  assert.equal(engine.viewport[1], 0);
  if (!w) {
    w = renderWidth();
    h = renderHeight();
  }
  if (!tex) {
    tex = getTemporaryTexture(w, h, possibly_fbo);
  }
  tex.captureStart(w, h);
  return tex;
}

// Does a capture directly from the framebuffer regardless of current use_fbos setting
// Warning: Slow on iOS
export function framebufferCapture(tex, w, h, filter_linear, wrap) {
  tex = framebufferCaptureStart(tex, w, h, false);
  tex.captureEnd(filter_linear, wrap);
  return tex;
}


let cur_tex;
let cur_depth;
export function framebufferStart(opts) {
  assert(!cur_tex);
  assert(!cur_depth);
  let { width, height, viewport, final, clear, need_depth, clear_all, clear_color, force_tex } = opts;
  ++num_passes;
  cur_depth = null;
  if (force_tex) {
    assert(viewport);
    cur_tex = force_tex;
    cur_tex.captureStart();
  } else if (!final) {
    cur_tex = framebufferCaptureStart(null, width, height, true);
    if (settings.use_fbos) {
      if (need_depth) {
        if (need_depth === 'texture') {
          cur_depth = bindTemporaryDepthbufferTexture(width, height);
        } else {
          bindTemporaryDepthbuffer(width, height);
        }
      } else {
        // testing: force unbind, in case one was left bound
        // gl.framebufferRenderbuffer(gl.FRAMEBUFFER, settings.fbo_depth16 ?
        //   gl.DEPTH_ATTACHMENT : gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null);
      }
    }
  }
  if (clear_color) {
    gl.clearColor(clear_color[0], clear_color[1], clear_color[2], clear_color[3]);
  }
  if (clear && clear_all) {
    // full clear, before setting viewport
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | (need_depth ? gl.DEPTH_BUFFER_BIT : 0));
  }
  let need_scissor;
  if (viewport) {
    engine.setViewport(viewport);
    need_scissor = viewport[0] || viewport[1] || viewport[2] !== engine.width || viewport[3] !== engine.height;
    if (clear_all) { // not sure this logically follows, but we want this anywhere we're clearing all currently
      need_scissor = false;
    }
  } else {
    engine.setViewport([0, 0, width, height]);
    need_scissor = width !== engine.width;
  }
  if (need_scissor) { // Note: previously `&& !settings.use_fbos`, but that seems wrong, why was it there?
    gl.enable(gl.SCISSOR_TEST);
    if (viewport) {
      gl.scissor(viewport[0], viewport[1], viewport[2], viewport[3]);
    } else {
      gl.scissor(0, 0, width, height);
    }
  } else {
    gl.disable(gl.SCISSOR_TEST);
  }
  if (clear && !clear_all) {
    gl.clear(gl.COLOR_BUFFER_BIT | (need_depth ? gl.DEPTH_BUFFER_BIT : 0));
  }
}

export function framebufferEnd(opts) {
  assert(cur_tex);
  opts = opts || {};
  let { filter_linear, wrap, need_depth } = opts;
  assert.equal(Boolean(cur_depth), need_depth === 'texture');

  cur_tex.captureEnd(filter_linear, wrap);
  // Capture end for depth texture?  Nope, only works with FBOs in WebGL!

  let ret;
  if (cur_depth) {
    ret = [cur_tex, cur_depth];
  } else {
    ret = cur_tex;
  }
  cur_tex = null;
  cur_depth = null;

  return ret;
}

export function framebufferTopOfFrame() {
  // In case of crash on previous frame
  cur_tex = null;
  cur_depth = null;
}

export function framebufferEndOfFrame() {
  assert(!cur_tex);
  last_num_passes = num_passes;
  num_passes = 0;
  skip_release = skip_release && !reset_fbos;

  for (let key in temporary_textures) {
    let temp = temporary_textures[key];
    if (reset_fbos) {
      // Release all textures
      temp.idx = 0;
    }
    // Release unused textures
    if (!skip_release) {
      while (temp.list.length > temp.idx) {
        temp.list.pop().destroy();
      }
    }
    if (!temp.list.length) {
      delete temporary_textures[key];
    } else {
      temp.idx = 0;
    }
  }
  for (let key in temporary_depthbuffers) {
    let temp = temporary_depthbuffers[key];
    if (reset_fbos) {
      // Release all renderbuffers
      temp.idx = 0;
    }
    // Release unused renderbuffers
    if (!skip_release) {
      while (temp.list.length > temp.idx) {
        let { depth_buffer } = temp.list.pop();
        // TODO: can this still be bound to a framebuffer? unlikely, but possible?
        gl.deleteRenderbuffer(depth_buffer);
      }
    }
    if (!temp.list.length) {
      delete temporary_depthbuffers[key];
    } else {
      temp.idx = 0;
    }
  }
  for (let key in temporary_depthtextures) {
    let temp = temporary_depthtextures[key];
    if (reset_fbos) {
      // Release all depth textures
      temp.idx = 0;
    }
    // Release unused depth textures
    if (!skip_release) {
      while (temp.list.length > temp.idx) {
        let { tex } = temp.list.pop();
        tex.destroy();
      }
    }
    if (!temp.list.length) {
      delete temporary_depthtextures[key];
    } else {
      temp.idx = 0;
    }
  }
  reset_fbos = false;
  skip_release = false;
}

export function framebufferUpdateCanvasForCapture() {
  if (cur_tex && settings.use_fbos) {
    let saved_tex = cur_tex;
    let saved_viewport = engine.viewport.slice(0);
    // copy to canvas
    framebufferEnd();
    applyCopy({
      source: saved_tex,
      final: true,
      viewport: saved_viewport,
    });
    // resume rendering to framebuffer
    framebufferStart({
      force_tex: saved_tex,
      viewport: saved_viewport,
    });
    return saved_tex; // just for .width/height
  } else {
    return { width: engine.viewport[2], height: engine.viewport[3] };
  }
}

settings.register({
  show_passes: {
    label: 'Show Postprocessing Passes',
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
  },
  use_fbos: {
    label: 'Use Framebuffer Objects for postprocessing',
    default_value: is_ios ? 1 : 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    ver: 1,
  },
  fbo_depth16: { // This had no effect on performance, tested on iPhone, Xperia or Intel GPU
    label: 'Use 16-bit depth buffers for offscreen rendering',
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    on_change: resetFBOs,
  },
  fbo_rgba: { // This had no effect on performance, tested on iPhone, Xperia or Intel GPU
    label: 'Use RGBA color buffers for offscreen rendering',
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    on_change: resetFBOs,
  },
});
reset_fbos = false; // in case it was flagged while registering settings

perf.addMetric({
  name: 'passes',
  show_stat: 'show_passes',
  labels: {
    'passes: ': () => last_num_passes.toString(),
  },
});
