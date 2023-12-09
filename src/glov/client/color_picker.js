// Portions Copyright 2021 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const camera2d = require('./camera2d.js');
const { hsvToRGB, rgbToHSV } = require('./hsv.js');
const input = require('./input.js');
const { min } = Math;
const ui = require('./ui.js');
const {
  LINE_CAP_SQUARE,
  uiButtonHeight,
  buttonWasFocused,
} = ui;
const { spriteClipped, spriteClipPause, spriteClipResume, spriteCreate } = require('./sprites.js');
const { TEXTURE_FORMAT } = require('./textures.js');
const { clamp } = require('glov/common/util.js');
const { vec3, v3copy, vec4 } = require('glov/common/vmath.js');

let color_black = vec4(0,0,0,1);

function colorPickerOpen(state) {
  state.open = true;
  if (!state.color_hs) {
    state.color_hs = vec4(0,0,0,1);
    state.color_v = vec4(0,0,0,1);
    state.hsv = vec3();
  }

  rgbToHSV(state.hsv, state.rgba);
}

function colorPickerAlloc(param) {
  let state ={
    open: false,
    rgba: vec4(0,0,0,1),
  };
  v3copy(state.rgba, param.color);
  return state;
}

let picker_sprite_hue_sat;
let picker_sprite_val;
function initTextures() {
  const HS_SIZE = 32;
  let data = new Uint8Array(HS_SIZE * HS_SIZE * 3);
  let rgb = vec3();
  let idx = 0;
  for (let j = 0; j < HS_SIZE; j++) {
    let sat = 1 - j / (HS_SIZE - 1);
    for (let i = 0; i < HS_SIZE; i++) {
      let hue = i * 360 / (HS_SIZE - 1);
      hsvToRGB(rgb, hue, sat, 1);
      data[idx++] = rgb[0] * 255;
      data[idx++] = rgb[1] * 255;
      data[idx++] = rgb[2] * 255;
    }
  }
  picker_sprite_hue_sat = spriteCreate({
    url: 'cpicker_hs',
    width: HS_SIZE, height: HS_SIZE,
    format: TEXTURE_FORMAT.RGB8,
    data,
    filter_min: gl.LINEAR,
    filter_mag: gl.LINEAR,
    wrap_s: gl.CLAMP_TO_EDGE,
    wrap_t: gl.CLAMP_TO_EDGE,
  });

  data = new Uint8Array(32);
  for (let ii = 0; ii < data.length; ++ii) {
    data[ii] = 255 - ii * 255 / (data.length - 1);
  }
  picker_sprite_val = spriteCreate({
    url: 'cpicker_v',
    width: 1, height: data.length,
    format: TEXTURE_FORMAT.R8,
    data,
    filter_min: gl.LINEAR,
    filter_mag: gl.LINEAR,
    wrap_s: gl.CLAMP_TO_EDGE,
    wrap_t: gl.CLAMP_TO_EDGE,
  });
}

export function colorPicker(param) {
  let state = ui.getUIElemData('colorpicker', param, colorPickerAlloc);
  let icon_h = param.icon_h || uiButtonHeight();
  let icon_w = param.icon_w || icon_h;
  let picker_h = param.picker_h || uiButtonHeight() * 4;
  let pad = param.pad || 3;
  let { x, y, z } = param;

  if (!state.open) {
    v3copy(state.rgba, param.color);
  }

  if (ui.buttonImage({
    x, y, z,
    w: icon_w, h: icon_h,
    img: ui.sprites.white,
    color: state.rgba,
  })) {
    if (!state.open) {
      colorPickerOpen(state);
    } else {
      state.open = false;
    }
  }
  let handled = buttonWasFocused();

  if (state.open) {
    let clip_pause = spriteClipped();
    if (clip_pause) {
      spriteClipPause();
    }

    if (!picker_sprite_hue_sat) {
      initTextures();
    }

    y = min(y, camera2d.y1() - picker_h);
    z+=2;
    x += icon_w + pad;
    let x0 = x;
    let y0 = y;

    let { hsv } = state;
    let hue_sat_w = picker_h;
    let val_w = picker_h * 0.1;
    hsvToRGB(state.color_v, 0, 0, hsv[2]);
    let hue_sat_param = {
      x, y, z,
      w: hue_sat_w, h: picker_h,
      color: state.color_v,
      max_dist: Infinity,
    };
    picker_sprite_hue_sat.draw(hue_sat_param);
    let drag = input.drag(hue_sat_param) || input.click(hue_sat_param);
    if (drag) {
      handled = true;
      let pos = drag.cur_pos || drag.pos;
      hsv[0] = clamp((pos[0] - x) / hue_sat_param.w * 360, 0, 360);
      hsv[1] = clamp(1 - (pos[1] - y) / hue_sat_param.h, 0, 1);
    }
    let hs_x = x + hsv[0]*hue_sat_w/360;
    let hs_y = y + (1-hsv[1])*picker_h;
    ui.drawLine(hs_x - pad, hs_y, hs_x + pad, hs_y, z + 1, 1, 1, color_black, LINE_CAP_SQUARE);
    ui.drawLine(hs_x, hs_y - pad, hs_x, hs_y + pad, z + 1, 1, 1, color_black, LINE_CAP_SQUARE);
    x += hue_sat_w + pad;

    hsvToRGB(state.color_hs, hsv[0], hsv[1], 1);
    let val_param = {
      x, y, z,
      w: val_w, h: picker_h,
      color: state.color_hs,
      max_dist: Infinity,
    };
    picker_sprite_val.draw(val_param);
    drag = input.drag(val_param) || input.click(val_param);
    if (drag) {
      handled = true;
      let pos = drag.cur_pos || drag.pos;
      hsv[2] = clamp(1 - (pos[1] - y) / val_param.h, 0, 1);
    }
    let v_y = y + (1-hsv[2])*picker_h;
    ui.drawLine(x, v_y, x + val_w, v_y, z + 1, 1, 1, color_black, LINE_CAP_SQUARE);
    x += val_w;

    hsvToRGB(state.rgba, state.hsv[0], state.hsv[1], state.hsv[2]);

    // eat mouseover/clicks/drags
    let panel_param = { x: x0 - pad, y: y0 - pad, w: x - x0 + pad * 2, h: picker_h + pad * 2, z: z-1 };
    if (input.mouseOver(panel_param)) {
      handled = true;
    }
    input.drag(panel_param);
    ui.panel(panel_param);

    if (clip_pause) {
      spriteClipResume();
    }

    if (input.click({ peek: true }) || !handled && input.mouseDownAnywhere()) {
      state.open = false;
    }
  }

  v3copy(param.color, state.rgba);

  // return state; Maybe useful for getting at HSV, open, etc?
}
