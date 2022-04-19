// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-underscore-dangle:off */

window.Z = window.Z || {};
export const Z = window.Z;

Z.BORDERS = Z.BORDERS || 90;
Z.UI = Z.UI || 100;
Z.MODAL = Z.MODAL || 1000;
Z.TOOLTIP = Z.TOOLTIP || 2000;
Z.DEBUG = Z.DEBUG || 9800;

// very high, but can still add integers
Z.TRANSITION_FINAL = Z.TRANSITION_FINAL || 9900;
// how much Z range can be used for rendering transitions - the capture happens at z + Z_TRANSITION_RANGE
Z.TRANSITION_RANGE = Z.TRANSITION_RANGE || 10;

Z.FPSMETER = Z.FPSMETER || 10000;

export const LINE_ALIGN = 1<<0;
export const LINE_CAP_SQUARE = 1<<1;
export const LINE_CAP_ROUND = 1<<2;

const assert = require('assert');
const camera2d = require('./camera2d.js');
const glov_edit_box = require('./edit_box.js');
const effects = require('./effects.js');
const { effectsQueue } = effects;
const glov_engine = require('./engine.js');
const glov_font = require('./font.js');
const glov_input = require('./input.js');
const { mouseMoved } = glov_input;
const { linkTick } = require('./link.js');
const { getStringFromLocalizable } = require('./localization.js');
const { abs, floor, max, min, round, sqrt } = Math;
const { soundLoad, soundPlay } = require('./sound.js');
const glov_sprites = require('./sprites.js');
const { clipped, clipPause, clipResume } = glov_sprites;
const textures = require('./textures.js');
const { clamp, clone, defaults, lerp, merge } = require('glov/common/util.js');
const { mat43, m43identity, m43mul } = require('./mat43.js');
const { vec2, vec4, v4scale, unit_vec } = require('glov/common/vmath.js');

const MODAL_DARKEN = 0.75;
let KEYS;
let PAD;

const menu_fade_params_default = {
  blur: [0.125, 0.865],
  saturation: [0.5, 0.1],
  brightness: [1, 1 - MODAL_DARKEN],
  fallback_darken: vec4(0, 0, 0, MODAL_DARKEN),
  z: Z.MODAL,
};

export function focuslog(...args) {
  // console.log(`focuslog(${glov_engine.frame_index}): `, ...args);
}

let color_set_shades = vec4(1, 0.8, 0.7, 0.4);

const Z_MIN_INC = 1e-5;

export function makeColorSet(color) {
  let ret = {
    regular: vec4(),
    rollover: vec4(),
    down: vec4(),
    disabled: vec4(),
  };
  v4scale(ret.regular, color, color_set_shades[0]);
  v4scale(ret.rollover, color, color_set_shades[1]);
  v4scale(ret.down, color, color_set_shades[2]);
  v4scale(ret.disabled, color, color_set_shades[3]);
  for (let field in ret) {
    ret[field][3] = color[3];
  }
  return ret;
}

let hooks = [];
export function addHook(draw, click) {
  hooks.push({
    draw,
    click,
  });
}

let focus_parent_id = '';
export function focusIdSet(new_value) {
  focus_parent_id = new_value || '';
}

let ui_elem_data = {};
// Gets per-element state data that allows a paradigm of inter-frame state but
//   without the caller being required to allocate a state container.
export function getUIElemData(type, param, allocator) {
  let key = param.key || `${focus_parent_id}_${param.x}_${param.y}`;
  let by_type = ui_elem_data[key];
  if (!by_type) {
    by_type = ui_elem_data[key] = {};
  }
  let elem_data = by_type[key];
  if (!elem_data) {
    elem_data = by_type[key] = allocator ? allocator(param) : {};
  }
  elem_data.frame_index = glov_engine.frame_index;
  return elem_data;
}

function doBlurEffect(factor) {
  effects.applyGaussianBlur({
    blur: factor,
    // min_size: 128,
  });
}

let desaturate_xform = mat43();
let desaturate_tmp = mat43();
function doDesaturateEffect(saturation, brightness) {
  m43identity(desaturate_xform);

  effects.saturationMatrix(desaturate_tmp, saturation);
  m43mul(desaturate_xform, desaturate_xform, desaturate_tmp);

  effects.brightnessScaleMatrix(desaturate_tmp, brightness);
  m43mul(desaturate_xform, desaturate_xform, desaturate_tmp);

  // if ((hue % (Math.PI * 2)) !== 0) {
  //   effects.hueMatrix(tmp, hue);
  //   m43mul(xform, xform, tmp);
  // }
  // if (contrast !== 1) {
  //   effects.contrastMatrix(tmp, contrast);
  //   m43mul(xform, xform, tmp);
  // }
  // if (brightness !== 0) {
  //   effects.brightnessMatrix(tmp, brightness);
  //   m43mul(xform, xform, tmp);
  // }
  // if (additiveRGB[0] !== 0 || additiveRGB[1] !== 0 || additiveRGB[2] !== 0) {
  //   effects.additiveMatrix(tmp, additiveRGB);
  //   m43mul(xform, xform, tmp);
  // }
  // if (grayscale) {
  //   effects.grayScaleMatrix(tmp);
  //   m43mul(xform, xform, tmp);
  // }
  // if (negative) {
  //   effects.negativeMatrix(tmp);
  //   m43mul(xform, xform, tmp);
  // }
  // if (sepia) {
  //   effects.sepiaMatrix(tmp);
  //   m43mul(xform, xform, tmp);
  // }
  effects.applyColorMatrix({
    colorMatrix: desaturate_xform,
  });
}

// overrideable default parameters
export let button_height = 32;
export let font_height = 24;
export let button_width = 200;
export let modal_button_width = 100;
export let button_img_size = button_height;
export let modal_width = 600;
export let modal_y0 = 200;
export let modal_title_scale = 1.2;
export let modal_pad = 16;
export let panel_pixel_scale = 32 / 13; // button_height / button pixel resolution
export let tooltip_panel_pixel_scale = panel_pixel_scale;
export let tooltip_width = 400;
export let tooltip_pad = 8;

export let font_style_focused = glov_font.style(null, {
  color: 0x000000ff,
  outline_width: 2,
  outline_color: 0xFFFFFFff,
});
export let font_style_normal = glov_font.styleColored(null, 0x000000ff);

export let font;
export let title_font;
export let sprites = {};

export let color_button = makeColorSet([1,1,1,1]);
export let color_panel = vec4(1, 1, 0.75, 1);
export let modal_font_style = glov_font.styleColored(null, 0x000000ff);

let sounds = {};
export let button_mouseover = false; // for callers to poll the very last button
export let button_focused = false; // for callers to poll the very last button
export let button_click = null; // on click, for callers to poll which mouse button, etc
export let touch_changed_focus = false; // did a touch even this frame change focus?
// For tracking global mouseover state
let last_frame_button_mouseover = false;
let frame_button_mouseover = false;

let modal_dialog = null;
let modal_stealing_focus = false;
export let menu_up = false; // Boolean to be set by app to impact behavior, similar to a modal
let menu_fade_params = merge({}, menu_fade_params_default);
let menu_up_time = 0;

exports.this_frame_edit_boxes = [];
let last_frame_edit_boxes = [];
let dom_elems = [];
let dom_elems_issued = 0;

// for modal dialogs
let button_keys;

let focused_last_frame;
let focused_this_frame;
let focused_key_not;
let focused_key;
let focused_key_prev1;
let focused_key_prev2;

let pad_focus_left;
let pad_focus_right;

let default_line_mode;

// These can be of types string or LocalizableString
let buttons_default_labels = {
  ok: 'OK',
  cancel: 'Cancel',
  yes: 'Yes',
  no: 'No',
};
let default_copy_success_msg = 'Text copied to clipboard!';
let default_copy_failure_msg = 'Copy to clipboard FAILED, please copy from below.';

export function colorSetSetShades(rollover, down, disabled) {
  color_set_shades[1] = rollover;
  color_set_shades[2] = down;
  color_set_shades[3] = disabled;
  color_button = makeColorSet([1,1,1,1]);
}

export function loadUISprite(name, ws, hs, overrides, only_override) {
  let override = overrides && overrides[name];
  let wrap_s = gl.CLAMP_TO_EDGE;
  let wrap_t = (name === 'scrollbar_trough') ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  if (override === null) {
    // skip it, assume not used
  } else if (override) {
    sprites[name] = glov_sprites.create({
      name: override[0],
      ws: override[1],
      hs: override[2],
      layers: override[3],
      wrap_s,
      wrap_t,
    });
  } else if (!only_override) {
    sprites[name] = glov_sprites.create({
      name: `ui/${name}`,
      ws,
      hs,
      wrap_s,
      wrap_t,
    });
  }
}

export function setFonts(new_font, new_title_font) {
  font = new_font;
  title_font = new_title_font || font;
}

export function setButtonsDefaultLabels(buttons_labels) {
  for (const key in buttons_labels) {
    buttons_default_labels[key.toLowerCase()] = buttons_labels[key];
  }
}

export function setProvideUserStringDefaultMessages(success_msg, failure_msg) {
  default_copy_success_msg = success_msg;
  default_copy_failure_msg = failure_msg;
}

export function startup(param) {
  font = param.font;
  title_font = param.title_font || font;
  let overrides = param.ui_sprites;
  KEYS = glov_input.KEYS;
  PAD = glov_input.PAD;
  if (param.pad_focus_dpad) {
    pad_focus_left = PAD.LEFT;
    pad_focus_right = PAD.RIGHT;
  } else {
    pad_focus_left = PAD.LEFT_BUMPER;
    pad_focus_right = PAD.RIGHT_BUMPER;
  }

  loadUISprite('button', [4, 5, 4], [13], overrides);
  sprites.button_regular = sprites.button;
  loadUISprite('button_rollover', [4, 5, 4], [13], overrides, true);
  loadUISprite('button_down', [4, 5, 4], [13], overrides);
  loadUISprite('button_disabled', [4, 5, 4], [13], overrides);
  loadUISprite('panel', [3, 2, 3], [3, 10, 3], overrides);
  loadUISprite('menu_entry', [4, 5, 4], [13], overrides);
  loadUISprite('menu_selected', [4, 5, 4], [13], overrides);
  loadUISprite('menu_down', [4, 5, 4], [13], overrides);
  loadUISprite('menu_header', [4, 5, 12], [13], overrides);
  loadUISprite('slider', [6, 2, 6], [13], overrides);
  // loadUISprite('slider_notch', [3], [13], overrides);
  loadUISprite('slider_handle', [9], [13], overrides);

  loadUISprite('scrollbar_bottom', [11], [13], overrides);
  loadUISprite('scrollbar_trough', [11], [8], overrides);
  loadUISprite('scrollbar_top', [11], [13], overrides);
  loadUISprite('scrollbar_handle_grabber', [11], [13], overrides);
  loadUISprite('scrollbar_handle', [11], [3, 7, 3], overrides);
  loadUISprite('progress_bar', [3, 7, 3], [13], overrides);
  loadUISprite('progress_bar_trough', [3, 7, 3], [13], overrides);

  sprites.white = glov_sprites.create({ url: 'white' });

  button_keys = {
    ok: { key: [KEYS.O], pad: [PAD.X], low_key: [KEYS.ESC] },
    cancel: { key: [KEYS.ESC], pad: [PAD.B, PAD.Y] },
  };
  button_keys.yes = clone(button_keys.ok);
  button_keys.yes.key.push(KEYS.Y);
  button_keys.no = clone(button_keys.cancel);
  button_keys.no.key.push(KEYS.N);

  if (param.line_mode !== undefined) {
    default_line_mode = param.line_mode;
  } else {
    default_line_mode = LINE_ALIGN|LINE_CAP_ROUND;
    // let is_pixely = param.pixely && param.pixely !== 'off';
    // if (is_pixely) {
    //   // Maybe want to not do aligning here, causes inconsistencies when smoothly scrolling
    //   default_line_mode = 0;
    // }
  }
}

let dynamic_text_elem;
let per_frame_dom_alloc = [0,0,0,0,0,0,0];
let per_frame_dom_suppress = 0;
export function suppressNewDOMElemWarnings() {
  per_frame_dom_suppress = glov_engine.frame_index + 1;
}
export function getDOMElem(allow_modal, last_elem) {
  if (modal_dialog && !allow_modal) {
    return null;
  }
  if (dom_elems_issued >= dom_elems.length || !last_elem) {
    let elem = document.createElement('div');
    if (glov_engine.DEBUG && !glov_engine.resizing() && glov_engine.frame_index > per_frame_dom_suppress) {
      per_frame_dom_alloc[glov_engine.frame_index % per_frame_dom_alloc.length] = 1;
      let sum = 0;
      for (let ii = 0; ii < per_frame_dom_alloc.length; ++ii) {
        sum += per_frame_dom_alloc[ii];
      }
      assert(sum < per_frame_dom_alloc.length, 'Allocated new DOM elements for too many consecutive frames');
    }
    elem.setAttribute('class', 'glovui_dynamic');
    if (!dynamic_text_elem) {
      dynamic_text_elem = document.getElementById('dynamic_text');
    }
    dynamic_text_elem.appendChild(elem);
    dom_elems.push(elem);
    last_elem = elem;
  }
  if (dom_elems[dom_elems_issued] !== last_elem) {
    for (let ii = dom_elems_issued + 1; ii < dom_elems.length; ++ii) {
      if (dom_elems[ii] === last_elem) {
        dom_elems[ii] = dom_elems[dom_elems_issued];
        dom_elems[dom_elems_issued] = last_elem;
      }
    }
  }
  let elem = dom_elems[dom_elems_issued];
  dom_elems_issued++;
  return elem;
}

export function bindSounds(_sounds) {
  sounds = _sounds;
  for (let key in sounds) {
    soundLoad(sounds[key]);
  }
}

export function drawHBox(coords, s, color) {
  let uidata = s.uidata;
  let x = coords.x;
  let ws = [uidata.wh[0] * coords.h, 0, uidata.wh[2] * coords.h];
  if (coords.no_min_width && ws[0] + ws[2] > coords.w) {
    let scale = coords.w / (ws[0] + ws[2]);
    ws[0] *= scale;
    ws[2] *= scale;
  } else {
    ws[1] = max(0, coords.w - ws[0] - ws[2]);
  }
  for (let ii = 0; ii < ws.length; ++ii) {
    let my_w = ws[ii];
    if (my_w) {
      let draw_param = {
        x,
        y: coords.y,
        z: coords.z || Z.UI,
        color,
        w: my_w,
        h: coords.h,
        uvs: uidata.rects[ii],
        nozoom: true, // nozoom since different parts of the box get zoomed differently
      };
      if (coords.color1) {
        draw_param.color1 = coords.color1;
        s.drawDualTint(draw_param);
      } else {
        s.draw(draw_param);
      }
    }
    x += my_w;
  }
}

export function drawVBox(coords, s, color) {
  let uidata = s.uidata;
  let hs = [uidata.hw[0] * coords.w, 0, uidata.hw[2] * coords.w];
  let y = coords.y;
  hs[1] = max(0, coords.h - hs[0] - hs[2]);
  for (let ii = 0; ii < hs.length; ++ii) {
    let my_h = hs[ii];
    s.draw({
      x: coords.x,
      y,
      z: coords.z,
      color,
      w: coords.w,
      h: my_h,
      uvs: uidata.rects[ii],
      nozoom: true, // nozoom since different parts of the box get zoomed differently
    });
    y += my_h;
  }
}

export function drawBox(coords, s, pixel_scale, color) {
  let uidata = s.uidata;
  let scale = pixel_scale;
  let ws = [uidata.widths[0] * scale, 0, uidata.widths[2] * scale];
  ws[1] = max(0, coords.w - ws[0] - ws[2]);
  let hs = [uidata.heights[0] * scale, 0, uidata.heights[2] * scale];
  hs[1] = max(0, coords.h - hs[0] - hs[2]);
  let x = coords.x;
  for (let ii = 0; ii < ws.length; ++ii) {
    let my_w = ws[ii];
    if (my_w) {
      let y = coords.y;
      for (let jj = 0; jj < hs.length; ++jj) {
        let my_h = hs[jj];
        if (my_h) {
          s.draw({
            x, y, z: coords.z,
            color,
            w: my_w,
            h: my_h,
            uvs: uidata.rects[jj * 3 + ii],
            nozoom: true, // nozoom since different parts of the box get zoomed differently
          });
          y += my_h;
        }
      }
      x += my_w;
    }
  }
}

export function drawMultiPartBox(coords, scaleable_data, s, pixel_scale, color) {
  let uidata = s.uidata;
  let scale = pixel_scale;

  let ws = [];
  let fixed_w_sum = 0;
  let scaleable_sum = 0;
  for (let i = 0; i < uidata.widths.length; i++) {
    if (scaleable_data.widths[i] < 0) {
      ws.push(uidata.widths[i] * scale);
      fixed_w_sum += uidata.widths[i] * scale;
    } else {
      ws.push(0);
      scaleable_sum += scaleable_data.widths[i];
    }
  }
  assert(scaleable_sum === 1);
  for (let i = 0; i < uidata.widths.length; i++) {
    if (scaleable_data.widths[i] >= 0) {
      ws[i] = max(0, (coords.w - fixed_w_sum) * scaleable_data.widths[i]);
    }
  }

  scaleable_sum = 0;
  let hs = [];
  let fixed_h_sum = 0;
  for (let i = 0; i < uidata.heights.length; i++) {
    if (scaleable_data.heights[i] < 0) {
      hs.push(uidata.heights[i] * scale);
      fixed_h_sum += uidata.heights[i] * scale;
    } else {
      hs.push(0);
      scaleable_sum += scaleable_data.heights[i];
    }
  }
  assert(scaleable_sum === 1);
  for (let i = 0; i < uidata.heights.length; i++) {
    if (scaleable_data.heights[i] >= 0) {
      hs[i] = max(0, (coords.h - fixed_h_sum) * scaleable_data.heights[i]);
    }
  }
  let x = coords.x;
  for (let ii = 0; ii < ws.length; ++ii) {
    let my_w = ws[ii];
    if (my_w) {
      let y = coords.y;
      for (let jj = 0; jj < hs.length; ++jj) {
        let my_h = hs[jj];
        if (my_h) {
          s.draw({
            x, y, z: coords.z,
            color,
            w: my_w,
            h: my_h,
            uvs: uidata.rects[jj * ws.length + ii],
            nozoom: true, // nozoom since different parts of the box get zoomed differently
          });
          y += my_h;
        }
      }
      x += my_w;
    }
  }
}

export function playUISound(name, volume) {
  if (name === 'select') {
    name = 'button_click';
  }
  if (sounds[name]) {
    soundPlay(sounds[name], volume);
  }
}

export function setMouseOver(key, quiet) {
  if (last_frame_button_mouseover !== key && frame_button_mouseover !== key && !quiet && mouseMoved()) {
    playUISound('rollover');
  }
  frame_button_mouseover = key;
  button_mouseover = true;
  glov_input.mouseOverCaptured();
}

export function focusSteal(key) {
  if (key !== focused_key) {
    focuslog('focusSteal ', key);
  }
  focused_this_frame = true;
  focused_key = key;
}

export function focusCanvas() {
  focusSteal('canvas');
}

export function isFocusedPeek(key) {
  return focused_key === key;
}
export function isFocused(key) {
  if (key !== focused_key_prev2) {
    focused_key_prev1 = focused_key_prev2;
    focused_key_prev2 = key;
  }
  if (key === focused_key || key !== focused_key_not && !focused_this_frame &&
    !focused_last_frame
  ) {
    if (key !== focused_key) {
      focuslog('isFocused->focusSteal');
    }
    focusSteal(key);
    return true;
  }
  return false;
}

export function focusNext(key) {
  focuslog('focusNext ', key);
  playUISound('rollover');
  focused_key = null;
  focused_last_frame = focused_this_frame = false;
  focused_key_not = key;
  // Eat input events so a pair of keys (e.g. SDLK_DOWN and SDLK_CONTROLLER_DOWN)
  // don't get consumed by two separate widgets
  glov_input.eatAllInput(true);
}

export function focusPrev(key) {
  focuslog('focusPrev ', key);
  playUISound('rollover');
  if (key === focused_key_prev2) {
    focusSteal(focused_key_prev1);
  } else {
    focusSteal(focused_key_prev2);
  }
  glov_input.eatAllInput(true);
}

export function focusCheck(key) {
  if (modal_stealing_focus) {
    // hidden by modal, etc
    return false;
  }
  // Returns true even if focusing previous element, since for this frame, we are still effectively focused!
  let focused = isFocused(key);
  if (focused) {
    if (glov_input.keyDownEdge(KEYS.TAB)) {
      if (glov_input.keyDown(KEYS.SHIFT)) {
        focusPrev(key);
      } else {
        focusNext(key);
        focused = false;
      }
    }
    if (glov_input.padButtonDownEdge(pad_focus_right)) {
      focusNext(key);
      focused = false;
    }
    if (glov_input.padButtonDownEdge(pad_focus_left)) {
      focusPrev(key);
    }
  }
  return focused;
}

export function panel(param) {
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof param.w === 'number');
  assert(typeof param.h === 'number');
  param.z = param.z || (Z.UI - 1);
  param.eat_clicks = param.eat_clicks === undefined ? true : param.eat_clicks;
  let color = param.color || color_panel;
  drawBox(param, param.sprite || sprites.panel, param.pixel_scale || panel_pixel_scale, color);
  if (param.eat_clicks) {
    glov_input.click(param);
  }
  glov_input.mouseOver(param);
}

export function drawTooltip(param) {
  param.tooltip = getStringFromLocalizable(param.tooltip);

  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof param.tooltip === 'string');

  let clip_pause = clipped();
  if (clip_pause) {
    clipPause();
  }

  let tooltip_w = param.tooltip_width || tooltip_width;
  let z = param.z || Z.TOOLTIP;
  let tooltip_y0 = param.y;
  let eff_tooltip_pad = param.tooltip_pad || tooltip_pad;
  let w = tooltip_w - eff_tooltip_pad * 2;
  let dims = font.dims(modal_font_style, w, 0, font_height, param.tooltip);
  let above = param.tooltip_above;
  if (!above && param.tooltip_auto_above_offset) {
    above = tooltip_y0 + dims.h + eff_tooltip_pad * 2 > camera2d.y1();
  }
  let x = param.x;
  let eff_tooltip_w = dims.w + eff_tooltip_pad * 2;
  if (x + eff_tooltip_w > camera2d.x1()) {
    x = camera2d.x1() - eff_tooltip_w;
  }

  if (above) {
    tooltip_y0 -= dims.h + eff_tooltip_pad * 2 + (param.tooltip_auto_above_offset || 0);
  }
  let y = tooltip_y0 + eff_tooltip_pad;
  y += font.drawSizedWrapped(modal_font_style,
    x + eff_tooltip_pad, y, z+1, w, 0, font_height,
    param.tooltip);
  y += eff_tooltip_pad;
  let pixel_scale = param.pixel_scale || tooltip_panel_pixel_scale;

  panel({
    x,
    y: tooltip_y0,
    z,
    w: eff_tooltip_w,
    h: y - tooltip_y0,
    pixel_scale,
  });
  if (clip_pause) {
    clipResume();
  }
}

export function checkHooks(param, click) {
  if (param.hook) {
    for (let ii = 0; ii < hooks.length; ++ii) {
      if (click) {
        hooks[ii].click(param);
      }
      hooks[ii].draw(param);
    }
  }
}

export function drawTooltipBox(param) {
  drawTooltip({
    x: param.x,
    y: param.y + param.h + 2,
    tooltip_auto_above_offset: param.h + 4,
    tooltip_above: param.tooltip_above,
    tooltip: param.tooltip,
    tooltip_width: param.tooltip_width,
  });
}

export function progressBar(param) {
  drawHBox(param, sprites.progress_bar_trough, param.color_trough || param.color || unit_vec);
  let progress = clamp(param.progress, 0, 1);
  drawHBox({
    x: param.x + (param.centered ? param.w * (1-progress) * 0.5 : 0),
    y: param.y,
    z: (param.z || Z.UI) + Z_MIN_INC,
    w: param.w * progress,
    h: param.h,
    no_min_width: true,
  }, sprites.progress_bar, param.color || unit_vec);
  if (param.tooltip) {
    if (glov_input.mouseOver(param)) {
      drawTooltipBox(param);
    }
  }
}

export function buttonShared(param) {
  param.z = param.z || Z.UI;
  let state = 'regular';
  let ret = false;
  let key = param.key || `${focus_parent_id}_${param.x}_${param.y}`;
  let rollover_quiet = param.rollover_quiet;
  button_mouseover = false;
  if (param.draw_only) {
    if (param.draw_only_mouseover && (!param.disabled || param.disabled_mouseover)) {
      if (glov_input.mouseOver(param)) {
        setMouseOver(key, rollover_quiet);
      }
      if (button_mouseover && param.tooltip) {
        drawTooltipBox(param);
      }
    }
    return { ret, state };
  }
  let focused = !param.disabled && !param.no_focus && focusCheck(key);
  let key_opts = param.in_event_cb ? { in_event_cb: param.in_event_cb } : null;
  if (param.disabled) {
    if (glov_input.mouseOver(param)) { // Still eat mouse events
      if (param.disabled_mouseover) {
        setMouseOver(key, rollover_quiet);
      }
    }
    state = 'disabled';
  } else if (param.drag_target && (ret = glov_input.dragDrop(param))) {
    if (!glov_input.mousePosIsTouch()) {
      setMouseOver(key, rollover_quiet);
    }
    if (!param.no_focus) {
      focusSteal(key);
      focused = true;
    }
    button_click = { drag: true };
  } else if ((button_click = glov_input.click(param)) ||
    param.long_press && (button_click = glov_input.longPress(param))
  ) {
    if (param.touch_twice && !focused && glov_input.mousePosIsTouch()) {
      // Just focus, show tooltip
      touch_changed_focus = true;
      setMouseOver(key, rollover_quiet);
    } else {
      ret = true;
      if (last_frame_button_mouseover === key) {
        // preserve mouse over if we have it
        setMouseOver(key, rollover_quiet);
      }
    }
    if (!param.no_focus) {
      focusSteal(key);
      focused = true;
    }
  } else if (param.drag_target && glov_input.dragOver(param)) {
    // Mouseover even if touch?
    setMouseOver(key, rollover_quiet);
    state = glov_input.mouseDown() ? 'down' : 'rollover';
  } else if (param.drag_over && glov_input.dragOver(param)) {
    // do nothing
  } else if (glov_input.mouseOver(param)) {
    param.do_max_dist = true; // Need to apply the same max_dist logic to mouseDown() as we do for click()
    state = glov_input.mouseDown(param) ? 'down' : 'rollover';
    // On touch, only set mouseover if also down
    if (!glov_input.mousePosIsTouch() || state === 'down') {
      setMouseOver(key, rollover_quiet);
    }
  }
  button_focused = focused;
  if (focused) {
    if (glov_input.keyDownEdge(KEYS.SPACE, key_opts) || glov_input.keyDownEdge(KEYS.RETURN, key_opts) ||
      glov_input.padButtonDownEdge(PAD.A)
    ) {
      button_click = { kb: true };
      ret = true;
    }
  }
  if (ret) {
    state = 'down';
    playUISound(param.sound || 'button_click');
  }
  if (button_mouseover && param.tooltip) {
    drawTooltipBox(param);
  }
  param.z += param.z_bias && param.z_bias[state] || 0;
  checkHooks(param, ret);
  return { ret, state, focused };
}

export let button_last_color;
function buttonBackgroundDraw(param, state) {
  let colors = param.colors || color_button;
  let color = button_last_color = param.color || colors[state];
  if (!param.no_bg) {
    let base_name = param.base_name || 'button';
    let sprite_name = `${base_name}_${state}`;
    let sprite = sprites[sprite_name];
    // Note: was if (sprite) color = colors.regular for specific-sprite matches
    if (!sprite) {
      sprite = sprites[base_name];
    }

    drawHBox(param, sprite, color);
  }
}

export function buttonTextDraw(param, state, focused) {
  buttonBackgroundDraw(param, state);
  let hpad = min(param.font_height * 0.25, param.w * 0.1);
  font.drawSizedAligned(
    focused ? font_style_focused : font_style_normal,
    param.x + hpad, param.y, param.z + 0.1,
    param.font_height, param.align || glov_font.ALIGN.HVCENTERFIT, param.w - hpad * 2, param.h, param.text);
}

export function buttonText(param) {
  param.text = getStringFromLocalizable(param.text);

  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof param.text === 'string');
  // optional params
  // param.z = param.z || Z.UI;
  param.w = param.w || button_width;
  param.h = param.h || button_height;
  param.font_height = param.font_height || font_height;

  let { ret, state, focused } = buttonShared(param);
  buttonTextDraw(param, state, focused);
  return ret;
}

function buttonImageDraw(param, state, focused) {
  let uvs = param.img_rect;
  let img = param.imgs && param.imgs[state] || param.img;
  if (typeof param.frame === 'number') {
    uvs = img.uidata.rects[param.frame];
  }
  buttonBackgroundDraw(param, state);
  let color = button_last_color;
  let img_origin = img.origin;
  let img_w = img.size[0];
  let img_h = img.size[1];
  let aspect = img_w / img_h;
  if (typeof param.frame === 'number') {
    aspect = img.uidata.aspect ? img.uidata.aspect[param.frame] : 1;
  }
  let largest_w_horiz = param.w * param.shrink;
  let largest_w_vert = param.h * param.shrink * aspect;
  img_w = min(largest_w_horiz, largest_w_vert);
  img_h = img_w / aspect;
  let pad_top = (param.h - img_h) / 2;
  let draw_param = {
    x: param.x + (param.left_align ? pad_top : (param.w - img_w) / 2) + img_origin[0] * img_w,
    y: param.y + pad_top + img_origin[1] * img_h,
    z: param.z + Z_MIN_INC,
    // use img_color if provided, use explicit tint if doing dual-tinting, otherwise button color
    color: param.img_color || param.color1 && param.color || color,
    color1: param.color1,
    w: img_w / img.size[0],
    h: img_h / img.size[1],
    uvs,
    rot: param.rotation,
  };
  if (param.flip) {
    let { x, w } = draw_param;
    draw_param.x = x + w;
    draw_param.w = -w;
  }
  if (param.color1) {
    img.drawDualTint(draw_param);
  } else {
    img.draw(draw_param);
  }
}

export function buttonImage(param) {
  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.imgs || param.img && param.img.draw); // should be a sprite
  // optional params
  param.z = param.z || Z.UI;
  param.w = param.w || button_img_size;
  param.h = param.h || param.w || button_img_size;
  param.shrink = param.shrink || 0.75;
  //param.img_rect; null -> full image

  let { ret, state, focused } = buttonShared(param);
  buttonImageDraw(param, state, focused);
  return ret;
}

export function button(param) {
  if (param.img && !param.text) {
    return buttonImage(param);
  } else if (param.text && !param.img) {
    return buttonText(param);
  }

  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.img && param.img.draw); // should be a sprite
  // optional params
  param.z = param.z || Z.UI;
  // w/h initialize differently than either buttonText or buttonImage
  param.h = param.h || button_img_size;
  param.w = param.w || button_width;
  param.shrink = param.shrink || 0.75;
  //param.img_rect; null -> full image
  param.left_align = true; // always left-align images
  param.font_height = param.font_height || font_height;

  let { ret, state, focused } = buttonShared(param);
  buttonImageDraw(param, state, focused);
  // Hide some stuff on the second draw
  let saved_no_bg = param.no_bg;
  let saved_w = param.w;
  let saved_x = param.x;
  param.no_bg = true;
  param.x += param.h * param.shrink;
  param.w -= param.h * param.shrink;
  buttonTextDraw(param, state, focused);

  param.no_bg = saved_no_bg;
  param.w = saved_w;
  param.x = saved_x;
  return ret;
}

export function print(style, x, y, z, text) {
  return font.drawSized(style, x, y, z, font_height, text);
}

export function label(param) {
  let { style, x, y, align, w, h, text, tooltip } = param;
  text = getStringFromLocalizable(text);
  let use_font = param.font || font;
  let z = param.z || Z.UI;
  let size = param.size || font_height;
  assert(isFinite(x));
  assert(isFinite(y));
  assert.equal(typeof text, 'string');
  if (align) {
    use_font.drawSizedAligned(style, x, y, z, size, align, w, h, text);
  } else {
    use_font.drawSized(style, x, y, z, size, text);
  }
  if (tooltip) {
    assert(isFinite(w));
    assert(isFinite(h));
    if (glov_input.mouseOver(param)) {
      drawTooltipBox(param);
    }
  }
}

// Note: modal dialogs not really compatible with HTML overlay on top of the canvas!
export function modalDialog(param) {
  param.title = getStringFromLocalizable(param.title);
  param.text = `${getStringFromLocalizable(param.text) || ''}`;

  assert(!param.title || typeof param.title === 'string');
  assert(!param.text || typeof param.text === 'string');
  assert(!param.buttons || typeof param.buttons === 'object');
  if (param.buttons) {
    for (let key in param.buttons) {
      if (typeof param.buttons[key] !== 'object') {
        // Button is function or null
        param.buttons[key] = { cb: param.buttons[key] };
      }
    }
  }
  // assert(Object.keys(param.buttons).length);
  modal_dialog = param;
}

export function modalDialogClear() {
  modal_dialog = null;
}

let dom_requirement = vec2(24,24);
let virtual_size = vec2();
function modalDialogRun() {
  camera2d.domDeltaToVirtual(virtual_size, dom_requirement);
  let fullscreen_mode = false;
  let eff_font_height = modal_dialog.font_height || font_height;
  let eff_button_height = button_height;
  let pad = modal_pad;
  let vpad = modal_pad * 0.5;
  let general_scale = 1;
  let exit_lock = true;
  if (virtual_size[0] > 0.1 * camera2d.h() && camera2d.w() > camera2d.h() * 2) {
    // If a 24-pt font is more than 10% of the camera height, we're probably super-wide-screen
    // on a mobile device due to keyboard being visible
    fullscreen_mode = true;
    eff_button_height = eff_font_height;
    vpad = pad = 4;

    let old_h = camera2d.h();
    camera2d.push();
    camera2d.setAspectFixed2(1, eff_font_height * (modal_title_scale + 2) + pad * 4.5);
    general_scale = camera2d.h() / old_h;
  }

  let { buttons, click_anywhere } = modal_dialog;
  let keys = Object.keys(buttons || {});

  const game_width = camera2d.x1() - camera2d.x0();
  const eff_modal_width = fullscreen_mode ? game_width : (modal_dialog.width || modal_width);
  let eff_button_width = modal_dialog.button_width || modal_button_width;
  let max_total_button_width = eff_modal_width * 2 / 3;
  eff_button_width = min(eff_button_width, max_total_button_width / keys.length);
  const text_w = eff_modal_width - pad * 2;
  const x0 = camera2d.x0() + round((game_width - eff_modal_width) / 2);
  let x = x0 + pad;
  const y0 = fullscreen_mode ? 0 : (modal_dialog.y0 || modal_y0);
  let y = round(y0 + pad);

  if (modal_dialog.title) {
    if (fullscreen_mode) {
      title_font.drawSizedAligned(modal_font_style, x, y, Z.MODAL, eff_font_height * modal_title_scale,
        glov_font.ALIGN.HFIT, text_w, 0, modal_dialog.title);
      y += eff_font_height * modal_title_scale;
    } else {
      y += title_font.drawSizedWrapped(modal_font_style,
        x, y, Z.MODAL, text_w, 0, eff_font_height * modal_title_scale,
        modal_dialog.title);
    }
    y = round(y + vpad * 1.5);
  }

  if (modal_dialog.text) {
    if (fullscreen_mode) {
      font.drawSizedAligned(modal_font_style, x, y, Z.MODAL, eff_font_height,
        glov_font.ALIGN.HFIT, text_w, 0, modal_dialog.text);
      y += eff_font_height;
    } else {
      y += font.drawSizedWrapped(modal_font_style, x, y, Z.MODAL, text_w, 0, eff_font_height,
        modal_dialog.text);
    }
    y = round(y + vpad);
  }

  let tick_key;
  if (modal_dialog.tick) {
    let avail_width = eff_modal_width - pad * 2;
    if (fullscreen_mode) {
      avail_width -= (pad + eff_button_width) * keys.length;
    }
    let param = {
      x, y,
      modal_width: eff_modal_width,
      avail_width,
      font_height: eff_font_height,
      fullscreen_mode,
    };
    tick_key = modal_dialog.tick(param);
    y = param.y;
  }

  x = x0 + eff_modal_width - (pad + eff_button_width) * keys.length;
  let did_button = -1;
  for (let ii = 0; ii < keys.length; ++ii) {
    let key = keys[ii];
    let key_lower = key.toLowerCase();
    let cur_button = buttons[key] = buttons[key] || {};
    let eff_button_keys = button_keys[key_lower];
    let pressed = 0;
    if (eff_button_keys) {
      for (let jj = 0; jj < eff_button_keys.key.length; ++jj) {
        pressed += glov_input.keyDownEdge(eff_button_keys.key[jj], cur_button.in_event_cb);
        if (eff_button_keys.key[jj] === tick_key) {
          pressed++;
        }
      }
      for (let jj = 0; jj < eff_button_keys.pad.length; ++jj) {
        pressed += glov_input.padButtonDownEdge(eff_button_keys.pad[jj]);
      }
    }
    if (click_anywhere && ii === 0 && glov_input.click()) {
      ++pressed;
    }
    if (pressed) {
      did_button = ii;
    }
    let but_label = cur_button.label || buttons_default_labels[key_lower] || key;
    if (buttonText(defaults({
      x, y, z: Z.MODAL,
      w: eff_button_width,
      h: eff_button_height,
      text: but_label,
    }, cur_button))) {
      did_button = ii;
    }
    x = round(x + pad + eff_button_width);
  }
  // Also check low-priority keys
  if (did_button === -1) {
    for (let ii = 0; ii < keys.length; ++ii) {
      let key = keys[ii];
      let eff_button_keys = button_keys[key.toLowerCase()];
      if (eff_button_keys && eff_button_keys.low_key) {
        for (let jj = 0; jj < eff_button_keys.low_key.length; ++jj) {
          if (glov_input.keyDownEdge(eff_button_keys.low_key[jj], buttons[key].in_event_cb) ||
          eff_button_keys.low_key[jj] === tick_key) {
            did_button = ii;
          }
        }
      }
    }
  }
  if (did_button !== -1) {
    let key = keys[did_button];
    playUISound('button_click');
    modal_dialog = null;
    if (buttons[key].cb) {
      buttons[key].cb();
    }
    exit_lock = false;
  }
  y += eff_button_height;
  y = round(y + vpad + pad);
  panel({
    x: x0,
    y: y0,
    z: Z.MODAL - 1,
    w: eff_modal_width,
    h: (fullscreen_mode ? camera2d.y1() : y) - y0,
    pixel_scale: panel_pixel_scale * general_scale,
  });

  if (glov_input.pointerLocked() && exit_lock) {
    glov_input.pointerLockExit();
  }

  glov_input.eatAllInput();
  modal_stealing_focus = true;
  if (fullscreen_mode) {
    camera2d.pop();
  }
}

export function modalTextEntry(param) {
  let eb = glov_edit_box.create({
    allow_modal: true,
    initial_focus: true,
    spellcheck: false,
    initial_select: true,
    text: param.edit_text,
    max_len: param.max_len,
    esc_clears: false,
  });
  let buttons = {};
  for (let key in param.buttons) {
    let cb = param.buttons[key];
    if ((cb !== null) && (typeof cb === 'object') && ('cb' in cb)) {
      cb = param.buttons[key].cb;
    }
    if (typeof cb === 'function') {
      cb = (function (old_fn) {
        return function () {
          old_fn(eb.getText());
        };
      }(cb));
    }
    buttons[key] = defaults({ cb }, param.buttons[key]);
  }
  param.buttons = buttons;
  param.text = `${param.text || ''}`;
  let old_tick = param.tick;
  param.tick = function (params) {
    let eb_ret = eb.run({
      x: params.x,
      y: params.y,
      w: params.avail_width || param.edit_w,
      font_height: params.font_height,
    });
    if (!params.fullscreen_mode) {
      params.y += params.font_height + modal_pad;
    }
    let ret;
    if (eb_ret === eb.SUBMIT) {
      ret = KEYS.O; // Do OK, Yes
    } else if (eb_ret === eb.CANCEL) {
      ret = KEYS.ESC; // Do Cancel, No
    }
    if (old_tick) {
      ret = old_tick(params) || ret;
    }
    return ret;
  };
  modalDialog(param);
}


export function createEditBox(param) {
  return glov_edit_box.create(param);
}

let slider_default_vshrink = 1.0;
let slider_default_handle_shrink = 1.0;
export function setSliderDefaultShrink(vshrink, handle_shrink) {
  slider_default_vshrink = vshrink;
  slider_default_handle_shrink = handle_shrink;
}
const color_slider_handle = vec4(1,1,1,1);
const color_slider_handle_grab = vec4(0.5,0.5,0.5,1);
const color_slider_handle_over = vec4(0.75,0.75,0.75,1);
export let slider_dragging = false; // for caller polling
export let slider_rollover = false; // for caller polling
// Returns new value
export function slider(value, param) {
  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.min < param.max); // also must be numbers
  // optional params
  param.z = param.z || Z.UI;
  param.w = param.w || button_width;
  param.h = param.h || button_height;
  param.max_dist = param.max_dist || Infinity;
  let vshrink = param.vshrink || slider_default_vshrink;
  let handle_shrink = param.handle_shrink || slider_default_handle_shrink;
  let disabled = param.disabled || false;
  let handle_h = param.h * handle_shrink;
  let handle_w = sprites.slider_handle.uidata.wh[0] * handle_h;

  slider_dragging = false;

  let shrinkdiff = handle_shrink - vshrink;
  drawHBox({
    x: param.x + param.h * shrinkdiff/2,
    y: param.y + param.h * (1 - vshrink)/2,
    z: param.z,
    w: param.w - param.h * shrinkdiff,
    h: param.h * vshrink,
  }, sprites.slider, param.color);

  let xoffs = round(max(sprites.slider.uidata.wh[0] * param.h * vshrink, handle_w) / 2);
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
  let drag = !disabled && glov_input.drag(param);
  let grabbed = Boolean(drag);
  let click = glov_input.click(param);
  if (click) {
    grabbed = false;
    // update pos
    value = (click.pos[0] - (param.x + xoffs)) / draggable_width;
    value = param.min + (param.max - param.min) * clamp(value, 0, 1);
    playUISound('button_click');
  } else if (grabbed) {
    // update pos
    value = (drag.cur_pos[0] - (param.x + xoffs)) / draggable_width;
    value = param.min + (param.max - param.min) * clamp(value, 0, 1);
    // Eat all mouseovers while dragging
    glov_input.mouseOver();
    slider_dragging = true;
  }
  let rollover = !disabled && glov_input.mouseOver(param);
  slider_rollover = rollover;
  let handle_center_pos = param.x + xoffs + draggable_width * (value - param.min) / (param.max - param.min);
  let handle_x = handle_center_pos - handle_w / 2;
  let handle_y = param.y + param.h / 2 - handle_h / 2;
  let handle_color = color_slider_handle;
  if (grabbed) {
    handle_color = color_slider_handle_grab;
  } else if (rollover) {
    handle_color = color_slider_handle_over;
  }

  sprites.slider_handle.draw({
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

let pp_bad_frames = 0;

export function isMenuUp() {
  return modal_dialog || menu_up;
}

function releaseOldUIElemData() {
  for (let type in ui_elem_data) {
    let by_type = ui_elem_data[type];
    let any = false;
    for (let key in by_type) {
      let elem_data = by_type[key];
      if (elem_data.frame_index < glov_engine.frame_index - 1) {
        delete by_type[key];
      } else {
        any = true;
      }
    }
    if (!any) {
      delete ui_elem_data[type];
    }
  }
}

export function tickUI(dt) {
  last_frame_button_mouseover = frame_button_mouseover;
  frame_button_mouseover = false;
  focused_last_frame = focused_this_frame;
  focused_this_frame = false;
  focused_key_not = null;
  modal_stealing_focus = false;
  touch_changed_focus = false;
  per_frame_dom_alloc[glov_engine.frame_index % per_frame_dom_alloc.length] = 0;
  releaseOldUIElemData();

  last_frame_edit_boxes = exports.this_frame_edit_boxes;
  exports.this_frame_edit_boxes = [];
  linkTick();

  dom_elems_issued = 0;

  let pp_this_frame = false;
  if (modal_dialog || menu_up) {
    let params = menu_fade_params;
    if (!menu_up) {
      // Modals get defaults
      params = menu_fade_params_default;
    }
    menu_up_time += dt;
    // Effects during modal dialogs
    let factor = min(menu_up_time / 500, 1);
    if (glov_engine.postprocessing && !glov_engine.defines.NOPP) {
      // Note: this lerp used to be done later in the frame (during drawing, not queueing) a problem?
      let blur_factor = lerp(factor, params.blur[0], params.blur[1]);
      if (blur_factor) {
        effectsQueue(params.z - 2, doBlurEffect.bind(null, blur_factor));
      }
      let saturation = lerp(factor, params.saturation[0], params.saturation[1]);
      let brightness = lerp(factor, params.brightness[0], params.brightness[1]);
      if (saturation !== 1 || brightness !== 1) {
        effectsQueue(params.z - 1, doDesaturateEffect.bind(null, saturation, brightness));
      }
      pp_this_frame = true;
    } else {
      // Or, just darken
      sprites.white.draw({
        x: camera2d.x0Real(),
        y: camera2d.y0Real(),
        z: params.z - 2,
        color: params.fallback_darken,
        w: camera2d.wReal(),
        h: camera2d.hReal(),
      });
    }
  } else {
    menu_up_time = 0;
  }
  menu_up = false;

  if (!glov_engine.is_loading && glov_engine.getFrameDtActual() > 50 && pp_this_frame) {
    pp_bad_frames = (pp_bad_frames || 0) + 1;
    if (pp_bad_frames >= 6) { // 6 in a row, disable superfluous postprocessing
      glov_engine.postprocessingAllow(false);
    }
  } else if (pp_bad_frames) {
    pp_bad_frames = 0;
  }


  if (modal_dialog) {
    modalDialogRun();
  }
}

export function endFrame() {
  if (glov_input.click({
    x: -Infinity, y: -Infinity,
    w: Infinity, h: Infinity,
  })) {
    focusSteal('canvas');
  }

  for (let ii = 0; ii < last_frame_edit_boxes.length; ++ii) {
    let edit_box = last_frame_edit_boxes[ii];
    let idx = exports.this_frame_edit_boxes.indexOf(edit_box);
    if (idx === -1) {
      edit_box.unrun();
    }
  }

  while (dom_elems_issued < dom_elems.length) {
    let elem = dom_elems.pop();
    dynamic_text_elem.removeChild(elem);
  }
}

export function cleanupDOMElems() {
  while (dom_elems.length) {
    let elem = dom_elems.pop();
    dynamic_text_elem.removeChild(elem);
  }
}

export function menuUp(param) {
  merge(menu_fade_params, menu_fade_params_default);
  if (param) {
    merge(menu_fade_params, param);
  }
  menu_up = true;
  modal_stealing_focus = true;
  glov_input.eatAllInput();
}

function copyTextToClipboard(text) {
  let textArea = document.createElement('textarea');
  textArea.style.position = 'fixed';
  textArea.style.top = 0;
  textArea.style.left = 0;
  textArea.style.width = '2em';
  textArea.style.height = '2em';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';
  textArea.value = text;

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let ret = false;
  try {
    ret = document.execCommand('copy');
  } catch (err) {
    // do nothing
  }

  document.body.removeChild(textArea);
  return ret;
}

export function provideUserString(title, str, success_msg, failure_msg) {
  let copy_success = copyTextToClipboard(str);
  modalTextEntry({
    edit_w: 400,
    edit_text: str,
    title,
    text: copy_success ?
      (success_msg || default_copy_success_msg) :
      (failure_msg || default_copy_failure_msg),
    buttons: { ok: null },
  });
}

export function drawRect(x0, y0, x1, y1, z, color) {
  let mx = min(x0, x1);
  let my = min(y0, y1);
  let Mx = max(x0, x1);
  let My = max(y0, y1);
  sprites.white.draw({
    x: mx,
    y: my,
    z,
    color,
    w: Mx - mx,
    h: My - my,
  });
}

export function drawRect2(param) {
  drawRect(param.x, param.y, param.x + param.w, param.y + param.h, param.z, param.color);
}

function spreadTechParams(spread) {
  // spread=0 -> 1
  // spread=0.5 -> 2
  // spread=0.75 -> 4
  // spread=1 -> large enough to AA
  spread = min(max(spread, 0), 0.99);

  let tech_params = {
    param0: vec4(0,0,0,0),
  };

  tech_params.param0[0] = 1 / (1 - spread);
  tech_params.param0[1] = -0.5 * tech_params.param0[0] + 0.5;
  return tech_params;
}

function drawElipseInternal(sprite, x0, y0, x1, y1, z, spread, tu0, tv0, tu1, tv1, color, blend) {
  glov_sprites.queueraw(sprite.texs,
    x0, y0, z, x1 - x0, y1 - y0,
    tu0, tv0, tu1, tv1,
    color, glov_font.font_shaders.font_aa, spreadTechParams(spread), blend);
}

function drawCircleInternal(sprite, x, y, z, r, spread, tu0, tv0, tu1, tv1, color, blend) {
  let x0 = x - r * 2 + r * 4 * tu0;
  let x1 = x - r * 2 + r * 4 * tu1;
  let y0 = y - r * 2 + r * 4 * tv0;
  let y1 = y - r * 2 + r * 4 * tv1;
  drawElipseInternal(sprite, x0, y0, x1, y1, z, spread, tu0, tv0, tu1, tv1, color, blend);
}

function initCircleSprite() {
  const CIRCLE_SIZE = 32;
  let data = new Uint8Array(CIRCLE_SIZE*CIRCLE_SIZE);
  let midp = (CIRCLE_SIZE - 1) / 2;
  for (let i = 0; i < CIRCLE_SIZE; i++) {
    for (let j = 0; j < CIRCLE_SIZE; j++) {
      let d = sqrt((i - midp)*(i - midp) + (j - midp)*(j - midp)) / midp;
      let v = clamp(1 - d, 0, 1);
      data[i + j*CIRCLE_SIZE] = v * 255;
    }
  }
  sprites.circle = glov_sprites.create({
    url: 'circle',
    width: CIRCLE_SIZE, height: CIRCLE_SIZE,
    format: textures.format.R8,
    data,
    filter_min: gl.LINEAR,
    filter_mag: gl.LINEAR,
    wrap_s: gl.CLAMP_TO_EDGE,
    wrap_t: gl.CLAMP_TO_EDGE,
    origin: vec2(0.5, 0.5),
  });
}

export function drawElipse(x0, y0, x1, y1, z, spread, color, blend) {
  if (!sprites.circle) {
    initCircleSprite();
  }
  drawElipseInternal(sprites.circle, x0, y0, x1, y1, z, spread, 0, 0, 1, 1, color, blend);
}

export function drawCircle(x, y, z, r, spread, color, blend) {
  if (!sprites.circle) {
    initCircleSprite();
  }
  drawCircleInternal(sprites.circle, x, y, z, r, spread, 0, 0, 1, 1, color, blend);
}

export function drawHollowCircle(x, y, z, r, spread, color, blend) {
  if (!sprites.hollow_circle) {
    const CIRCLE_SIZE = 128;
    const LINE_W = 2;
    let data = new Uint8Array(CIRCLE_SIZE*CIRCLE_SIZE);
    let midp = (CIRCLE_SIZE - 1) / 2;
    for (let i = 0; i < CIRCLE_SIZE; i++) {
      for (let j = 0; j < CIRCLE_SIZE; j++) {
        let d = sqrt((i - midp)*(i - midp) + (j - midp)*(j - midp)) / midp;
        let v = clamp(1 - d, 0, 1);
        if (v > 0.5) {
          v = 1 - v;
        }
        v += (LINE_W / CIRCLE_SIZE);
        data[i + j*CIRCLE_SIZE] = v * 255;
      }
    }
    sprites.hollow_circle = glov_sprites.create({
      url: 'hollow_circle',
      width: CIRCLE_SIZE, height: CIRCLE_SIZE,
      format: textures.format.R8,
      data,
      filter_min: gl.LINEAR,
      filter_mag: gl.LINEAR,
      wrap_s: gl.CLAMP_TO_EDGE,
      wrap_t: gl.CLAMP_TO_EDGE,
      origin: vec2(0.5, 0.5),
    });
  }
  drawCircleInternal(sprites.hollow_circle, x, y, z, r, spread, 0, 0, 1, 1, color, blend);
}


const LINE_TEX_W=16;
const LINE_TEX_H=16; // Only using 15, so we can have a value of 255 in the middle
const LINE_MIDP = floor((LINE_TEX_H - 1) / 2);
const LINE_V0 = 0.5/LINE_TEX_H;
const LINE_V1 = 1-1.5/LINE_TEX_H;
const LINE_U0 = 0.5/LINE_TEX_W;
const LINE_U1 = (LINE_MIDP + 0.5) / LINE_TEX_W;
const LINE_U2 = 1 - LINE_U1; // 1 texel away from LINE_U1
const LINE_U3 = 1 - 0.5/LINE_TEX_W;
export function drawLine(x0, y0, x1, y1, z, w, precise, color, mode) {
  if (mode === undefined) {
    mode = default_line_mode;
  }
  let tex_key = mode & LINE_CAP_ROUND ? 'line3' : 'line2';
  if (!sprites[tex_key]) {
    let data = new Uint8Array(LINE_TEX_W * LINE_TEX_H);
    let i1 = LINE_MIDP;
    let i2 = LINE_TEX_W - 1 - LINE_MIDP;
    if (tex_key === 'line2') {
      // rectangular caps
      for (let j = 0; j < LINE_TEX_H; j++) {
        let d = abs((j - LINE_MIDP) / LINE_MIDP);
        let j_value = round(clamp(1 - d, 0, 1) * 255);
        for (let i = 0; i < LINE_TEX_W; i++) {
          d = i < i1 ? i/LINE_MIDP : i >= i2 ? 1 - (i-i2) / LINE_MIDP : 1;
          let i_value = round(clamp(d, 0, 1) * 255);
          data[i + j*LINE_TEX_W] = min(i_value, j_value);
        }
      }
    } else {
      // round caps
      for (let j = 0; j < LINE_TEX_H; j++) {
        let d = abs((j - LINE_MIDP) / LINE_MIDP);
        for (let i = 0; i < LINE_TEX_W; i++) {
          let id = i < i1 ? 1-i/LINE_MIDP : i >= i2 ? (i-i2) / LINE_MIDP : 0;
          let dv = sqrt(id*id + d*d);
          dv = clamp(1-dv, 0, 1);
          data[i + j*LINE_TEX_W] = round(dv * 255);
        }
      }
    }
    sprites[tex_key] = glov_sprites.create({
      url: tex_key,
      width: LINE_TEX_W, height: LINE_TEX_H,
      format: textures.format.R8,
      data,
      filter_min: gl.LINEAR,
      filter_mag: gl.LINEAR,
      wrap_s: gl.CLAMP_TO_EDGE,
      wrap_t: gl.CLAMP_TO_EDGE,
    });
  }
  let texs = sprites[tex_key].texs;

  const camera_xscale = camera2d.data[4];
  const camera_yscale = camera2d.data[5];
  let virtual_to_pixels = (camera_xscale + camera_yscale) * 0.5;
  let pixels_to_virutal = 1/virtual_to_pixels;
  let w_in_pixels = w * virtual_to_pixels;
  let draw_w_pixels = w_in_pixels + 2*2;
  let half_draw_w_pixels = draw_w_pixels * 0.5;
  let draw_w = half_draw_w_pixels * pixels_to_virutal;
  // let tex_delta_for_pixel = 1 / draw_w_pixels; // should be 51/255 for width=1 (draw_w_pixels = 5)

  let dx = x1 - x0;
  let dy = y1 - y0;
  let length = sqrt(dx*dx + dy*dy);
  dx /= length;
  dy /= length;
  let tangx = -dy * draw_w;
  let tangy = dx * draw_w;

  if (mode & LINE_ALIGN) {
    // align drawing so that the edge of the line is aligned with a pixel edge
    //   (avoids a 0.1,1.0,0.1 line drawing in favor of 1.0,0.2, which will be crisper, if slightly visually offset)
    let y0_real = (y0 - camera2d.data[1]) * camera2d.data[5];
    let y0_real_aligned = round(y0_real - half_draw_w_pixels) + half_draw_w_pixels;
    let yoffs = (y0_real_aligned - y0_real) / camera2d.data[5];
    y0 += yoffs;
    y1 += yoffs;

    let x0_real = (x0 - camera2d.data[0]) * camera2d.data[4];
    let x0_real_aligned = round(x0_real - half_draw_w_pixels) + half_draw_w_pixels;
    let xoffs = (x0_real_aligned - x0_real) / camera2d.data[4];
    x0 += xoffs;
    x1 += xoffs;
  }

  let tex_delta_for_pixel = 2/draw_w_pixels;
  let step_start = 1 - (w_in_pixels + 1) / draw_w_pixels;
  let step_end = step_start + tex_delta_for_pixel;
  step_end = 1 + precise * (step_end - 1);
  let A = 1.0 / (step_end - step_start);
  let B = -step_start * A;
  let shader_param = { param0: [A, B] };

  glov_sprites.queueraw4(texs,
    x1 + tangx, y1 + tangy,
    x1 - tangx, y1 - tangy,
    x0 - tangx, y0 - tangy,
    x0 + tangx, y0 + tangy,
    z,
    LINE_U1, LINE_V0, LINE_U2, LINE_V1,
    color, glov_font.font_shaders.font_aa, shader_param);

  if (mode & (LINE_CAP_ROUND|LINE_CAP_SQUARE)) {
    // round caps (line3) - square caps (line2)
    let nx = dx * w/2;
    let ny = dy * w/2;
    glov_sprites.queueraw4(texs,
      x1 - tangx, y1 - tangy,
      x1 + tangx, y1 + tangy,
      x1 + tangx + nx, y1 + tangy + ny,
      x1 - tangx + nx, y1 - tangy + ny,
      z,
      LINE_U2, LINE_V1, LINE_U3, LINE_V0,
      color, glov_font.font_shaders.font_aa, shader_param);
    glov_sprites.queueraw4(texs,
      x0 - tangx, y0 - tangy,
      x0 + tangx, y0 + tangy,
      x0 + tangx - nx, y0 + tangy - ny,
      x0 - tangx - nx, y0 - tangy - ny,
      z,
      LINE_U1, LINE_V1, LINE_U0, LINE_V0,
      color, glov_font.font_shaders.font_aa, shader_param);
  }
}

export function drawHollowRect(x0, y0, x1, y1, z, w, precise, color, mode) {
  drawLine(x0, y0, x1, y0, z, w, precise, color, mode);
  drawLine(x1, y0, x1, y1, z, w, precise, color, mode);
  drawLine(x1, y1, x0, y1, z, w, precise, color, mode);
  drawLine(x0, y1, x0, y0, z, w, precise, color, mode);
}

export function drawHollowRect2(param) {
  drawHollowRect(param.x, param.y, param.x + param.w, param.y + param.h,
    param.z || Z.UI, param.line_width || 1, param.precise || 1, param.color || unit_vec);
}

export function drawCone(x0, y0, x1, y1, z, w0, w1, spread, color) {
  if (!sprites.cone) {
    const CONE_SIZE = 32;
    let data = new Uint8Array(CONE_SIZE*CONE_SIZE);
    let midp = (CONE_SIZE - 1) / 2;
    for (let i = 0; i < CONE_SIZE; i++) {
      for (let j = 0; j < CONE_SIZE; j++) {
        let dx = 0;
        let dy = 0;
        let d = 0;
        if (i > midp) {
          dx = (i - midp) / midp;
          dy = abs(j - midp) / midp;
          let dCircle = sqrt(dx*dx + dy*dy);
          d = dx * dCircle;
        }
        let v = clamp(1 - d, 0, 1);
        data[i + j*CONE_SIZE] = v * 255;
      }
    }
    sprites.cone = glov_sprites.create({
      url: 'cone',
      width: CONE_SIZE, height: CONE_SIZE,
      format: textures.format.R8,
      data,
      filter_min: gl.LINEAR,
      filter_mag: gl.LINEAR,
      wrap_s: gl.CLAMP_TO_EDGE,
      wrap_t: gl.CLAMP_TO_EDGE,
      origin: vec2(0.5, 0.5),
    });
  }
  let dx = x1 - x0;
  let dy = y1 - y0;
  let length = sqrt(dx*dx + dy*dy);
  dx /= length;
  dy /= length;
  let tangx = -dy;
  let tangy = dx;
  glov_sprites.queueraw4(sprites.cone.texs,
    x0 - tangx*w0, y0 - tangy*w0,
    x0 + tangx*w0, y0 + tangy*w0,
    x1 + tangx*w1, y1 + tangy*w1,
    x1 - tangx*w1, y1 - tangy*w1,
    z,
    0, 0, 1, 1,
    color, glov_font.font_shaders.font_aa, spreadTechParams(spread));
}

export function setFontHeight(_font_height) {
  font_height = _font_height;
  glov_font.setDefaultSize(font_height);
}

export function scaleSizes(scale) {
  button_height = round(32 * scale);
  setFontHeight(round(24 * scale));
  button_width = round(200 * scale);
  button_img_size = button_height;
  modal_button_width = round(button_width / 2);
  modal_width = round(600 * scale);
  modal_y0 = round(200 * scale);
  modal_title_scale = 1.2;
  modal_pad = round(16 * scale);
  tooltip_width = round(400 * scale);
  tooltip_pad = round(8 * scale);
  panel_pixel_scale = button_height / 13; // button_height / panel pixel resolution
  tooltip_panel_pixel_scale = panel_pixel_scale;
}

export function setPanelPixelScale(scale) {
  tooltip_panel_pixel_scale = panel_pixel_scale = scale;
}

export function setModalSizes(_modal_button_width, width, y0, title_scale, pad) {
  modal_button_width = _modal_button_width || round(button_width / 2);
  modal_width = width || 600;
  modal_y0 = y0 || 200;
  modal_title_scale = title_scale || 1.2;
  modal_pad = pad || modal_pad;
}

export function setTooltipWidth(_tooltip_width, _tooltip_panel_pixel_scale) {
  tooltip_width = _tooltip_width;
  tooltip_panel_pixel_scale = _tooltip_panel_pixel_scale;
  tooltip_pad = modal_pad / 2 * _tooltip_panel_pixel_scale;
}

scaleSizes(1);
