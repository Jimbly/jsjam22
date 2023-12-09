// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint @typescript-eslint/no-shadow:off */

const assert = require('assert');
const engine = require('./engine.js');

const { max, round } = Math;

const safearea_pad = new Float32Array(4); // left, right, top, bottom
// 0: x0_real
// 1: y0_real
// 2: x1_real
// 3: y1_real
// 4: x_scale
// 5: y_scale
// 6: dom_to_canvas_ratio
// 7: inverse viewport x_scale
// 8: inverse viewport y_scale
// 9: x0
// 10: y0
// 11: x1
// 12: y1
export const data = new Float32Array(13);

let screen_width;
let screen_height;
// Note: render_* not used by FRVR at this time
let render_width;
let render_height;
export let render_viewport_w;
export let render_viewport_h;
export let render_offset_x;
let render_offset_y_top;
export let render_offset_y_bottom;

function reapply() {
  if (render_width) {
    data[4] = render_width / (data[2] - data[0]);
    data[5] = render_height / (data[3] - data[1]);
    data[7] = (data[2] - data[0]) / render_viewport_w;
    data[8] = (data[3] - data[1]) / render_viewport_h;
  } else {
    data[4] = screen_width / (data[2] - data[0]);
    data[5] = screen_height / (data[3] - data[1]);
  }
}

// To get to coordinates used by OpenGL / canvas
export function virtualToCanvas(dst, src) {
  dst[0] = (src[0] - data[0]) * data[4];
  dst[1] = (src[1] - data[1]) * data[5];
}
export function transformX(x) {
  return (x - data[0]) * data[4];
}
export function transformY(y) {
  return (y - data[1]) * data[5];
}

export function canvasToVirtual(dst, src) {
  dst[0] = src[0] / data[4] + data[0];
  dst[1] = src[1] / data[5] + data[1];
}

function safeScreenWidth() {
  return max(1, screen_width - safearea_pad[0] - safearea_pad[1]);
}

function safeScreenHeight() {
  return max(1, screen_height - safearea_pad[2] - safearea_pad[3]);
}

// Sets the 2D "camera" used to translate sprite positions to screen space.  Affects sprites queued
//  after this call
export function set(x0, y0, x1, y1, ignore_safe_area) {
  assert(isFinite(x0));
  assert(isFinite(y0));
  assert(isFinite(x1));
  assert(isFinite(y1));
  if (ignore_safe_area || render_width) {
    data[9] = data[0] = x0;
    data[10] = data[1] = y0;
    data[11] = data[2] = x1;
    data[12] = data[3] = y1;
  } else {
    data[9] = x0;
    data[10] = y0;
    data[11] = x1;
    data[12] = y1;
    let wscale = (x1 - x0) / safeScreenWidth();
    let hscale = (y1 - y0) / safeScreenHeight();
    data[0] = x0 - safearea_pad[0] * wscale;
    data[1] = y0 - safearea_pad[2] * hscale;
    data[2] = x1 + safearea_pad[1] * wscale;
    data[3] = y1 + safearea_pad[3] * hscale;
  }

  reapply();
}

export function setSafeAreaPadding(left, right, top, bottom) {
  safearea_pad[0] = round(left);
  safearea_pad[1] = round(right);
  safearea_pad[2] = round(top);
  safearea_pad[3] = round(bottom);
  // Called while updating screen width/height, reapply() should get called later
}

export function safeAreaPadding() {
  return safearea_pad;
}

const stack = [];
export function push() {
  stack.push(data.slice(0));
}
export function pop() {
  let old = stack.pop();
  for (let ii = 0; ii < old.length; ++ii) {
    data[ii] = old[ii];
  }
  reapply();
}

export function domToCanvasRatio() {
  return data[6];
}

export function screenAspect() {
  return safeScreenWidth() /
    safeScreenHeight();
}

// Drawing area 0,0-w,h
// But keep the aspect ratio of those things drawn to be correct
// This may create a padding or margin on either top and bottom or sides of the screen
// User should use constant values in this range for consistent UI on all devices
export function setAspectFixed(w, h) {
  let pa = render_width ? 1 : engine.pixel_aspect;
  let inv_aspect = h / pa / w;
  let inv_desired_aspect;
  let screen_w;
  let screen_h;
  if (render_width) {
    screen_w = render_width;
    screen_h = render_height;
  } else {
    screen_w = safeScreenWidth();
    screen_h = safeScreenHeight();
  }
  inv_desired_aspect = screen_h / screen_w;
  // ensure the left/top margin is integer screen pixels
  // Note: the margin is, however, not integer virtual pixels, so anything
  //   using an `integral` font and camera2d.x0()/etc will have artifacts
  if (inv_aspect > inv_desired_aspect) {
    let virtual_w = h / pa / inv_desired_aspect;
    let virtual_to_screen = screen_w / virtual_w;
    let margin = virtual_w - w;
    let left_margin_screen_px = round(margin * virtual_to_screen / 2);
    let left_margin = left_margin_screen_px / virtual_to_screen;
    let right_margin = margin - left_margin;
    set(-left_margin, 0, w + right_margin, h, false);
  } else {
    let virtual_h = w * pa * inv_desired_aspect;
    let virtual_to_screen = screen_h / virtual_h;
    let margin = virtual_h - h;
    let top_margin_screen_px = round(margin * virtual_to_screen / 2);
    let top_margin = top_margin_screen_px / virtual_to_screen;
    let bot_margin = margin - top_margin;
    set(0, -top_margin, w, h + bot_margin, false);
  }
}

// Primary drawing area at least W x H
// But keep the aspect ratio of those things drawn to be correct
// Similar to setAspectFixed() but keeps (0,0) in the upper left (all padding
//   is added to right and bottom)
// Requires users to use camera2d.w()/ and camera2d.h() to determine reasonable
//   UI positioning
export function setAspectFixed2(w, h) {
  let pa = render_width ? 1 : engine.pixel_aspect;
  let inv_aspect = h / pa / w;
  let inv_desired_aspect;
  if (render_width) {
    inv_desired_aspect = render_height / render_width;
  } else {
    inv_desired_aspect = 1 / screenAspect();
  }
  if (inv_aspect > inv_desired_aspect) {
    let margin = (h / pa / inv_desired_aspect - w);
    set(0, 0, w + margin, h, false);
  } else {
    let margin = (w * pa * inv_desired_aspect - h);
    set(0, 0, w, h + margin, false);
  }
}

export function zoom(x, y, factor) {
  let inv_factor = 1.0 / factor;
  set(
    x - (x - data[0]) * inv_factor,
    y - (y - data[1]) * inv_factor,
    x + (data[2] - x) * inv_factor,
    y + (data[3] - y) * inv_factor, true);
}

export function shift(dx, dy) {
  set(data[0] + dx, data[1] + dy, data[2] + dx, data[3] + dy, true);
}

// returns [x0,y0,x1,y1] to use as parameters set() such that src_rect in the
// current view is now addressable by dest_rect (presumably something like
// [0,0,vw,vh])
export function calcMap(out, src_rect, dest_rect) {
  let cur_w = data[11] - data[9];
  let cur_h = data[12] - data[10];
  let vx0 = (src_rect[0] - data[9]) / cur_w;
  let vy0 = (src_rect[1] - data[10]) / cur_h;
  let vx1 = (src_rect[2] - data[9]) / cur_w;
  let vy1 = (src_rect[3] - data[10]) / cur_h;
  let vw = vx1 - vx0;
  let vh = vy1 - vy0;
  let dest_vw = dest_rect[2] - dest_rect[0];
  let dest_vh = dest_rect[3] - dest_rect[1];
  out[0] = dest_rect[0] - dest_vw / vw * vx0;
  out[1] = dest_rect[1] - dest_vh / vh * vy0;
  out[2] = dest_rect[2] + dest_vw / vw * (1 - vx1);
  out[3] = dest_rect[3] + dest_vh / vh * (1 - vy1);
  return out;
}

export function setNormalized() {
  set(0, 0, 1, 1, true);
}

// Sets virtual viewport equal to (DPI-aware) screen pixels
//   (generally a bad idea, will not scale well without lots of app work)
export function setScreen(no_dpi_aware) {
  if (render_width) {
    set(0, 0, render_width, render_height);
  } else if (no_dpi_aware) {
    set(0, 0, safeScreenWidth(), safeScreenHeight());
  } else {
    set(0, 0, safeScreenWidth() / engine.dom_to_canvas_ratio, safeScreenHeight() / engine.dom_to_canvas_ratio);
  }
}

// Sets virtual viewport equal to DOM coordinates, for debugging input events/etc
export function setDOMMapped() {
  if (render_width) {
    set(render_offset_x, render_offset_y_top,
      screen_width - render_offset_x, screen_height - render_offset_y_top, true);
  } else {
    set(0, 0, screen_width / engine.dom_to_canvas_ratio, screen_height / engine.dom_to_canvas_ratio, true);
  }
}

export function x0Real() {
  return data[0];
}
export function y0Real() {
  return data[1];
}
export function x1Real() {
  return data[2];
}
export function y1Real() {
  return data[3];
}
export function wReal() {
  return data[2] - data[0];
}
export function hReal() {
  return data[3] - data[1];
}
export function x0() {
  return data[9];
}
export function y0() {
  return data[10];
}
export function x1() {
  return data[11];
}
export function y1() {
  return data[12];
}
export function w() {
  return data[11] - data[9];
}
export function h() {
  return data[12] - data[10];
}
export function xScale() {
  return data[4];
}
export function yScale() {
  return data[5];
}

export function htmlPos(x, y) {
  if (render_width) {
    return [
      100 * (((x - data[0]) / data[7] + render_offset_x) / screen_width),
      100 * (((y - data[1]) / data[8] + render_offset_y_top) / screen_height),
    ];
  } else {
    return [
      100 * (x - data[0]) / (data[2] - data[0]),
      100 * (y - data[1]) / (data[3] - data[1]),
    ];
  }
}
export function htmlSize(w, h) {
  if (render_width) {
    return [
      100 * w / data[7] / screen_width,
      100 * h / data[8] / screen_height,
    ];
  } else {
    return [100 * w / (data[2] - data[0]), 100 * h / (data[3] - data[1])];
  }
}

let input_clipping;
export function setInputClipping(xywh) {
  input_clipping = xywh;
}

export function domToVirtual(dst, src) {
  let ret = true;
  if (input_clipping) {
    if (src[0] < input_clipping[0] || src[0] > input_clipping[0] + input_clipping[2] ||
      src[1] < input_clipping[1] || src[1] > input_clipping[1] + input_clipping[3]
    ) {
      ret = false;
    }
  }
  if (render_width) {
    dst[0] = (src[0] * data[6] - render_offset_x) * data[7] + data[0];
    dst[1] = (src[1] * data[6] - render_offset_y_top) * data[8] + data[1];
  } else {
    dst[0] = src[0] * data[6] / data[4] + data[0];
    dst[1] = src[1] * data[6] / data[5] + data[1];
  }
  return ret;
}

export function domDeltaToVirtual(dst, src) {
  if (render_width) {
    dst[0] = src[0] * data[6] * data[7];
    dst[1] = src[1] * data[6] * data[8];
  } else {
    dst[0] = src[0] * data[6] / data[4];
    dst[1] = src[1] * data[6] / data[5];
  }
}

let input_clipping_virtual = new Float32Array(4);
function updateVirtualInputClipping() {
  domToVirtual(input_clipping_virtual, input_clipping);
  //domDeltaToVirtual(input_clipping_virtual.slice(2), input_clipping.slice(2)) :
  if (render_width) {
    input_clipping_virtual[2] = input_clipping[2] * data[6] * data[7];
    input_clipping_virtual[3] = input_clipping[3] * data[6] * data[8];
  } else {
    input_clipping_virtual[2] = input_clipping[2] * data[6] / data[4];
    input_clipping_virtual[3] = input_clipping[3] * data[6] / data[5];
  }
}


// To get to coordinates used by mouse events
export function virtualToDom(dst, src) {
  if (render_width) {
    dst[0] = (render_offset_x + (src[0] - data[0]) / data[7]) / data[6];
    dst[1] = (render_offset_y_top + (src[1] - data[1]) / data[8]) / data[6];
  } else {
    dst[0] = (src[0] - data[0]) * data[4] / data[6];
    dst[1] = (src[1] - data[1]) * data[5] / data[6];
  }
}

let font_pixel_scale = 0.84; // approx for palanquin; use 0.970 for PerfectVGA
export function setDOMFontPixelScale(scale) {
  font_pixel_scale = scale;
}
export function virtualToFontSize(height) {
  if (render_width) {
    return height / (data[6] * data[8]) * font_pixel_scale;
  } else {
    return height * data[5] / data[6] * font_pixel_scale;
  }
}

// dst/src are x/y/w/h objects (e.g. from input system)
export function virtualToDomPosParam(dst, src) {
  if (render_width) {
    dst.x = (render_offset_x + (src.x - data[0]) / data[7]) / data[6];
    dst.w = src.w / data[7] / data[6];
    dst.y = (render_offset_y_top + (src.y - data[1]) / data[8]) / data[6];
    dst.h = src.h / data[8] / data[6];
  } else {
    dst.x = (src.x - data[0]) * data[4] / data[6];
    dst.w = src.w * data[4] / data[6];
    dst.y = (src.y - data[1]) * data[5] / data[6];
    dst.h = src.h * data[5] / data[6];
  }
  if (input_clipping) {
    if (dst.x < input_clipping[0]) {
      dst.w = max(0, dst.w - (input_clipping[0] - dst.x));
      dst.x = input_clipping[0];
    }
    if (dst.y < input_clipping[1]) {
      dst.h = max(0, dst.h - (input_clipping[1] - dst.y));
      dst.y = input_clipping[1];
    }
    if (dst.x > input_clipping[0] + input_clipping[2]) {
      dst.w = 0;
    }
    if (dst.y > input_clipping[1] + input_clipping[3]) {
      dst.h = 0;
    }
  }
}

export function clipTestRect(rect) {
  if (!input_clipping) {
    return true;
  }
  updateVirtualInputClipping();
  let icv = input_clipping_virtual;
  if (rect.x > icv[0] + icv[2] ||
    rect.x + rect.w < icv[0] ||
    rect.y > icv[1] + icv[3] ||
    rect.y + rect.h < icv[1]
  ) {
    // fully clipped
    return false;
  }
  if (rect.x < icv[0]) {
    rect.w -= icv[0] - rect.x;
    rect.x = icv[0];
  }
  if (rect.y < icv[1]) {
    rect.h -= icv[1] - rect.y;
    rect.y = icv[1];
  }
  if (rect.x + rect.w > icv[0] + icv[2]) {
    rect.w = icv[0] + icv[2] - rect.x;
  }
  if (rect.y + rect.h > icv[1] + icv[3]) {
    rect.h = icv[1] + icv[3] - rect.y;
  }
  return true;
}

export function tickCamera2D() {
  data[6] = engine.dom_to_canvas_ratio; /* dom_to_canvas_ratio */
  screen_width = engine.width;
  screen_height = engine.height;
  let viewport = [0, 0, screen_width, screen_height];
  if (engine.render_width) { // Note: render_* not used by FRVR at this time
    render_width = engine.render_width;
    render_height = engine.render_height;
    // Find an offset so this rendered viewport is centered while preserving aspect ratio, just like setAspectFixed
    let pa = engine.pixel_aspect;
    let inv_aspect = render_height / pa / render_width;
    let eff_screen_width = safeScreenWidth();
    let eff_screen_height = safeScreenHeight();
    let inv_desired_aspect = eff_screen_height / eff_screen_width;
    if (inv_aspect > inv_desired_aspect) {
      let margin = (render_height / inv_desired_aspect - render_width * pa) / 2 *
        eff_screen_height / render_height;
      render_offset_x = safearea_pad[0] + round(margin);
      render_offset_y_top = safearea_pad[2];
      render_offset_y_bottom = safearea_pad[3];
      render_viewport_w = round(eff_screen_width - margin * 2);
      render_viewport_h = eff_screen_height;
    } else {
      let margin = (render_width * inv_desired_aspect - render_height / pa) / 2 *
        eff_screen_width / render_width;
      render_offset_x = safearea_pad[0];
      render_offset_y_top = safearea_pad[2] + round(margin);
      render_offset_y_bottom = safearea_pad[3] + round(margin);
      render_viewport_w = eff_screen_width;
      render_viewport_h = round(eff_screen_height - margin * 2);
    }
    viewport[2] = render_width;
    viewport[3] = render_height;
  } else {
    render_width = render_height = 0;
    render_offset_x = 0;
    render_offset_y_top = 0;
    render_offset_y_bottom = 0;
  }

  reapply();

  // let screen_width = engine.width;
  // let screen_height = engine.height;
  // let screen_aspect = screen_width / screen_height;
  // let view_aspect = game_width / game_height;
  // if (screen_aspect > view_aspect) {
  //   let viewport_width = game_height * screen_aspect;
  //   let half_diff = (viewport_width - game_width) / 2;
  //   viewportRectangle = [-half_diff, 0, game_width + half_diff, game_height];
  // } else {
  //   let viewport_height = game_width / screen_aspect;
  //   let half_diff = (viewport_height - game_height) / 2;
  //   viewportRectangle = [0, -half_diff, game_width, game_height + half_diff];
  // }

  engine.setViewport(viewport);
}

export function startup() {
  screen_width = engine.width;
  screen_height = engine.height;
  set(0, 0, engine.width, engine.height);
  tickCamera2D();
}
