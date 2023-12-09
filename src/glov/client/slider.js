import * as assert from 'assert';
const { round, max } = Math;
import { clamp } from 'glov/common/util.js';
import { vec4 } from 'glov/common/vmath.js';
import * as input from './input.js';
import {
  SPOT_DEFAULT_BUTTON,
  SPOT_NAV_LEFT,
  SPOT_NAV_RIGHT,
  spot,
} from './spot.js';
import {
  Z_MIN_INC,
  drawHBox,
  playUISound,
  uiButtonHeight,
  uiButtonWidth,
} from './ui.js';
import * as ui from './ui.js';

const SPOT_DEFAULT_SLIDER = {
  ...SPOT_DEFAULT_BUTTON,
  sound_button: null,
  custom_nav: {
    [SPOT_NAV_RIGHT]: null,
    [SPOT_NAV_LEFT]: null,
  },
};

let slider_default_vshrink = 1.0;
let slider_default_handle_shrink = 1.0;
let slider_default_inset = 0.0;
export function sliderSetDefaultShrink(vshrink, handle_shrink, slider_inset) {
  slider_default_vshrink = vshrink;
  slider_default_handle_shrink = handle_shrink;
  slider_default_inset = slider_inset || 0;
}
const color_slider_handle = vec4(1,1,1,1);
const color_slider_handle_grab = vec4(0.5,0.5,0.5,1);
const color_slider_handle_over = vec4(0.75,0.75,0.75,1);
let slider_dragging = false; // for caller polling
let slider_focused = false; // for caller polling
export function sliderIsDragging() {
  return slider_dragging;
}
export function sliderIsFocused() {
  return slider_focused;
}
// Returns new value
export function slider(value, param) {
  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.min < param.max); // also must be numbers
  // optional params
  param.z = param.z || Z.UI;
  param.w = param.w || uiButtonWidth();
  param.h = param.h || uiButtonHeight();
  param.max_dist = param.max_dist || Infinity;
  // below: param.step = param.step || (param.max - param.min)/16;
  let vshrink = param.vshrink || slider_default_vshrink;
  let handle_shrink = param.handle_shrink || slider_default_handle_shrink;
  let disabled = param.disabled || false;
  let handle_h = param.h * handle_shrink;
  let handle_w = ui.sprites.slider_handle.uidata.wh[0] * handle_h;
  let pad_focusable = param.pad_focusable;

  slider_dragging = false;

  let shrinkdiff = handle_shrink - vshrink + slider_default_inset;
  drawHBox({
    x: param.x + param.h * shrinkdiff/2,
    y: param.y + param.h * (1 - vshrink)/2,
    z: param.z,
    w: param.w - param.h * shrinkdiff,
    h: param.h * vshrink,
  }, ui.sprites.slider, param.color);

  let xoffs = round(max(ui.sprites.slider.uidata.wh[0] * param.h * vshrink, handle_w) / 2);
  let draggable_width = param.w - xoffs * 2;

  // Draw notches - would also need to quantize the values below
  // if (!slider->no_notches) {
  //   float space_for_notches = width - xoffs * 4;
  //   int num_notches = max - 1;
  //   float notch_w = tile_scale * glov_ui_slider_notch->GetTileWidth();
  //   float notch_h = tile_scale * glov_ui_slider_notch->GetTileHeight();
  //   float max_notches = space_for_notches / (notch_w + 2);
  //   int notch_inc = 1;
  //   if (num_notches > max_notches)
  //     notch_inc = ceil(num_notches / floor(max_notches));

  //   for (int ii = 1; ii*notch_inc <= num_notches; ii++) {
  //     float notch_x_mid = x + xoffs + draggable_width * ii * notch_inc / (float)max;
  //     if (notch_x_mid - notch_w/2 < x + xoffs * 2)
  //       continue;
  //     if (notch_x_mid + notch_w/2 > x + width - xoffs * 2)
  //       continue;
  //     glov_ui_slider_notch->DrawStretchedColor(notch_x_mid - notch_w / 2, y + yoffs,
  //       z + 0.25, notch_w, notch_h, 0, color);
  //   }
  // }

  // Handle
  let drag = !disabled && input.drag(param);
  let grabbed = Boolean(drag);
  param.def = SPOT_DEFAULT_SLIDER;
  if (grabbed) {
    param.focus_steal = true;
  }
  param.pad_focusable = pad_focusable;
  let spot_ret = spot(param);
  slider_focused = spot_ret.focused;
  if (spot_ret.ret && spot_ret.pos) {
    // was actually clicked (not
    grabbed = false;
    // update pos
    value = (spot_ret.pos[0] - (param.x + xoffs)) / draggable_width;
    value = param.min + (param.max - param.min) * clamp(value, 0, 1);
    playUISound('button_click');
  } else if (grabbed) {
    // update pos
    value = (drag.cur_pos[0] - (param.x + xoffs)) / draggable_width;
    value = param.min + (param.max - param.min) * clamp(value, 0, 1);
    // Eat all mouseovers while dragging
    input.mouseOver();
    slider_dragging = true;
    slider_focused = true;
  }
  if (spot_ret.nav) {
    playUISound('button_click');
    let step = param.step || (param.max - param.min)/16;
    if (spot_ret.nav === SPOT_NAV_RIGHT) {
      value = clamp(value + step, param.min, param.max);
    } else if (spot_ret.nav === SPOT_NAV_LEFT) {
      value = clamp(value - step, param.min, param.max);
    }
  }
  let value_for_handle = clamp(value, param.min, param.max);
  let handle_center_pos = param.x + xoffs + draggable_width * (value_for_handle - param.min) / (param.max - param.min);
  let handle_x = handle_center_pos - handle_w / 2;
  let handle_y = param.y + param.h / 2 - handle_h / 2;
  let handle_color = color_slider_handle;
  if (grabbed) {
    handle_color = color_slider_handle_grab;
  } else if (spot_ret.focused) {
    handle_color = color_slider_handle_over;
  }

  ui.sprites.slider_handle.draw({
    x: handle_x,
    y: handle_y,
    z: param.z + Z_MIN_INC,
    w: handle_w,
    h: handle_h,
    color: handle_color,
    frame: 0,
  });

  return value;
}
