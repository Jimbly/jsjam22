// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code from Turbulenz: Copyright (c) 2012-2013 Turbulenz Limited
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const assert = require('assert');
const engine = require('./engine.js');
const { renderWidth, renderHeight } = engine;
const { framebufferEnd, framebufferStart, framebufferTopOfFrame } = require('./framebuffer.js');
const geom = require('./geom.js');
const {
  SEMANTIC,
  shaderCreate,
  shadersBind,
  shadersPrelink,
} = require('./shaders.js');
const { spriteQueueFn } = require('./sprites.js');
const { textureBindArray, textureWhite } = require('./textures.js');
const { vec3, vec4, v4set } = require('glov/common/vmath.js');

const shader_data = {
  vp_copy: {
    vp: 'shaders/effects_copy.vp',
  },
  copy: {
    fp: 'shaders/effects_copy.fp',
  },
  pixely_expand: {
    fp: 'shaders/pixely_expand.fp',
  },
  gaussian_blur: {
    fp: 'shaders/effects_gaussian_blur.fp',
  },
  // bloom_merge: {
  //   fp: 'shaders/effects_bloom_merge.fp',
  // },
  // bloom_threshold: {
  //   fp: 'shaders/effects_bloom_threshold.fp',
  // },
  color_matrix: {
    fp: 'shaders/effects_color_matrix.fp',
  },
  // distort: {
  //   fp: 'shaders/effects_distort.fp',
  // },
};

export function registerShader(key, obj) {
  shader_data[key] = obj;
}

function getShader(key) {
  let elem = shader_data[key];
  if (!elem.shader) {
    if (elem.fp) {
      elem.shader = shaderCreate(elem.fp);
    } else {
      elem.shader = shaderCreate(elem.vp);
    }
  }
  return elem.shader;
}


let inited = false;
let clip_space = vec4(2, 2, -1, -1);
let copy_uv_scale = vec4(1, 1, 0, 0);
let shader_params_default = {
  clip_space,
  copy_uv_scale,
};
// let shader_params_distort;
let shader_params_color_matrix;
// let shader_params_bloom;
// let shader_params_bloom_merge;
let shader_params_gaussian_blur;
let shader_params_pixely_expand;
let quad_geom;
function startup() {
  inited = true;

  quad_geom = geom.create(
    [[SEMANTIC.POSITION, gl.FLOAT, 2, false]],
    new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]), null, geom.QUADS); // TODO: use gl.TRIANGLE_STRIP instead, save index buffer binding

  // shader_params_distort = {
  //   clip_space,
  //   copy_uv_scale,
  //   strength: vec2(0, 0),
  //   transform: new Float32Array([0, 0, 0, 0, 0, 0]),
  //   invTransform: vec4(0, 0, 0, 0),
  // };

  shader_params_color_matrix = {
    clip_space,
    copy_uv_scale,
    colorMatrix: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  };

  // shader_params_bloom = {
  //   clip_space,
  //   copy_uv_scale,
  //   bloomThreshold: 0,
  //   thresholdCuttoff: 0,
  // };

  // shader_params_bloom_merge = {
  //   clip_space,
  //   copy_uv_scale,
  //   bloomIntensity: 0,
  //   bloomSaturation: 0,
  //   originalIntensity: 0,
  //   originalSaturation: 0,
  // };

  // Gaussian Blur effect (also used by bloom)
  shader_params_gaussian_blur = {
    clip_space,
    copy_uv_scale,
    sampleRadius: vec3(1, 1, 1),
    Gauss: new Float32Array([0.93, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]),
  };

  shader_params_pixely_expand = {
    clip_space,
    copy_uv_scale,
    orig_pixel_size: vec4(),
  };
}

let num_passes = 0;
export function effectsPassAdd() {
  ++num_passes;
}
export function effectsPassConsume() {
  assert(num_passes);
  --num_passes;
}

function doEffect(fn) {
  effectsPassConsume();
  fn();
}

export function effectsQueue(z, fn) {
  effectsPassAdd();
  spriteQueueFn(z, doEffect.bind(null, fn));
}

export function effectsTopOfFrame() {
  // In case of crash on previous frame
  num_passes = 0;
  framebufferTopOfFrame();
}

export function effectsReset() {
  assert.equal(num_passes, 0); // otherwise probably still have a framebuffer bound
}

export function effectsIsFinal() {
  return !num_passes;
}

export function grayScaleMatrix(dst) {
  dst[0] = 0.2126;
  dst[1] = 0.2126;
  dst[2] = 0.2126;
  dst[3] = 0.7152;
  dst[4] = 0.7152;
  dst[5] = 0.7152;
  dst[6] = 0.0722;
  dst[7] = 0.0722;
  dst[8] = 0.0722;
  dst[9] = dst[10] = dst[11] = 0;
}

export function sepiaMatrix(dst) {
  dst[0] = 0.393;
  dst[1] = 0.349;
  dst[2] = 0.272;
  dst[3] = 0.769;
  dst[4] = 0.686;
  dst[5] = 0.534;
  dst[6] = 0.189;
  dst[7] = 0.168;
  dst[8] = 0.131;
  dst[9] = dst[10] = dst[11] = 0;
}

export function negativeMatrix(dst) {
  dst[0] = dst[4] = dst[8] = -1;
  dst[1] = dst[2] = dst[3] = dst[5] = dst[6] = dst[7] = 0;
  dst[9] = dst[10] = dst[11] = 1;
}

export function saturationMatrix(dst, saturationScale) {
  let is = (1 - saturationScale);
  dst[0] = (is * 0.2126) + saturationScale;
  dst[1] = (is * 0.2126);
  dst[2] = (is * 0.2126);
  dst[3] = (is * 0.7152);
  dst[4] = (is * 0.7152) + saturationScale;
  dst[5] = (is * 0.7152);
  dst[6] = (is * 0.0722);
  dst[7] = (is * 0.0722);
  dst[8] = (is * 0.0722) + saturationScale;
  dst[9] = dst[10] = dst[11] = 0;
}

export function hueMatrix(dst, angle) {
  ////
  //// Uncomment to calculate new coeffecients should luminance
  //// values 0.2126 0.7152 0.0722 change.
  //let lumR = 0.2126;
  //let lumG = 0.7152;
  //let lumB = 0.0722;
  ////
  //let r23 = Math.sqrt(2 / 3);
  //let r12 = 1 / Math.sqrt(2);
  //let r13 = 1 / Math.sqrt(3);
  //let r16 = 1 / Math.sqrt(6);
  //let M = [r23, 0, r13, -r16, r12, r13, -r16, -r12, r13, 0, 0, 0];
  //let zx = (r23 * lumR) - (r16 * lumG) - (r16 * lumB);
  //let zy =                (r12 * lumG) - (r12 * lumB);
  //let zz = (r13 * lumR) + (r13 * lumG) + (r13 * lumB);
  //let x = zx / zz;
  //let y = zy / zz;
  //let C = [1, 0, x, 0, 1, y, 0, 0, 1, 0, 0, 0];
  //m43mul(M, M, C);
  //console.log("Pre transform = ", M);
  //let E = [1, 0, -x, 0, 1, -y, 0, 0, 1, 0, 0, 0];
  //let N = [r23, -r16, -r16, 0, r12, -r12, r13, r13, r13, 0, 0, 0];
  //m43mul(N, E, N);
  //console.log("Post transform = ", N);
  ////
  //// Final matrix is then: m43Mul(Pre, [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0, ], Post);
  //// for c = cos(angle), s = sin(angle)
  ////
  //let out = "";
  //out += "let c = Math.cos(angle);\n";
  //out += "let s = Math.sin(angle);\n";
  //out += "dst[0] = (" + (N[0]*M[0]+N[3]*M[1]) + " * c) + (" + (N[3]*M[0]-N[0]*M[1]) + " * s) + " + lumR+";\n";
  //out += "dst[1] = (" + (-lumR)               + " * c) + (" + (N[4]*M[0]-N[1]*M[1]) + " * s) + " + lumR+";\n";
  //out += "dst[2] = (" + (-lumR)               + " * c) + (" + (N[5]*M[0]-N[2]*M[1]) + " * s) + " + lumR+";\n";
  //out += "dst[3] = (" + (-lumG)               + " * c) + (" + (N[3]*M[3]-N[0]*M[4]) + " * s) + " + lumG+";\n";
  //out += "dst[4] = (" + (N[1]*M[3]+N[4]*M[4]) + " * c) + (" + (N[4]*M[3]-N[1]*M[4]) + " * s) + " + lumG+";\n";
  //out += "dst[5] = (" + (-lumG)               + " * c) + (" + (N[5]*M[3]-N[2]*M[4]) + " * s) + " + lumG+";\n";
  //out += "dst[6] = (" + (-lumB)               + " * c) + (" + (N[3]*M[6]-N[0]*M[7]) + " * s) + " + lumB+";\n";
  //out += "dst[7] = (" + (-lumB)               + " * c) + (" + (N[4]*M[6]-N[1]*M[7]) + " * s) + " + lumB+";\n";
  //out += "dst[8] = (" + (N[2]*M[6]+N[5]*M[7]) + " * c) + (" + (N[5]*M[6]-N[2]*M[7]) + " * s) + " + lumB+";\n";
  //console.log(out);
  let c = Math.cos(angle);
  let s = Math.sin(angle);
  dst[0] = (0.7874 * c) + (-0.3712362230889293 * s) + 0.2126;
  dst[1] = (-0.2126 * c) + (0.20611404610069642 * s) + 0.2126;
  dst[2] = (-0.2126 * c) + (-0.9485864922785551 * s) + 0.2126;
  dst[3] = (-0.7152 * c) + (-0.4962902913954023 * s) + 0.7152;
  dst[4] = (0.2848 * c) + (0.08105997779422341 * s) + 0.7152;
  dst[5] = (-0.7152 * c) + (0.6584102469838492 * s) + 0.7152;
  dst[6] = (-0.0722 * c) + (0.8675265144843316 * s) + 0.0722;
  dst[7] = (-0.0722 * c) + (-0.28717402389491986 * s) + 0.0722;
  dst[8] = (0.9278 * c) + (0.290176245294706 * s) + 0.0722;
  dst[9] = dst[10] = dst[11] = 0;
}

export function brightnessAddMatrix(dst, brightnessOffset) {
  dst[0] = dst[4] = dst[8] = 1;
  dst[1] = dst[2] = dst[3] = dst[5] = dst[6] = dst[7] = 0;
  dst[9] = dst[10] = dst[11] = brightnessOffset;
}

export function brightnessScaleMatrix(dst, scale) {
  dst[0] = dst[4] = dst[8] = scale;
  dst[1] = dst[2] = dst[3] = dst[5] = dst[6] = dst[7] = 0;
  dst[9] = dst[10] = dst[11] = 0;
}

export function additiveMatrix(dst, additiveRGB) {
  dst[0] = dst[4] = dst[8] = 1;
  dst[1] = dst[2] = dst[3] = dst[5] = dst[6] = dst[7] = 0;
  dst[9] = additiveRGB[0];
  dst[10] = additiveRGB[1];
  dst[11] = additiveRGB[2];
}

export function contrastMatrix(dst, contrastScale) {
  dst[0] = dst[4] = dst[8] = contrastScale;
  dst[1] = dst[2] = dst[3] = dst[5] = dst[6] = dst[7] = 0;
  dst[9] = dst[10] = dst[11] = 0.5 * (1 - contrastScale);
}

// effect: { shader, params, texs, final }
function applyEffect(effect, view_w, view_h) {
  let final = effect.final !== false && effectsIsFinal() || effect.final;
  if (effect.no_framebuffer) {
    // neither starting nor ending a framebuffer, presumably something effectively additive
    let viewport = engine.viewport;
    let target_w = viewport[2];
    let target_h = viewport[3];
    view_w = view_w || target_w;
    view_h = view_h || target_h;
    clip_space[0] = 2.0 * view_w / target_w;
    clip_space[1] = 2.0 * view_h / target_h;
  } else if (effect.viewport) {
    let { viewport } = effect;
    let target_w = viewport[2];
    let target_h = viewport[3];
    view_w = view_w || target_w;
    view_h = view_h || target_h;

    clip_space[0] = 2.0 * view_w / target_w;
    clip_space[1] = 2.0 * view_h / target_h;

    framebufferStart({
      clear: effect.clear,
      clear_all: effect.clear_all,
      clear_color: effect.clear_color,
      viewport,
      final,
      need_depth: effect.need_depth_begin,
    });
  } else {
    clip_space[0] = 2.0;
    clip_space[1] = 2.0;
    view_w = view_w || renderWidth();
    view_h = view_h || renderHeight();

    framebufferStart({
      width: view_w, height: view_h,
      final,
      need_depth: effect.need_depth_begin,
    });
  }
  // clip_space[2] = -1.0;
  // clip_space[3] = -1.0;
  // copy_uv_scale[0] = target_w / effect.coord_source.width;
  // copy_uv_scale[1] = target_h / effect.coord_source.height;

  shadersBind(getShader('vp_copy'), getShader(effect.shader), effect.params);
  textureBindArray(effect.texs);
  quad_geom.draw();
}

// // TODO: Update for RTBBCTT and port to new GLOV.js
// function applyBloomTODO(params) {
//   let source = params.source;
//   let blur1 = params.blurTarget1;
//   let blur2 = params.blurTarget2;
//   let dest = params.destination;
//   if (!source || !dest || !blur1 || !blur2 || !blur1.colorTexture0 ||
//     !blur2.colorTexture0 || blur1 === blur2 || blur1 === dest ||
//     source === blur1.colorTexture0 || source === dest.colorTexture0) {
//     return false;
//   }
//
//   let effectParams = this.effectParams;
//   let techparams;
//
//   // Threshold copy.
//   techparams = this.bloomThresholdParameters;
//   effectParams.technique = this.bloomThresholdTechnique;
//   effectParams.params = techparams;
//
//   techparams.bloomThreshold = (params.bloomThreshold !== undefined) ? params.bloomThreshold : 0.65;
//   techparams.thresholdCutoff = Math.exp((params.thresholdCutoff !== undefined) ? params.thresholdCutoff : 3);
//   techparams.inputTexture0 = source;
//   effectParams.destination = blur1;
//   this.applyEffect(effectParams);
//
//   // Gaussian blur.
//   techparams = this.gaussianBlurParameters;
//   effectParams.technique = this.gaussianBlurTechnique;
//   effectParams.params = techparams;
//
//   let sampleRadius = (params.blurRadius || 20);
//   techparams.sampleRadius[0] = sampleRadius / source.width;
//   techparams.sampleRadius[1] = 0;
//   techparams.sampleRadius[2] = 1;
//   techparams.inputTexture0 = blur1.colorTexture0;
//   effectParams.destination = blur2;
//   this.applyEffect(effectParams);
//
//   techparams.sampleRadius[0] = 0;
//   techparams.sampleRadius[1] = sampleRadius / source.height;
//   techparams.sampleRadius[2] = 1;
//   techparams.inputTexture0 = blur2.colorTexture0;
//   effectParams.destination = blur1;
//   this.applyEffect(effectParams);
//
//   // Merge.
//   techparams = this.bloomMergeParameters;
//   effectParams.technique = this.bloomMergeTechnique;
//   effectParams.params = techparams;
//
//   techparams.bloomIntensity = (params.bloomIntensity !== undefined) ? params.bloomIntensity : 1.2;
//   techparams.bloomSaturation = (params.bloomSaturation !== undefined) ? params.bloomSaturation : 1.2;
//   techparams.originalIntensity = (params.originalIntensity !== undefined) ? params.originalIntensity : 1.0;
//   techparams.originalSaturation = (params.originalSaturation !== undefined) ? params.originalSaturation : 1.0;
//   techparams.inputTexture0 = source;
//   techparams.inputTexture1 = blur1.colorTexture0;
//   effectParams.destination = dest;
//   this.applyEffect(effectParams);
//
//   return true;
// }

export function applyCopy(params) {
  if (!inited) {
    startup();
  }
  let source = params.source;
  if (!source) {
    source = framebufferEnd({ filter_linear: params.filter_linear, need_depth: params.need_depth });
  }
  params.shader = params.shader || 'copy';
  params.params = params.params ? {
    ...shader_params_default,
    ...params.params,
  } : shader_params_default;
  if (Array.isArray(source)) {
    params.texs = source;
  } else {
    params.texs = [source];
  }
  applyEffect(params);
}

export function applyPixelyExpand(params) {
  if (!inited) {
    startup();
  }
  let source = params.source;
  assert(!source); // would need linear/non-wrap sampler state set
  if (!source) {
    source = framebufferEnd({ filter_linear: true });
  }

  // do horizontal blur for primary lines
  let resx = source.width;
  let resy = source.height;
  let sampleRadius = (params.hblur || 0.25) / resx;
  shader_params_gaussian_blur.sampleRadius[0] = sampleRadius;
  shader_params_gaussian_blur.sampleRadius[1] = 0;
  shader_params_gaussian_blur.sampleRadius[2] = 1;
  applyEffect({
    shader: 'gaussian_blur',
    params: shader_params_gaussian_blur,
    texs: [source],
    final: false,
  }, resx, resy);
  let hblur = framebufferEnd({ filter_linear: true });

  // do seperable gaussian blur for scanlines (using horizontal blur from above)
  sampleRadius = (params.vblur || 0.75) / resy;
  shader_params_gaussian_blur.sampleRadius[0] = 0;
  shader_params_gaussian_blur.sampleRadius[1] = sampleRadius;
  shader_params_gaussian_blur.sampleRadius[2] = 1;
  applyEffect({
    shader: 'gaussian_blur',
    params: shader_params_gaussian_blur,
    texs: [hblur],
    final: false,
  }, resx, resy);
  let vblur = framebufferEnd({ filter_linear: true });

  // combine at full res
  v4set(shader_params_pixely_expand.orig_pixel_size,
    source.width, source.height, 1/source.width, 1/source.height);

  applyEffect({
    shader: 'pixely_expand',
    params: shader_params_pixely_expand,
    texs: [source, hblur, vblur],

    clear: params.clear,
    clear_all: params.clear_all,
    clear_color: params.clear_color,
    viewport: params.viewport,
  });
}

export function applyGaussianBlur(params) {
  if (!inited) {
    startup();
  }
  let source = framebufferEnd({ filter_linear: true });
  let max_size = params.max_size || 512;
  let min_size = params.min_size || 128;

  // Quick shrink down to 512->256->128 (or other specified min/max size)
  let inputTexture0 = source;

  let viewport = engine.viewport;
  let res = max_size;
  while (res > viewport[2] || res > viewport[3]) {
    res /= 2;
  }

  while (res > min_size) {
    applyEffect({
      shader: params.shader_copy || 'copy',
      params: shader_params_default,
      texs: [inputTexture0],
      final: false,
    }, res, res);
    inputTexture0 = framebufferEnd({ filter_linear: true });
    res /= 2;
  }

  // Do seperable blur
  let sampleRadius = (params.blur || 1) / res;
  shader_params_gaussian_blur.sampleRadius[0] = sampleRadius;
  shader_params_gaussian_blur.sampleRadius[1] = 0;
  shader_params_gaussian_blur.sampleRadius[2] = params.glow || 1;
  applyEffect({
    shader: 'gaussian_blur',
    params: shader_params_gaussian_blur,
    texs: [inputTexture0],
    final: false,
  }, res, res);
  let blur = framebufferEnd({ filter_linear: true });

  shader_params_gaussian_blur.sampleRadius[0] = 0;
  shader_params_gaussian_blur.sampleRadius[1] = sampleRadius;
  shader_params_gaussian_blur.sampleRadius[2] = params.glow || 1;
  applyEffect({
    shader: 'gaussian_blur',
    params: shader_params_gaussian_blur,
    texs: [blur],
  });

  return true;
}

export function applyColorMatrix(params) {
  if (!inited) {
    startup();
  }
  let source = framebufferEnd({ filter_linear: true });

  let matrix = params.colorMatrix;
  let mout = shader_params_color_matrix.colorMatrix;

  mout[0] = matrix[0];
  mout[1] = matrix[3];
  mout[2] = matrix[6];
  mout[3] = matrix[9];
  mout[4] = matrix[1];
  mout[5] = matrix[4];
  mout[6] = matrix[7];
  mout[7] = matrix[10];
  mout[8] = matrix[2];
  mout[9] = matrix[5];
  mout[10] = matrix[8];
  mout[11] = matrix[11];

  applyEffect({
    shader: 'color_matrix',
    params: shader_params_color_matrix,
    texs: [source],
  });

  return true;
}

// // TODO: Update for RTBBCTT and port to new GLOV.js
// export function applyDistortTODO(params) {
//   let source = params.source;
//   let dest = params.destination;
//   let distort = params.distortion;
//   if (!source || !dest || !distort || !dest.colorTexture0 ||
//     source === dest.colorTexture0 || distort === dest.colorTexture0) {
//     return false;
//   }
//
//   // input transform.
//   //  a b tx
//   //  c d ty
//   let a;
//   let b;
//   let c;
//   let d;
//   let tx;
//   let ty;
//
//   let transform = params.transform;
//   if (transform) {
//     // transform col-major.
//     a = transform[0];
//     b = transform[2];
//     tx = transform[4];
//     c = transform[1];
//     d = transform[3];
//     ty = transform[5];
//   } else {
//     a = d = 1;
//     b = c = 0;
//     tx = ty = 0;
//   }
//
//   let effectParams = this.effectParams;
//   let techparams = this.distortParameters;
//   effectParams.technique = this.distortTechnique;
//   effectParams.params = techparams;
//
//   // TODO: Cache 'transform', 'invTransform', etc in the code below
//   techparams.transform[0] = a;
//   techparams.transform[1] = b;
//   techparams.transform[2] = tx;
//   techparams.transform[3] = c;
//   techparams.transform[4] = d;
//   techparams.transform[5] = ty;
//
//   // Compute inverse transform to use in distort texture displacement..
//   let idet = 1 / (a * d - b * c);
//   let ia = techparams.invTransform[0] = (idet * d);
//   let ib = techparams.invTransform[1] = (idet * -b);
//   let ic = techparams.invTransform[2] = (idet * -c);
//   let id = techparams.invTransform[3] = (idet * a);
//
//   // Compute max pixel offset after transform for normalisation.
//   let x1 = ((ia + ib) * (ia + ib)) + ((ic + id) * (ic + id));
//   let x2 = ((ia - ib) * (ia - ib)) + ((ic - id) * (ic - id));
//   let x3 = ((-ia + ib) * (-ia + ib)) + ((-ic + id) * (-ic + id));
//   let x4 = ((-ia - ib) * (-ia - ib)) + ((-ic - id) * (-ic - id));
//   let xmax = 0.5 * Math.sqrt(Math.max(x1, x2, x3, x4));
//
//   let strength = (params.strength || 10);
//   techparams.strength[0] = strength / (source.width * xmax);
//   techparams.strength[1] = strength / (source.height * xmax);
//
//   techparams.inputTexture0 = source;
//   techparams.distortTexture = distort; // linear / repeat
//   effectParams.destination = dest;
//   this.applyEffect(effectParams);
//
//   return true;
// }

export function clearAlpha() {
  let old_dt = gl.getParameter(gl.DEPTH_TEST);
  if (old_dt) {
    gl.disable(gl.DEPTH_TEST);
  }
  gl.colorMask(false, false, false, true);
  applyCopy({ source: textureWhite(), no_framebuffer: true });
  gl.colorMask(true, true, true, true);
  if (old_dt) {
    gl.enable(gl.DEPTH_TEST);
  }
}

export function effectsStartup(prelink_effects) {
  prelink_effects.forEach((name) => {
    shadersPrelink(getShader('vp_copy'), getShader(name));
  });
}
