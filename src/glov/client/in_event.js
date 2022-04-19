// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// System for registering callbacks to run in event handlers on the next frame
// Used to get around restrictions on APIs like pointer lock, fullscreen, or
// screen orientation.

const assert = require('assert');

let cbs = {};
export function topOfFrame() {
  cbs = {};
}

export function on(type, code_or_pos, cb) {
  let list = cbs[type] = cbs[type] || [];
  if (typeof code_or_pos === 'number') {
    list[code_or_pos] = cb;
  } else {
    list.push([code_or_pos, cb]);
  }
}

export function handle(type, event) {
  let list = cbs[type];
  if (!list) {
    return;
  }
  switch (type) {
    case 'keydown':
    case 'keyup':
      if (list[event.keyCode]) {
        list[event.keyCode](type, event);
      }
      break;
    case 'mouseup':
    case 'mousedown': {
      let x = event.pageX;
      let y = event.pageY;
      let button = event.button;
      for (let ii = 0; ii < list.length; ++ii) {
        let elem = list[ii];
        let pos = elem[0];
        if (x >= pos.x && x < pos.x + pos.w &&
          y >= pos.y && y < pos.y + pos.h &&
          (pos.button < 0 || pos.button === button)
        ) {
          elem[1](type, event);
          break;
        }
      }
    } break;
    default:
      assert(false);
  }
}
