// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const engine = require('./engine.js');
const camera2d = require('./camera2d.js');
const in_event = require('./in_event.js');
const input = require('./input.js');
const { abs } = Math;
const ui = require('./ui.js');
const settings = require('./settings.js');

let state_cache = {};
let good_url = /https?:\/\//;

// Create an invisible A elem in the DOM so we get all of the good browsery
// behavior for a link area.
export function link(param) {
  let { x, y, w, h, url, internal, allow_modal } = param;
  if (!url.match(good_url)) {
    url = `${document.location.protocol}//${url}`;
  }
  let key = `${x}_${y}`;
  let state = state_cache[key];
  if (!state) {
    state = state_cache[key] = { clicked: false };
  }
  state.frame = engine.frame_index;

  let rect = { x, y, w, h };

  if (camera2d.clipTestRect(rect) && !settings.shader_debug) {
    // at least some is not clipped
    let elem = ui.getDOMElem(allow_modal, state.elem);
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
  let { style_link, style_link_hover, x, y, z, font_size, text, url } = param;
  text = text || url;
  z = z || Z.UI;
  font_size = font_size || ui.font_height;
  // Also: any parameter to link(), e.g. url
  let w = ui.font.getStringWidth(style_link, font_size, text);
  let h = font_size;
  let mouseover = input.mouseOver({ x, y, w, h, peek: true }) && !input.mousePosIsTouch();
  let style = mouseover ? style_link_hover : style_link;
  ui.font.drawSized(style, x, y, z, font_size, text);
  let underline_w = 1;
  ui.drawLine(x, y + h - underline_w, x + w, y + h - underline_w, z - 0.5, underline_w, 1, style.color_vec4);
  param.w = w;
  param.h = h;
  return link(param);
}

export function linkTick() {
  for (let key in state_cache) {
    let state = state_cache[key];
    if (state.frame !== engine.frame_index - 1) {
      delete state_cache[key];
    }
  }
}
