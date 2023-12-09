// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import {
  easeOut,
  lerp,
} from 'glov/common/util';
import * as verify from 'glov/common/verify';
import { unit_vec, vec4 } from 'glov/common/vmath';
import * as camera2d from './camera2d';
import {
  applyCopy,
  effectsIsFinal,
  effectsQueue,
} from './effects';
import * as glov_engine from './engine';
import {
  framebufferCapture,
  framebufferEnd,
  framebufferStart,
  temporaryTextureClaim,
} from './framebuffer';
import { shaderCreate } from './shaders';
import * as sprites from './sprites';
import { textureCreateForCapture } from './textures';
import * as glov_ui from './ui';

const { PI, abs, cos, floor, min, pow, random, sin, sqrt } = Math;
const SQRT1_2 = sqrt(1/2);
const PI_4 = PI/4;
const PI_2 = PI/2;

let transitions = [];

export const IMMEDIATE = 'immediate';

export const REMOVE = 'remove';
export const CONTINUE = 'continue';

const shader_data = {
  transition_pixelate: {
    fp: 'shaders/transition_pixelate.fp',
  },
};

function getShader(key) {
  let elem = shader_data[key];
  if (!elem.shader) {
    elem.shader = shaderCreate(elem.fp);
  }
  return elem.shader;
}

function GlovTransition(z, func) {
  this.z = z;
  this.capture = null;
  this.func = func;
  this.accum_time = 0;
}

function transitionCapture(trans) {
  // Warning: Slow on iOS
  assert(!trans.capture);
  trans.capture = textureCreateForCapture();
  framebufferCapture(trans.capture);
}

function transitionCaptureFramebuffer(trans) {
  assert(!trans.capture);
  trans.capture = framebufferEnd();
  temporaryTextureClaim(trans.capture);
  if (trans.capture.fbo) {
    // new framebuffer bound, effectively cleared, need to blit this to it!
    applyCopy({ source: trans.capture, final: effectsIsFinal() });
  } else {
    framebufferStart({
      width: trans.capture.width,
      height: trans.capture.height,
      final: effectsIsFinal(),
    });
  }
}

export function queue(z, fn) {
  assert(!glov_engine.had_3d_this_frame); // Cannot queue a transition after we've already started 3d rendering/cleared
  let immediate = false;
  if (z === IMMEDIATE) {
    immediate = true;
    z = Z.TRANSITION_FINAL;
  }

  for (let ii = 0; ii < transitions.length; ++ii) {
    let trans = transitions[ii];
    if (trans.z === z) {
      // same Z
      if (!verify(trans.capture)) {
        // two transitions at the same Z on one frame!  ignore second
        return false;
      }
    }
  }
  let trans = new GlovTransition(z, fn);
  transitions.push(trans);

  if (immediate) {
    transitionCapture(trans);
  } else {
    // queue up a capture past the specified Z, so transitions rendering at that Z (plus a handful) get captured
    effectsQueue(z + Z.TRANSITION_RANGE, transitionCaptureFramebuffer.bind(null, trans));
    //spriteQueueFn(z + Z.TRANSITION_RANGE, transitionCapture.bind(null, trans));
  }
  return true;
}

function destroyTexture(tex) {
  profilerStart('transition:destroyTexture');
  tex.destroy();
  profilerStop();
}

export function render(dt) {
  dt = min(dt, 100); // debug: clamp frame times
  for (let trans_idx = 0; trans_idx < transitions.length; ++trans_idx) {
    let trans = transitions[trans_idx];
    trans.accum_time += dt;
    assert(trans.capture);
    // call the function and give them the Z
    // If not the last one, want it to end now!
    let force_end = trans_idx < transitions.length - 1;
    let ret = trans.func(trans.z, trans.capture, trans.accum_time, force_end);
    if (ret === REMOVE) {
      setTimeout(destroyTexture.bind(null, trans.capture), 0);
      transitions.splice(trans_idx, 1);
      trans_idx--;
    }
  }
}

export function active() {
  return transitions.length;
}

function glovTransitionFadeFunc(fade_time, z, initial, ms_since_start, force_end) {
  let progress = min(ms_since_start / fade_time, 1);
  let alpha = (1 - easeOut(progress, 2));
  let color = vec4(1, 1, 1, alpha);
  camera2d.setNormalized();
  sprites.queueraw4([initial],
    0, 0, 0, 1,
    1, 1, 1, 0,
    z,
    0, 1, 1, 0,
    color);

  if (force_end || progress === 1) {
    return REMOVE;
  }
  return CONTINUE;
}


function glovTransitionWipeFunc(wipe_time, wipe_angle, z, tex, ms_since_start, force_end) {
  let progress = min(ms_since_start / wipe_time, 1);

  camera2d.setNormalized();

  let uvs = [[0,1], [1,0]];

  let points = [{}, {}, {}, {}];
  for (let ii = 0; ii < 4; ii++) {
    let x = (ii === 1 || ii === 2) ? 1 : 0;
    let y = (ii >= 2) ? 1 : 0;
    points[ii].x = x;
    points[ii].y = y;
  }

  // change 0 degrees to be up, not right, to match other things.
  wipe_angle -= PI/2;

  while (wipe_angle > PI) {
    wipe_angle -= (2 * PI);
  }
  while (wipe_angle < -PI) {
    wipe_angle += (2 * PI);
  }

  if (wipe_angle >= -PI_4 && wipe_angle <= PI_4) {
    // horizontal wipe from left to right
    let x0 = progress * 2; // rightmost x
    let x1 = x0 - sin(abs(wipe_angle)) / SQRT1_2; // leftmost x
    if (wipe_angle < 0) {
      points[0].x = x1;
      points[3].x = x0;
    } else {
      points[0].x = x0;
      points[3].x = x1;
    }
    points[1].x = points[2].x = 2;
  } else if (wipe_angle >= PI_2 + PI_4 || wipe_angle <= -PI_2 - PI_4) {
    // horizontal wipe from right to left
    let x0 = 1 - progress * 2; // leftmost x
    let x1 = x0 + sin(abs(wipe_angle)) / SQRT1_2; // rightmost x,
    if (wipe_angle < 0) {
      points[1].x = x1;
      points[2].x = x0;
    } else {
      points[1].x = x0;
      points[2].x = x1;
    }
    points[0].x = points[3].x = -1;
  } else if (wipe_angle > PI_4 && wipe_angle <= PI_2 + PI_4) {
    // vertical wipe, top to bottom
    let y0 = progress * 2; // bottommost y
    let offs = cos(wipe_angle) / SQRT1_2;
    let y1 = y0 - abs(offs); // topmost y,
    if (offs > 0) {
      points[0].y = y0;
      points[1].y = y1;
    } else {
      points[0].y = y1;
      points[1].y = y0;
    }
    points[2].y = points[3].y = 2;
  } else {
    // vertical wipe, bottom to top
    let y0 = 1 - progress * 2; // topmost y
    let offs = cos(wipe_angle) / SQRT1_2;
    let y1 = y0 + abs(offs); // bottommost y,
    if (offs > 0) {
      points[2].y = y1;
      points[3].y = y0;
    } else {
      points[2].y = y0;
      points[3].y = y1;
    }
    points[0].y = points[1].y = -1;
  }
  // interp UVs based on points
  points[0].u = lerp(points[0].x, uvs[0][0], uvs[1][0]);
  points[1].u = lerp(points[1].x, uvs[0][0], uvs[1][0]);
  points[2].u = lerp(points[2].x, uvs[0][0], uvs[1][0]);
  points[3].u = lerp(points[3].x, uvs[0][0], uvs[1][0]);
  points[0].v = lerp(points[0].y, uvs[0][1], uvs[1][1]);
  points[1].v = lerp(points[1].y, uvs[0][1], uvs[1][1]);
  points[2].v = lerp(points[2].y, uvs[0][1], uvs[1][1]);
  points[3].v = lerp(points[3].y, uvs[0][1], uvs[1][1]);

  sprites.queueraw4color([tex],
    points[0].x, points[0].y, unit_vec, points[0].u, points[0].v,
    points[3].x, points[3].y, unit_vec, points[3].u, points[3].v,
    points[2].x, points[2].y, unit_vec, points[2].u, points[2].v,
    points[1].x, points[1].y, unit_vec, points[1].u, points[1].v,
    z);

  if (force_end || progress === 1) {
    return REMOVE;
  }
  return CONTINUE;
}

function glovTransitionSplitScreenFunc(time, border_width, slide_window, z, tex, ms_since_start, force_end) {
  let border_color = vec4(1, 1, 1, 1);
  let progress = easeOut(min(ms_since_start / time, 1), 2);
  camera2d.setNormalized();

  let uvs = [[0,1], [1,0]];

  let xoffs = progress;
  let v_half = uvs[0][1] + (uvs[1][1] - uvs[0][1]) / 2;
  if (slide_window) { // slide window
    sprites.queueraw([tex], 0, 0, z, 1 - xoffs, 1 / 2,
      0, uvs[0][1], uvs[1][0] * (1 - progress), v_half,
      unit_vec);
    sprites.queueraw([tex], 0 + xoffs, 1 / 2, z, 1 - xoffs, 1 / 2,
      uvs[1][0] * progress, v_half, uvs[1][0], uvs[1][1],
      unit_vec);
  } else { // slide image
    sprites.queueraw([tex], 0 - xoffs, 0, z, 1, 1 / 2,
      uvs[0][0], uvs[0][1], uvs[1][0], v_half,
      unit_vec);
    sprites.queueraw([tex], 0 + xoffs, 1 / 2, z, 1, 1 / 2,
      uvs[0][0], v_half, uvs[1][0], uvs[1][1],
      unit_vec);
  }
  let border_grow_progress = min(progress * 4, 1);
  border_color[3] = border_grow_progress;
  border_width *= border_grow_progress;
  // TODO: Would look better if the horizontal border grew from the middle out, so the overlapping bit is identical
  // on both sides
  glov_ui.drawRect(0, 0.5 - border_width, 1 - xoffs, 0.5, z + 1, border_color);
  glov_ui.drawRect(1 - xoffs - border_width, 0, 1 - xoffs, 0.5, z + 1, border_color);
  glov_ui.drawRect(xoffs, 0.5, 1, 0.5 + border_width, z + 1, border_color);
  glov_ui.drawRect(xoffs, 0.5, xoffs + border_width, 1, z + 1, border_color);

  if (force_end || progress === 1) {
    return REMOVE;
  }
  return CONTINUE;
}

const render_scale = 1;
let transition_pixelate_textures = [null];

function transitionPixelateCapture() {
  let tex = framebufferEnd();
  framebufferStart({
    width: tex.width,
    height: tex.height,
    final: effectsIsFinal(),
  });
  transition_pixelate_textures[0] = tex;
}

function glovTransitionPixelateFunc(time, z, tex, ms_since_start, force_end) {
  //ms_since_start %= time;
  //let viewport = glov_engine.graphics_device.getViewport();
  //let gd_width = viewport[2];
  let gd_width = glov_engine.width;
  let progress = min(ms_since_start / time, 1);
  camera2d.setNormalized();

  transition_pixelate_textures[0] = tex;
  if (progress > 0.5) {
    effectsQueue(z, transitionPixelateCapture); // modifies transition_pixelate_textures[]
  }

  let partial_progress = (progress > 0.5 ? 1 - progress : progress) * 2;
  // Use power of two scalings, but then scale relative to a 1024px virtual screen, so the biggest
  //  pixel is about the same percentage of the screen regardless of resolution.
  let pixel_scale = pow(2, floor(partial_progress * 8.9)) / 1024 * gd_width * render_scale;

  let param0 = vec4(tex.width / pixel_scale, tex.height / pixel_scale,
    pixel_scale / tex.width, pixel_scale / tex.height);
  let param1 = vec4(0.5 / tex.width, 0.5 / tex.height,
    (tex.texSizeX - 1) / tex.width, (tex.texSizeY - 1) / tex.height);


  sprites.queueraw(transition_pixelate_textures, 0, 0, z + 1, 1, 1,
    0, 1, 1, 0,
    unit_vec, getShader('transition_pixelate'), {
      param0,
      param1,
    });

  if (force_end || progress === 1) {
    return REMOVE;
  }
  return CONTINUE;
}

export function fade(fade_time) {
  return glovTransitionFadeFunc.bind(null, fade_time);
}

export function wipe(wipe_time, wipe_angle) {
  return glovTransitionWipeFunc.bind(null, wipe_time, wipe_angle);
}

// border_width in camera-relative size
export function splitScreen(time, border_width, slide_window) {
  border_width /= camera2d.w(); // convert to normalized units
  return glovTransitionSplitScreenFunc.bind(null, time, border_width, slide_window);
}

export function pixelate(fade_time) {
  return glovTransitionPixelateFunc.bind(null, fade_time);
}

// export function logoZoom(time, logo) {
//   return glovTransitionLogoZoomFunc.bind(null, time, logo);
// }

export function randomTransition(fade_time_scale) {
  fade_time_scale = fade_time_scale || 1;
  let idx = floor(random() * 3);
  switch (idx) {
    case 0:
      return fade(500 * fade_time_scale);
    case 1:
      return splitScreen(250 * fade_time_scale, 2, false);
    case 2:
      return pixelate(750 * fade_time_scale);
    case 3:
      return wipe(250 * fade_time_scale, random() * 2 * PI);
    // case 4:
    //   if (!logo) {
    //     GlovTextureLoadOptions options;
    //     options.wrap_s = options.wrap_t = gl.CLAMP_TO_EDGE;
    //     logo = GlovTextures::loadtex("data/SampleLogoTransition.png", &options);
    //   }
    //   glovTransitionQueue(Z_TRANSITION_FINAL, glovTransitionLogoZoom(500, logo));
    //   break;
    default:
      assert(0);
  }
  return null;
}
