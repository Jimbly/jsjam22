// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const assert = require('assert');
const engine = require('./engine.js');
const { fontStyle } = require('./font.js');
const camera2d = require('./camera2d.js');
const in_event = require('./in_event.js');
const input = require('./input.js');
const { abs } = Math;
const {
  playUISound,
  uiGetDOMElem,
} = require('./ui.js');
const ui = require('./ui.js');
const { uiStyleCurrent } = require('./uistyle.js');
const settings = require('./settings.js');
const { SPOT_DEFAULT_BUTTON, spot, spotFocusSteal, spotKey } = require('./spot.js');

let style_link_default = fontStyle(null, {
  color: 0x5040FFff,
  outline_width: 1.0,
  outline_color: 0x00000020,
});
let style_link_hover_default = fontStyle(null, {
  color: 0x0000FFff,
  outline_width: 1.0,
  outline_color: 0x00000020,
});

export function linkGetDefaultStyle() {
  return style_link_default;
}

export function linkSetDefaultStyle(style_link, style_link_hover) {
  style_link_default = style_link;
  style_link_hover_default = style_link_hover;
}

let state_cache = {};
let good_url = /https?:\/\//;

function preventFocus(evt) {
  evt.preventDefault();
  if (evt.relatedTarget) {
    // Revert focus back to previous blurring element (canvas or edit box)
    evt.relatedTarget.focus();
  } else {
    // No previous focus target, blur instead
    evt.currentTarget.blur();
  }
}

// Create an invisible A elem in the DOM so we get all of the good browsery
// behavior for a link area.
export function link(param) {
  let { x, y, w, h, url, internal, allow_modal } = param;
  if (!url.match(good_url)) {
    url = `${document.location.protocol}//${url}`;
  }
  let key = spotKey(param);
  let state = state_cache[key];
  if (!state) {
    state = state_cache[key] = { clicked: false };
  }
  state.frame = engine.frame_index;

  let rect = { x, y, w, h };

  // TODO: use spot_ret.allow_focus instead of all of this?
  if (camera2d.clipTestRect(rect) && !(settings.shader_debug || settings.show_profiler)) {
    // at least some is not clipped
    let elem = uiGetDOMElem(state.elem, allow_modal);
    if (elem !== state.elem) {
      state.elem = elem;
      if (elem) {
        // new DOM element, initialize
        elem.textContent = '';
        let a_elem = document.createElement('a');
        a_elem.setAttribute('draggable', false);
        a_elem.textContent = ' ';
        a_elem.className = 'glovui_link noglov';
        a_elem.setAttribute('target', '_blank');
        a_elem.setAttribute('href', url);
        // Make the element unfocusable, so that pressing enter at some point
        //   after clicking a link does not re-activate the link, additionally
        //   pressing tab should not (in the browser) focus these links.
        a_elem.setAttribute('tabindex', '-1');
        a_elem.addEventListener('focus', preventFocus);
        state.url = url;
        if (internal) {
          let down_x;
          let down_y;
          input.handleTouches(a_elem);
          a_elem.onmousedown = function (ev) {
            down_x = ev.pageX;
            down_y = ev.pageY;
          };
          a_elem.onclick = function (ev) {
            ev.preventDefault();
            if (down_x) {
              let dist = abs(ev.pageX - down_x) + abs(ev.pageY - down_y);
              if (dist > 50) {
                return;
              }
            }
            state.clicked = true;
            in_event.handle('mouseup', ev);
          };
        }
        elem.appendChild(a_elem);
        state.a_elem = a_elem;
      }
    }
    if (elem) {
      if (url !== state.url) {
        state.a_elem.setAttribute('href', url);
        state.url = url;
      }

      let pos = camera2d.htmlPos(rect.x, rect.y);
      elem.style.left = `${pos[0]}%`;
      elem.style.top = `${pos[1]}%`;
      let size = camera2d.htmlSize(rect.w, rect.h);
      elem.style.width = `${size[0]}%`;
      elem.style.height = `${size[1]}%`;
    }
  }
  let clicked = state.clicked;
  state.clicked = false;
  return clicked;
}

export function linkText(param) {
  let { style_link, style_link_hover, x, y, z, style, font_size, text, url, internal } = param;
  text = text || url;
  z = z || Z.UI;
  style = style || uiStyleCurrent();
  font_size = font_size || style.text_height;
  // Also: any parameter to link(), e.g. url
  let w = ui.font.getStringWidth(style_link || style_link_default, font_size, text);
  let h = font_size;
  param.w = w;
  param.h = h;
  param.def = SPOT_DEFAULT_BUTTON;
  let spot_ret = spot(param);
  let style_use = spot_ret.focused ?
    (style_link_hover || style_link_hover_default) :
    (style_link || style_link_default);
  ui.font.drawSized(style_use, x, y, z, font_size, text);
  let underline_w = 1;
  ui.drawLine(x, y + h - underline_w, x + w, y + h - underline_w, z - 0.5, underline_w, 1, style_use.color_vec4);
  let clicked = link(param);
  if (clicked) {
    const sound_button = param.sound_button === undefined ? param.def.sound_button : param.sound_button;
    if (sound_button) {
      playUISound(sound_button);
    }
    spotFocusSteal(param);
  }
  if (spot_ret.ret && !internal) {
    // activated (via keyboard or gamepad), and an external link, act as if we clicked it
    let key = spotKey(param);
    let state = state_cache[key];
    assert(state);
    assert(state.a_elem);
    state.a_elem.click();
  }
  return clicked || spot_ret.ret;
}

export function linkTick() {
  for (let key in state_cache) {
    let state = state_cache[key];
    if (state.frame !== engine.frame_index - 1) {
      delete state_cache[key];
    }
  }
}
