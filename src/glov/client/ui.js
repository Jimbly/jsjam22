// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-underscore-dangle:off */

window.Z = window.Z || {};
export const Z = window.Z;

export const Z_MIN_INC = 1e-5;

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

export const internal = {
  checkHooks, // eslint-disable-line @typescript-eslint/no-use-before-define
  cleanupDOMElems, // eslint-disable-line @typescript-eslint/no-use-before-define
  uiEndFrame, // eslint-disable-line @typescript-eslint/no-use-before-define
  uiSetFonts, // eslint-disable-line @typescript-eslint/no-use-before-define
  uiStartup, // eslint-disable-line @typescript-eslint/no-use-before-define
  uiTick, // eslint-disable-line @typescript-eslint/no-use-before-define
  uiApplyStyle, // eslint-disable-line @typescript-eslint/no-use-before-define
};

/* eslint-disable import/order */
const assert = require('assert');
const camera2d = require('./camera2d.js');
const { editBoxCreate, editBoxTick } = require('./edit_box.js');
const effects = require('./effects.js');
const { effectsQueue } = effects;
const glov_engine = require('./engine.js');
const glov_font = require('./font.js');
const { ALIGN, fontSetDefaultSize, fontStyle, fontStyleColored } = glov_font;
const glov_input = require('./input.js');
const { linkTick } = require('./link.js');
const { getStringFromLocalizable } = require('./localization.js');
const { abs, floor, max, min, round, sqrt } = Math;
const { scrollAreaSetPixelScale } = require('./scroll_area.js');
const { sliderSetDefaultShrink } = require('./slider.js');
const { soundLoad, soundPlay } = require('./sound.js');
const {
  SPOT_DEFAULT_BUTTON,
  SPOT_DEFAULT_BUTTON_DRAW_ONLY,
  SPOT_DEFAULT_LABEL,
  SPOT_STATE_REGULAR,
  SPOT_STATE_DOWN,
  SPOT_STATE_FOCUSED,
  SPOT_STATE_DISABLED,
  spot,
  spotEndOfFrame,
  spotKey,
  spotPadMode,
  spotPadSuppressed,
  spotTopOfFrame,
  spotUnfocus,
} = require('./spot.js');
const glov_sprites = require('./sprites.js');
const {
  BLEND_PREMULALPHA,
  spriteClipped,
  spriteClipPause,
  spriteClipResume,
  spriteChainedStart,
  spriteChainedStop,
  spriteCreate,
} = glov_sprites;
const { TEXTURE_FORMAT } = require('./textures.js');
const {
  uiStyleDefault,
  uiStyleModify,
  uiStyleTopOfFrame,
} = require('./uistyle.js');
const { clamp, clone, defaults, deprecate, lerp, merge } = require('glov/common/util.js');
const { mat43, m43identity, m43mul } = require('./mat43.js');
const { vec2, vec4, v4copy, v3scale, unit_vec } = require('glov/common/vmath.js');

deprecate(exports, 'slider_dragging', 'slider.js:sliderIsDragging()');
deprecate(exports, 'slider_rollover', 'slider.js:sliderIsFocused()');
deprecate(exports, 'setSliderDefaultShrink', 'slider.js:sliderSetDefaultShrink()');
deprecate(exports, 'slider', 'slider.js:slider()');
deprecate(exports, 'bindSounds', 'uiBindSounds');
deprecate(exports, 'modal_font_style', 'uiFontStyleModal()');
deprecate(exports, 'font_style_noraml', 'uiFontStyleNoraml()');
deprecate(exports, 'font_style_focused', 'uiFontStyleFocused()');
deprecate(exports, 'color_button', 'uiSetButtonColorSet()');


const MODAL_DARKEN = 0.75;
let KEYS;
let PAD;

let ui_style_current;

const menu_fade_params_default = {
  blur: [0.125, 0.865],
  saturation: [0.5, 0.1],
  brightness: [1, 1 - MODAL_DARKEN],
  fallback_darken: vec4(0, 0, 0, MODAL_DARKEN),
  z: Z.MODAL,
};

let color_set_shades = vec4(1, 1, 1, 1);

let color_sets = [];
function applyColorSet(color_set) {
  v3scale(color_set.regular, color_set.color, color_set_shades[0]);
  v3scale(color_set.rollover, color_set.color, color_set_shades[1]);
  v3scale(color_set.down, color_set.color, color_set_shades[2]);
  v3scale(color_set.disabled, color_set.color, color_set_shades[3]);
}
export function makeColorSet(color) {
  let ret = {
    color,
    regular: vec4(),
    rollover: vec4(),
    down: vec4(),
    disabled: vec4(),
  };
  for (let field in ret) {
    ret[field][3] = color[3];
  }
  color_sets.push(ret);
  applyColorSet(ret);
  return ret;
}

export function colorSetMakeCustom(regular, rollover, down, disabled) {
  return {
    regular,
    rollover,
    down,
    disabled,
  };
}

let hooks = [];
export function addHook(draw, click) {
  hooks.push({
    draw,
    click,
  });
}

let ui_elem_data = {};
// Gets per-element state data that allows a paradigm of inter-frame state but
//   without the caller being required to allocate a state container.
export function getUIElemData(type, param, allocator) {
  let key = spotKey(param);
  let by_type = ui_elem_data[type];
  if (!by_type) {
    by_type = ui_elem_data[type] = {};
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

// DEPRECATED: use uiStyleCurrent().foo instead
// exports.font_height;
// export let button_height = 32;
// export let button_width = 200;

// overrideable default parameters
export let modal_button_width = 100;
export let modal_width = 600;
export let modal_y0 = 200;
export let modal_title_scale = 1.2;
export let modal_pad = 16;
export let panel_pixel_scale = 32 / 13; // button_height / button pixel resolution
export let tooltip_panel_pixel_scale = panel_pixel_scale;
export let tooltip_width = 400;
export let tooltip_pad = 8;

// export let font_style_focused = fontStyle(null, {
//   color: 0x000000ff,
//   outline_width: 2,
//   outline_color: 0xFFFFFFff,
// });
let font_style_normal;
let font_style_focused;
let font_style_disabled;
let font_style_modal;

export function setFontStyles(normal, focused, modal, disabled) {
  font_style_normal = normal || fontStyleColored(null, 0x000000ff);
  font_style_focused = focused || fontStyle(font_style_normal, {});
  font_style_modal = modal || fontStyle(font_style_normal, {});
  font_style_disabled = disabled || fontStyleColored(font_style_normal, 0x222222ff);
}
setFontStyles();

export function uiFontStyleNormal() {
  return font_style_normal;
}
export function uiFontStyleFocused() {
  return font_style_focused;
}
export function uiFontStyleDisabled() {
  return font_style_modal;
}
export function uiFontStyleModal() {
  return font_style_modal;
}

export function uiTextHeight() {
  return ui_style_current.text_height;
}
export function uiButtonHeight() {
  return ui_style_current.button_height;
}
export function uiButtonWidth() {
  return ui_style_current.button_width;
}

export let font;
export let title_font;

export function uiGetFont() {
  return font;
}
export function uiGetTitleFont() {
  return title_font;
}

export const sprites = {};

let color_button = makeColorSet([1,1,1,1]);
export function uiSetButtonColorSet(color_button_in) {
  color_button = color_button_in;
}
export function uiGetButtonRolloverColor() {
  return color_button.rollover;
}
export const color_panel = vec4(1, 1, 0.75, 1);


let sounds = {};
export let button_mouseover = false; // for callers to poll the very last button
export let button_focused = false; // for callers to poll the very last button
export let button_click = null; // on click, for callers to poll which mouse button, etc

export function buttonWasFocused() {
  return button_focused;
}

let modal_dialog = null;
export let menu_up = false; // Boolean to be set by app to impact behavior, similar to a modal
let menu_fade_params = merge({}, menu_fade_params_default);
let menu_up_time = 0;

let dom_elems = [];
let dom_elems_issued = 0;

// for modal dialogs
let button_keys;

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
  for (let ii = 0; ii < color_sets.length; ++ii) {
    applyColorSet(color_sets[ii]);
  }
}

export function uiGetFontStyleFocused() {
  return font_style_focused;
}

export function uiSetFontStyleFocused(new_style) {
  font_style_focused = new_style;
}

export function uiSetPanelColor(color) {
  v4copy(color_panel, color);
}

export function loadUISprite(name, ws, hs) {
  let wrap_s = gl.CLAMP_TO_EDGE;
  let wrap_t = gl.CLAMP_TO_EDGE;
  sprites[name] = spriteCreate({
    name: `ui/${name}`,
    ws,
    hs,
    wrap_s,
    wrap_t,
  });
}

export function loadUISprite2(name, param) {
  if (param === null) {
    // skip it, assume not used
    return;
  }
  let wrap_s = gl.CLAMP_TO_EDGE;
  let wrap_t = param.wrap_t ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  let sprite_param = {
    ws: param.ws,
    hs: param.hs,
    wrap_s,
    wrap_t,
    layers: param.layers,
  };
  if (param.url) {
    sprite_param.url = param.url;
  } else {
    sprite_param.name = `ui/${param.name || name}`;
  }
  sprites[name] = spriteCreate(sprite_param);
}

function uiSetFonts(new_font, new_title_font) {
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

const base_ui_sprites = {
  color_set_shades: [1, 1, 1],

  white: { url: 'white' },

  button: { ws: [8, 112, 8], hs: [128] },
  button_rollover: { ws: [8, 112, 8], hs: [128] },
  button_down: { ws: [8, 112, 8], hs: [128] },
  button_disabled: { ws: [8, 112, 8], hs: [128] },
  panel: { ws: [32, 64, 32], hs: [32, 64, 32] },

  menu_entry: { ws: [8, 112, 8], hs: [128] },
  menu_selected: { ws: [8, 112, 8], hs: [128] },
  menu_down: { ws: [8, 112, 8], hs: [128] },
  menu_header: { ws: [8, 112, 136], hs: [128] },
  slider: { ws: [56, 16, 56], hs: [128] },
  // slider_notch: { ws: [3], hs: [13] },
  slider_handle: { ws: [64], hs: [128] },

  scrollbar_bottom: { ws: [64], hs: [64] },
  scrollbar_trough: { ws: [64], hs: [8], wrap_t: true },
  scrollbar_top: { ws: [64], hs: [64] },
  scrollbar_handle_grabber: { ws: [64], hs: [64] },
  scrollbar_handle: { ws: [64], hs: [24, 16, 24] },
  progress_bar: { ws: [48, 32, 48], hs: [128] },
  progress_bar_trough: { ws: [48, 32, 48], hs: [128] },

  collapsagories: { ws: [4, 8, 4], hs: [64] },
  collapsagories_rollover: { ws: [4, 8, 4], hs: [64] },
  collapsagories_shadow_down: { ws: [4, 8, 4], hs: [64] },
  collapsagories_shadow_up: null,
};

function uiStartup(param) {
  font = param.font;
  title_font = param.title_font || font;
  KEYS = glov_input.KEYS;
  PAD = glov_input.PAD;

  let ui_sprites = {
    ...base_ui_sprites,
    ...param.ui_sprites,
  };

  for (let key in ui_sprites) {
    let elem = ui_sprites[key];
    if (typeof elem === 'object' && !Array.isArray(elem)) {
      loadUISprite2(key, elem);
    }
  }
  sprites.button_regular = sprites.button;

  if (ui_sprites.color_set_shades) {
    colorSetSetShades(...ui_sprites.color_set_shades);
  }
  if (ui_sprites.slider_params) {
    sliderSetDefaultShrink(...ui_sprites.slider_params);
  }

  if (sprites.button_rollover && color_set_shades[1] !== 1) {
    colorSetSetShades(1, color_set_shades[2], color_set_shades[3]);
  }
  if (sprites.button_down && color_set_shades[2] !== 1) {
    colorSetSetShades(color_set_shades[1], 1, color_set_shades[3]);
  }
  if (sprites.button_disabled && color_set_shades[3] !== 1) {
    colorSetSetShades(color_set_shades[1], color_set_shades[2], 1);
  }

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

  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  scaleSizes(1);
}

let dynamic_text_elem;
let per_frame_dom_alloc = [0,0,0,0,0,0,0];
let per_frame_dom_suppress = 0;
export function suppressNewDOMElemWarnings() {
  per_frame_dom_suppress = glov_engine.frame_index + 1;
}
export function uiGetDOMElem(last_elem, allow_modal) {
  if (modal_dialog && !allow_modal) {
    // Note: this case is no longer needed for edit boxes (spot's focus logic
    //   handles this), but links still rely on this
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
let dom_tab_index = 0;
export function uiGetDOMTabIndex() {
  return ++dom_tab_index;
}

const base_ui_sounds = {
  button_click: 'button_click',
  rollover: 'rollover',
};

export function uiBindSounds(_sounds) {
  sounds = defaults(_sounds || {}, base_ui_sounds);
  for (let key in sounds) {
    if (sounds[key]) {
      soundLoad(sounds[key]);
    }
  }
}

let draw_box_param = {
  nozoom: true, // nozoom since different parts of the box get zoomed differently
};
export function drawHBox(coords, s, color) {
  spriteChainedStart();
  let uidata = s.uidata;
  let x = coords.x;
  let ws = [uidata.wh[0] * coords.h, 0, (uidata.wh[2] || 0) * coords.h];
  if (coords.no_min_width && ws[0] + ws[2] > coords.w) {
    let scale = coords.w / (ws[0] + ws[2]);
    ws[0] *= scale;
    ws[2] *= scale;
  } else {
    ws[1] = max(0, coords.w - ws[0] - ws[2]);
  }
  draw_box_param.y = coords.y;
  draw_box_param.z = coords.z;
  draw_box_param.h = coords.h;
  draw_box_param.color = color;
  draw_box_param.color1 = coords.color1;
  draw_box_param.shader = null; // gets overridden in drawDualTint
  for (let ii = 0; ii < ws.length; ++ii) {
    let my_w = ws[ii];
    if (my_w) {
      draw_box_param.x = x;
      draw_box_param.w = my_w;
      draw_box_param.uvs = uidata.rects[ii];
      if (coords.color1) {
        s.drawDualTint(draw_box_param);
      } else {
        s.draw(draw_box_param);
      }
    }
    x += my_w;
  }
  spriteChainedStop();
}

export function drawVBox(coords, s, color) {
  spriteChainedStart();
  let uidata = s.uidata;
  let hs = [uidata.hw[0] * coords.w, 0, (uidata.hw[2] || 0) * coords.w];
  let y = coords.y;
  hs[1] = max(0, coords.h - hs[0] - hs[2]);
  draw_box_param.x = coords.x;
  draw_box_param.z = coords.z;
  draw_box_param.w = coords.w;
  draw_box_param.color = color;
  draw_box_param.shader = null;
  for (let ii = 0; ii < hs.length; ++ii) {
    let my_h = hs[ii];
    draw_box_param.y = y;
    draw_box_param.h = my_h;
    draw_box_param.uvs = uidata.rects[ii];
    s.draw(draw_box_param);
    y += my_h;
  }
  spriteChainedStop();
}

export function drawBox(coords, s, pixel_scale, color, color1) {
  spriteChainedStart();
  let uidata = s.uidata;
  let scale = pixel_scale;
  let ws = [uidata.widths[0] * scale, 0, uidata.widths[2] * scale];
  ws[1] = max(0, coords.w - ws[0] - ws[2]);
  let hs = [uidata.heights[0] * scale, 0, uidata.heights[2] * scale];
  hs[1] = max(0, coords.h - hs[0] - hs[2]);
  let x = coords.x;
  draw_box_param.z = coords.z;
  draw_box_param.color = color;
  draw_box_param.shader = null;
  if (color1) {
    draw_box_param.color1 = color1;
  }
  for (let ii = 0; ii < ws.length; ++ii) {
    let my_w = ws[ii];
    if (my_w) {
      draw_box_param.x = x;
      draw_box_param.w = my_w;
      let y = coords.y;
      for (let jj = 0; jj < hs.length; ++jj) {
        let my_h = hs[jj];
        if (my_h) {
          draw_box_param.y = y;
          draw_box_param.h = my_h;
          draw_box_param.uvs = uidata.rects[jj * 3 + ii];
          if (color1) {
            s.drawDualTint(draw_box_param);
          } else {
            s.draw(draw_box_param);
          }
          y += my_h;
        }
      }
      x += my_w;
    }
  }
  spriteChainedStop();
}

export function drawMultiPartBox(coords, scaleable_data, s, pixel_scale, color) {
  spriteChainedStart();
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
  spriteChainedStop();
}

export function playUISound(name, volume) {
  profilerStartFunc();
  if (name === 'select') {
    name = 'button_click';
  }
  if (sounds[name]) {
    soundPlay(sounds[name], volume);
  }
  profilerStopFunc();
}

export function focusCanvas() {
  spotUnfocus();
}

// Returns true if the navigation inputs (arrows, etc) should go to the UI, not the app
export function uiHandlingNav() {
  return menu_up || !spotPadSuppressed();
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
    glov_input.mouseOver(param);
  }
}

export function drawTooltip(param) {
  let { tooltip } = param;
  if (typeof tooltip === 'function') {
    tooltip = tooltip(param);
    if (!tooltip) {
      return;
    }
  }
  tooltip = getStringFromLocalizable(tooltip);

  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof tooltip === 'string');

  let clip_pause = spriteClipped();
  if (clip_pause) {
    spriteClipPause();
  }

  let tooltip_w = param.tooltip_width || tooltip_width;
  let z = param.z || Z.TOOLTIP;
  let tooltip_y0 = param.y;
  let eff_tooltip_pad = param.tooltip_pad || tooltip_pad;
  let w = tooltip_w - eff_tooltip_pad * 2;
  let dims = font.dims(font_style_modal, w, 0, ui_style_current.text_height, tooltip);
  let above = param.tooltip_above;
  let right = param.tooltip_right;
  if (!above && param.tooltip_auto_above_offset) {
    above = tooltip_y0 + dims.h + eff_tooltip_pad * 2 > camera2d.y1();
  }
  let x = param.x;
  let eff_tooltip_w = dims.w + eff_tooltip_pad * 2;
  if (right && param.tooltip_auto_right_offset) {
    x += param.tooltip_auto_right_offset - eff_tooltip_w;
  }
  if (x + eff_tooltip_w > camera2d.x1()) {
    x = camera2d.x1() - eff_tooltip_w;
  }

  if (above) {
    tooltip_y0 -= dims.h + eff_tooltip_pad * 2 + (param.tooltip_auto_above_offset || 0);
  }
  let y = tooltip_y0 + eff_tooltip_pad;
  y += font.drawSizedWrapped(font_style_modal,
    x + eff_tooltip_pad, y, z+1, w, 0, ui_style_current.text_height,
    tooltip);
  y += eff_tooltip_pad;
  let pixel_scale = param.pixel_scale || tooltip_panel_pixel_scale;

  panel({
    x,
    y: tooltip_y0,
    z,
    w: eff_tooltip_w,
    h: y - tooltip_y0,
    pixel_scale,
    eat_clicks: false,
  });
  if (clip_pause) {
    spriteClipResume();
  }
}

function checkHooks(param, click) {
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
  let { tooltip } = param;
  if (typeof tooltip === 'function') {
    tooltip = tooltip(param);
    if (!tooltip) {
      return;
    }
  }
  drawTooltip({
    x: param.x,
    y: param.y + param.h + 2,
    tooltip_auto_above_offset: param.h + 4,
    tooltip_above: param.tooltip_above,
    tooltip_auto_right_offset: param.w,
    tooltip_right: param.tooltip_right,
    tooltip,
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
    spot({
      x: param.x, y: param.y,
      w: param.w, h: param.h,
      tooltip: param.tooltip,
      def: SPOT_DEFAULT_LABEL,
    });
  }
}

// TODO: refactor so callers all use the new states 'focused'
const SPOT_STATE_TO_UI_BUTTON_STATE = {
  [SPOT_STATE_REGULAR]: 'regular',
  [SPOT_STATE_DOWN]: 'down',
  [SPOT_STATE_FOCUSED]: 'rollover',
  [SPOT_STATE_DISABLED]: 'disabled',
};

const UISPOT_BUTTON_DISABLED = {
  ...SPOT_DEFAULT_BUTTON,
  disabled: true,
  disabled_focusable: false,
  sound_rollover: null,
};


export function buttonShared(param) {
  profilerStartFunc();
  param.z = param.z || Z.UI;
  if (param.rollover_quiet) {
    param.sound_rollover = null;
  }
  let spot_ret;
  if (param.draw_only && !param.draw_only_mouseover) {
    // no spot() needed
    spot_ret = { ret: false, state: 'regular', focused: false };
  } else {
    if (param.draw_only) {
      assert(!param.def || param.def === SPOT_DEFAULT_BUTTON_DRAW_ONLY);
      param.def = SPOT_DEFAULT_BUTTON_DRAW_ONLY;
    } else if (param.disabled && !param.disabled_focusable) {
      param.def = param.def || UISPOT_BUTTON_DISABLED;
    } else {
      param.def = param.def || SPOT_DEFAULT_BUTTON;
    }
    if (param.sound) {
      param.sound_button = param.sound;
    }
    spot_ret = spot(param);
    spot_ret.state = SPOT_STATE_TO_UI_BUTTON_STATE[spot_ret.spot_state];
    if (spot_ret.ret) {
      // TODO: refactor callers to gather this from spot_ret, passes as return from button()/etc
      button_click = spot_ret;
      button_click.was_double_click = spot_ret.double_click;
    }
  }

  button_focused = button_mouseover = spot_ret.focused;
  param.z += param.z_bias && param.z_bias[spot_ret.state] || 0;
  profilerStopFunc();
  return spot_ret;
}

export let button_last_color;
export function buttonBackgroundDraw(param, state) {
  profilerStartFunc();
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
  profilerStopFunc();
}

export function buttonSpotBackgroundDraw(param, spot_state) {
  profilerStartFunc();
  let state = SPOT_STATE_TO_UI_BUTTON_STATE[spot_state];
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
  profilerStopFunc();
}

export function buttonTextDraw(param, state, focused) {
  profilerStartFunc();
  buttonBackgroundDraw(param, state);
  let hpad = min(param.font_height * 0.25, param.w * 0.1);
  let disabled = state === 'disabled';
  (param.font || font).drawSizedAligned(
    disabled ? param.font_style_disabled || font_style_disabled :
    focused ? param.font_style_focused || font_style_focused :
    param.font_style_normal || font_style_normal,
    param.x + hpad, param.y, param.z + 0.1,
    param.font_height, param.align || glov_font.ALIGN.HVCENTERFIT, param.w - hpad * 2, param.h, param.text);
  profilerStopFunc();
}

export function buttonText(param) {
  profilerStartFunc();
  param.text = getStringFromLocalizable(param.text);

  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof param.text === 'string');
  // optional params
  // param.z = param.z || Z.UI;
  param.w = param.w || ui_style_current.button_width;
  param.h = param.h || ui_style_current.button_height;
  param.font_height = param.font_height || (param.style || ui_style_current).text_height;

  let spot_ret = buttonShared(param);
  let { ret, state, focused } = spot_ret;
  buttonTextDraw(param, state, focused);
  profilerStopFunc();
  return ret ? spot_ret : null;
}

function buttonImageDraw(param, state, focused) {
  profilerStartFunc();
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
    z: param.z + (param.z_inc || Z_MIN_INC),
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
  profilerStopFunc();
}

export function buttonImage(param) {
  profilerStartFunc();
  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.imgs || param.img && param.img.draw); // should be a sprite
  // optional params
  param.z = param.z || Z.UI;
  param.w = param.w || ui_style_current.button_height;
  param.h = param.h || param.w || ui_style_current.button_height;
  param.shrink = param.shrink || 0.75;
  //param.img_rect; null -> full image

  let spot_ret = buttonShared(param);
  let { ret, state, focused } = spot_ret;
  buttonImageDraw(param, state, focused);
  profilerStopFunc();
  return ret ? spot_ret : null;
}

export function button(param) {
  if (param.img && !param.text) {
    return buttonImage(param);
  } else if (param.text && !param.img) {
    return buttonText(param);
  }
  profilerStartFunc();

  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.img && param.img.draw); // should be a sprite
  // optional params
  param.z = param.z || Z.UI;
  // w/h initialize differently than either buttonText or buttonImage
  param.h = param.h || ui_style_current.button_height;
  param.w = param.w || ui_style_current.button_width;
  param.shrink = param.shrink || 0.75;
  //param.img_rect; null -> full image
  param.left_align = true; // always left-align images
  param.font_height = param.font_height || (param.style || ui_style_current).text_height;

  let spot_ret = buttonShared(param);
  let { ret, state, focused } = spot_ret;
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
  profilerStopFunc();
  return ret ? spot_ret : null;
}

export function print(font_style, x, y, z, text) {
  return font.drawSized(font_style, x, y, z, ui_style_current.text_height, text);
}

export function label(param) {
  profilerStartFunc();
  let {
    font_style,
    font_style_focused: label_font_style_focused,
    x, y,
    align,
    w, h,
    text,
    tooltip,
    tooltip_above,
    tooltip_right,
  } = param;
  if (param.style) {
    assert(!param.style.color); // Received a FontStyle, expecting a UIStyle
  }
  text = getStringFromLocalizable(text);
  let use_font = param.font || font;
  let z = param.z || Z.UI;
  let style = param.style || ui_style_current;
  let size = param.size || style.text_height;
  assert(isFinite(x));
  assert(isFinite(y));
  assert.equal(typeof text, 'string');
  if (tooltip) {
    if (!w) {
      w = use_font.getStringWidth(font_style, size, text);
      if (align & ALIGN.HRIGHT) {
        x -= w;
      } else if (align & ALIGN.HCENTER) {
        x -= w/2;
      }
    }
    if (!h) {
      h = size;
      if (align & ALIGN.VBOTTOM) {
        y -= h;
      } else if (align & ALIGN.VCENTER) {
        y -= h/2;
      }
    }
    assert(isFinite(w));
    assert(isFinite(h));
    let spot_ret = spot({
      x, y, w, h,
      tooltip: tooltip,
      tooltip_width: param.tooltip_width,
      tooltip_above,
      tooltip_right,
      def: SPOT_DEFAULT_LABEL,
    });
    if (spot_ret.focused && spotPadMode()) {
      if (label_font_style_focused) {
        font_style = label_font_style_focused;
      } else {
        // No focused style provided, do a generic glow instead?
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        drawElipse(x - w*0.25, y-h*0.25, x + w*1.25, y + h*1.25, z - 0.001, 0.5, unit_vec);
      }
    }
  }
  let text_w = 0;
  if (text) {
    if (align) {
      text_w = use_font.drawSizedAligned(font_style, x, y, z, size, align, w, h, text);
    } else {
      text_w = use_font.drawSized(font_style, x, y, z, size, text);
    }
  }
  profilerStopFunc();
  return w || text_w;
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
  let eff_font_height = modal_dialog.font_height || (modal_dialog.style || ui_style_current).text_height;
  let eff_button_height = ui_style_current.button_height;
  let pad = modal_pad;
  let vpad = modal_pad * 0.5;
  let general_scale = 1;
  let exit_lock = true;
  let num_lines;
  if (!modal_dialog.no_fullscreen_zoom && virtual_size[0] > 0.05 * camera2d.h() && camera2d.w() > camera2d.h() * 2) {
    // If a 24-pt font is more than 5% of the camera height, we're probably super-wide-screen
    // on a mobile device due to keyboard being visible
    fullscreen_mode = true;
    eff_button_height = eff_font_height;
    vpad = pad = 4;

    let old_h = camera2d.h();
    camera2d.push();
    // Find a number of lines (and implicit scaling) such they all fit
    for (num_lines = 1; ; num_lines++) {
      camera2d.setAspectFixed2(1, eff_font_height * (modal_title_scale + 1 + num_lines) + pad * 4.5);
      general_scale = camera2d.h() / old_h;
      if (!modal_dialog.text) {
        break;
      }
      const game_width = camera2d.x1() - camera2d.x0();
      const text_w = game_width - pad * 2;
      let wrapped_numlines = font.numLines(font_style_modal, text_w, 0, eff_font_height, modal_dialog.text);
      if (wrapped_numlines <= num_lines) {
        break;
      }
    }
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
      title_font.drawSizedAligned(font_style_modal, x, y, Z.MODAL, eff_font_height * modal_title_scale,
        glov_font.ALIGN.HFIT, text_w, 0, modal_dialog.title);
      y += eff_font_height * modal_title_scale;
    } else {
      y += title_font.drawSizedWrapped(font_style_modal,
        x, y, Z.MODAL, text_w, 0, eff_font_height * modal_title_scale,
        modal_dialog.title);
    }
    y = round(y + vpad * 1.5);
  }

  if (modal_dialog.text || fullscreen_mode) {
    if (fullscreen_mode) {
      if (modal_dialog.text) {
        font.drawSizedAligned(font_style_modal, x, y, Z.MODAL, eff_font_height,
          glov_font.ALIGN.HWRAP, text_w, 0, modal_dialog.text);
      }
      y += eff_font_height * num_lines;
    } else {
      y += font.drawSizedWrapped(font_style_modal, x, y, Z.MODAL, text_w, 0, eff_font_height,
        modal_dialog.text);
    }
    y = round(y + vpad);
  }

  let panel_color = modal_dialog.color || null; // tick might clear modalDialog

  let tick_key;
  if (modal_dialog.tick) {
    let avail_width = eff_modal_width - pad * 2;
    if (fullscreen_mode) {
      avail_width -= (pad + eff_button_width) * keys.length;
    }
    let param = {
      x0, y0, x, y,
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
        pressed += glov_input.keyUpEdge(eff_button_keys.key[jj], cur_button.in_event_cb);
        if (eff_button_keys.key[jj] === tick_key) {
          pressed++;
        }
      }
      for (let jj = 0; jj < eff_button_keys.pad.length; ++jj) {
        pressed += glov_input.padButtonUpEdge(eff_button_keys.pad[jj]);
      }
    }
    if (click_anywhere && ii === 0 && glov_input.click()) {
      ++pressed;
    }
    if (pressed) {
      did_button = ii;
    }
    let but_label = cur_button.label || buttons_default_labels[key_lower] || key;
    if (button(defaults({
      key: `md_${key}`,
      x, y, z: Z.MODAL,
      w: eff_button_width,
      h: eff_button_height,
      text: but_label,
      auto_focus: ii === 0,
      focus_steal: keys.length === 1 && !modal_dialog.tick,
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
          if (glov_input.keyUpEdge(eff_button_keys.low_key[jj], buttons[key].in_event_cb) ||
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
  if (keys.length > 0) {
    y += eff_button_height;
  }
  y = round(y + vpad + pad);
  panel({
    x: x0,
    y: y0,
    z: Z.MODAL - 1,
    w: eff_modal_width,
    h: (fullscreen_mode ? camera2d.y1() : y) - y0,
    pixel_scale: panel_pixel_scale * general_scale,
    color: panel_color,
  });

  if (glov_input.pointerLocked() && exit_lock) {
    glov_input.pointerLockExit();
  }

  glov_input.eatAllInput();
  if (fullscreen_mode) {
    camera2d.pop();
  }
}

export function modalTextEntry(param) {
  let eb = editBoxCreate({
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
  return editBoxCreate(param);
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

function uiTick(dt) {
  per_frame_dom_alloc[glov_engine.frame_index % per_frame_dom_alloc.length] = 0;
  releaseOldUIElemData();

  editBoxTick();
  linkTick();

  dom_elems_issued = 0;
  dom_tab_index = 0;

  let pp_this_frame = false;
  if (modal_dialog || menu_up) {
    let params = menu_fade_params;
    if (!menu_up) {
      // Modals get defaults
      params = menu_fade_params_default;
    }
    menu_up_time += dt;
    // Effects during modal dialogs
    if (glov_engine.postprocessing && !glov_engine.defines.NOPP) {
      let factor = min(menu_up_time / 500, 1);
      if (factor < 1) {
        glov_engine.renderNeeded();
      }
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

  spotTopOfFrame();
  uiStyleTopOfFrame();

  if (modal_dialog) {
    modalDialogRun();
  }
}

function uiEndFrame() {
  spotEndOfFrame();

  if (glov_input.click({
    x: -Infinity, y: -Infinity,
    w: Infinity, h: Infinity,
  })) {
    spotUnfocus();
  }

  while (dom_elems_issued < dom_elems.length) {
    let elem = dom_elems.pop();
    dynamic_text_elem.removeChild(elem);
  }
}

function cleanupDOMElems() {
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
  glov_input.eatAllInput();
}

export function copyTextToClipboard(text) {
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

export function provideUserString(title, str) {
  let copy_success = copyTextToClipboard(str);
  modalTextEntry({
    edit_w: 400,
    edit_text: str.replace(/[\n\r]/g, ' '),
    title,
    text: copy_success ?
      default_copy_success_msg :
      default_copy_failure_msg,
    buttons: { ok: null },
  });
}

const draw_rect_param = {};
export function drawRect(x0, y0, x1, y1, z, color) {
  let mx = min(x0, x1);
  let my = min(y0, y1);
  let Mx = max(x0, x1);
  let My = max(y0, y1);
  draw_rect_param.x = mx;
  draw_rect_param.y = my;
  draw_rect_param.z = z;
  draw_rect_param.w = Mx - mx;
  draw_rect_param.h = My - my;
  draw_rect_param.color = color;
  return sprites.white.draw(draw_rect_param);
}

export function drawRect2(param) {
  return sprites.white.draw(param);
}

const draw_rect_4color_param = {};
export function drawRect4Color(x0, y0, x1, y1, z, color_ul, color_ur, color_ll, color_lr) {
  let mx = min(x0, x1);
  let my = min(y0, y1);
  let Mx = max(x0, x1);
  let My = max(y0, y1);
  draw_rect_4color_param.x = mx;
  draw_rect_4color_param.y = my;
  draw_rect_4color_param.z = z;
  draw_rect_4color_param.w = Mx - mx;
  draw_rect_4color_param.h = My - my;
  draw_rect_4color_param.color_ul = color_ul;
  draw_rect_4color_param.color_ll = color_ll;
  draw_rect_4color_param.color_lr = color_lr;
  draw_rect_4color_param.color_ur = color_ur;
  return sprites.white.draw4Color(draw_rect_4color_param);
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

let temp_color = vec4();
function premulAlphaColor(color) {
  temp_color[0] = color[0] * color[3];
  temp_color[1] = color[1] * color[3];
  temp_color[2] = color[2] * color[3];
  temp_color[3] = color[3];
  return temp_color;
}
function drawElipseInternal(sprite, x0, y0, x1, y1, z, spread, tu0, tv0, tu1, tv1, color, blend) {
  if (!blend && !glov_engine.defines.NOPREMUL) {
    blend = BLEND_PREMULALPHA;
    color = premulAlphaColor(color);
  }
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
  sprites.circle = spriteCreate({
    url: 'circle',
    width: CIRCLE_SIZE, height: CIRCLE_SIZE,
    format: TEXTURE_FORMAT.R8,
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
    sprites.hollow_circle = spriteCreate({
      url: 'hollow_circle',
      width: CIRCLE_SIZE, height: CIRCLE_SIZE,
      format: TEXTURE_FORMAT.R8,
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
let line_last_shader_param = { param0: [0,0] };
export function drawLine(x0, y0, x1, y1, z, w, precise, color, mode) {
  if (mode === undefined) {
    mode = default_line_mode;
  }
  let blend;
  if (!glov_engine.defines.NOPREMUL) {
    blend = BLEND_PREMULALPHA;
    color = premulAlphaColor(color);
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
    sprites[tex_key] = spriteCreate({
      url: tex_key,
      width: LINE_TEX_W, height: LINE_TEX_H,
      format: TEXTURE_FORMAT.R8,
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
  let shader_param;
  if (line_last_shader_param.param0[0] !== A ||
    line_last_shader_param.param0[1] !== B
  ) {
    line_last_shader_param = { param0: [A, B] };
  }
  shader_param = line_last_shader_param;

  glov_sprites.queueraw4(texs,
    x1 + tangx, y1 + tangy,
    x1 - tangx, y1 - tangy,
    x0 - tangx, y0 - tangy,
    x0 + tangx, y0 + tangy,
    z,
    LINE_U1, LINE_V0, LINE_U2, LINE_V1,
    color, glov_font.font_shaders.font_aa, shader_param, blend);

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
      color, glov_font.font_shaders.font_aa, shader_param, blend);
    glov_sprites.queueraw4(texs,
      x0 - tangx, y0 - tangy,
      x0 + tangx, y0 + tangy,
      x0 + tangx - nx, y0 + tangy - ny,
      x0 - tangx - nx, y0 - tangy - ny,
      z,
      LINE_U1, LINE_V1, LINE_U0, LINE_V0,
      color, glov_font.font_shaders.font_aa, shader_param, blend);
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
  let blend;
  if (!glov_engine.defines.NOPREMUL) {
    blend = BLEND_PREMULALPHA;
    color = premulAlphaColor(color);
  }
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
    sprites.cone = spriteCreate({
      url: 'cone',
      width: CONE_SIZE, height: CONE_SIZE,
      format: TEXTURE_FORMAT.R8,
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
    color, glov_font.font_shaders.font_aa, spreadTechParams(spread), blend);
}

export function setFontHeight(_font_height) {
  uiStyleModify(uiStyleDefault(), {
    text_height: _font_height,
  });
}

function uiApplyStyle(style) {
  ui_style_current = style;
  exports.font_height = style.text_height;
  exports.button_width = style.button_width;
  exports.button_height = style.button_height;
  fontSetDefaultSize(style.text_height);
}

export function scaleSizes(scale) {
  let button_height = round(32 * scale);
  let text_height = round(24 * scale);
  let button_width = round(200 * scale);
  modal_button_width = round(button_width / 2);
  modal_width = round(600 * scale);
  modal_y0 = round(200 * scale);
  modal_title_scale = 1.2;
  modal_pad = round(16 * scale);
  tooltip_width = round(400 * scale);
  tooltip_pad = round(8 * scale);
  panel_pixel_scale = button_height / sprites.panel.uidata.total_h; // button_height / panel pixel resolution
  tooltip_panel_pixel_scale = panel_pixel_scale;
  scrollAreaSetPixelScale(button_height / sprites.button.uidata.total_h);

  // calls `uiStyleApply()`:
  uiStyleModify(uiStyleDefault(), {
    text_height,
    button_width,
    button_height,
  });
}

export function setPanelPixelScale(scale) {
  tooltip_panel_pixel_scale = panel_pixel_scale = scale;
}

export function setModalSizes(_modal_button_width, width, y0, title_scale, pad) {
  modal_button_width = _modal_button_width || round(ui_style_current.button_width / 2);
  modal_width = width || 600;
  modal_y0 = y0 || 200;
  modal_title_scale = title_scale || 1.2;
  modal_pad = pad || modal_pad;
}

export function setTooltipWidth(_tooltip_width, _tooltip_panel_pixel_scale) {
  tooltip_width = _tooltip_width;
  tooltip_panel_pixel_scale = _tooltip_panel_pixel_scale;
  tooltip_pad = round(modal_pad / 2 * _tooltip_panel_pixel_scale);
}
