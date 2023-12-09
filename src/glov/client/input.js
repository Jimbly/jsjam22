// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code from Turbulenz: Copyright (c) 2012-2013 Turbulenz Limited
// Released under MIT License: https://opensource.org/licenses/MIT
/* global navigator */

/* eslint-disable import/order */
const assert = require('assert');

const UP_EDGE = 0; // only for pads, which use === null as "up"
const UP = 0; // only for key/mouse
const DOWN = 1;
const DOWN_EDGE = 2; // only for pads

// per-app overrideable options
const TOUCH_AS_MOUSE = true;
let map_analog_to_dpad = true;

let mouse_log = false;

export const click = mouseUpEdge; // eslint-disable-line @typescript-eslint/no-use-before-define
export const inputClick = mouseUpEdge; // eslint-disable-line @typescript-eslint/no-use-before-define

const { deprecate } = require('glov/common/util.js');
deprecate(exports, 'mouseDown', 'mouseDownAnywhere, mouseDownMidClick, mouseDownOverBounds');

import {
  ANY,
  POINTERLOCK,
} from './input_constants';

export * from './input_constants';

export let KEYS = {
  BACKSPACE: 8,
  TAB: 9,
  ENTER: 13,
  RETURN: 13,
  SHIFT: 16,
  CTRL: 17,
  ALT: 18,
  ESC: 27,
  ESCAPE: 27,
  SPACE: 32,
  PAGEUP: 33,
  PAGEDOWN: 34,
  END: 35,
  HOME: 36,
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  INS: 45,
  DEL: 46,

  0: 48,
  1: 49,
  2: 50,
  3: 51,
  4: 52,
  5: 53,
  6: 54,
  7: 55,
  8: 56,
  9: 57,

  A: 65,
  B: 66,
  C: 67,
  D: 68,
  E: 69,
  F: 70,
  G: 71,
  H: 72,
  I: 73,
  J: 74,
  K: 75,
  L: 76,
  M: 77,
  N: 78,
  O: 79,
  P: 80,
  Q: 81,
  R: 82,
  S: 83,
  T: 84,
  U: 85,
  V: 86,
  W: 87,
  X: 88,
  Y: 89,
  Z: 90,

  NUMPAD0: 96,
  NUMPAD1: 97,
  NUMPAD2: 98,
  NUMPAD3: 99,
  NUMPAD4: 100,
  NUMPAD5: 101,
  NUMPAD6: 102,
  NUMPAD7: 103,
  NUMPAD8: 104,
  NUMPAD9: 105,
  NUMPAD_MULTIPLY: 106,
  NUMPAD_ADD: 107,
  NUMPAD_SUBTRACT: 109,
  NUMPAD_DECIMAL_POINT: 110,
  NUMPAD_DIVIDE: 111,

  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,

  EQUALS: 187,
  COMMA: 188,
  MINUS: 189,
  PERIOD: 190,
  SLASH: 191,
  TILDE: 192,
};
if (typeof Proxy === 'function') {
  // Catch referencing keys that are not in our map
  KEYS = new Proxy(KEYS, {
    get: function (target, prop) {
      let ret = target[prop];
      assert(ret);
      return ret;
    }
  });
}
export const PAD = {
  A: 0,
  SELECT: 0, // GLOV name
  B: 1,
  CANCEL: 1, // GLOV name
  X: 2,
  Y: 3,
  LB: 4,
  LEFT_BUMPER: 4,
  RB: 5,
  RIGHT_BUMPER: 5,
  LT: 6,
  LEFT_TRIGGER: 6,
  RT: 7,
  RIGHT_TRIGGER: 7,
  BACK: 8,
  START: 9,
  LEFT_STICK: 10,
  RIGHT_STICK: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  ANALOG_UP: 20,
  ANALOG_LEFT: 21,
  ANALOG_DOWN: 22,
  ANALOG_RIGHT: 23,
  LSTICK_UP: 20,
  LSTICK_LEFT: 21,
  LSTICK_DOWN: 22,
  LSTICK_RIGHT: 23,
  RSTICK_UP: 24,
  RSTICK_LEFT: 25,
  RSTICK_DOWN: 26,
  RSTICK_RIGHT: 27,
};

const { is_firefox, is_mac_osx } = require('./browser.js');
const camera2d = require('./camera2d.js');
const { cmd_parse } = require('./cmds.js');
const engine = require('./engine.js');
const { renderNeeded } = require('./engine.js');
const in_event = require('./in_event.js');
const local_storage = require('./local_storage.js');
const { abs, max, min, sqrt } = Math;
const pointer_lock = require('./pointer_lock.js');
const settings = require('./settings.js');
const { soundResume } = require('./sound.js');
const { spotMouseoverHook } = require('./spot.js');
const { empty } = require('glov/common/util.js');
const { vec2, v2add, v2copy, v2lengthSq, v2set, v2scale, v2sub } = require('glov/common/vmath.js');

let pad_to_touch;

let canvas;
let key_state_new = {};
let pad_states = []; // One map per gamepad to pad button states
let gamepad_data = []; // Other tracking data per gamepad
let mouse_pos = vec2(); // in DOM coordinates, not canvas or virtual
let last_mouse_pos = vec2();
let mouse_pos_is_touch = false;
let mouse_over_captured = false;
let mouse_down = [];
let wheel_events = [];
let movement_questionable_frames = 0;
const MOVEMENT_QUESTIONABLE_FRAMES = 2; // Need at least 2

let input_eaten_kb = false;
let input_eaten_mouse = false;

let touches = {}; // `m${button}` or touch_id -> TouchData
let no_active_touches = true;

export let touch_mode = local_storage.getJSON('touch_mode', false);
export let pad_mode = !touch_mode && local_storage.getJSON('pad_mode', false);

cmd_parse.registerValue('mouse_log', {
  type: cmd_parse.TYPE_INT,
  range: [0, 1],
  get: () => mouse_log,
  set: (v) => (mouse_log = v),
});

export function inputTouchMode() {
  return touch_mode;
}

export function inputPadMode() {
  return pad_mode;
}

export function inputEatenMouse() {
  return input_eaten_mouse;
}

function eventTimestamp(event) {
  if (event && event.timeStamp) {
    // assert((event.timeStamp < 1e12) === (engine.hrtime < 1e12));
    // Must both be high res times, or both not!
    if ((event.timeStamp < 1e12) !== (engine.hrtime < 1e12)) {
      return engine.hrtime;
    }
    return event.timeStamp;
  }
  return engine.hrtime;
}

function TouchData(pos, touch, button, event) {
  this.delta = vec2();
  this.total = 0;
  this.cur_pos = pos.slice(0);
  this.start_pos = pos.slice(0);
  this.touch = touch;
  this.button = button;
  this.start_time = Date.now();
  this.dispatched = false;
  this.dispatched_drag = false;
  this.dispatched_drag_over = false;
  this.was_double_click = false;
  this.up_edge = 0;
  this.down_edge = 0;
  this.state = DOWN;
  this.down_time = 0;
  this.origin_time = eventTimestamp(event);
}
TouchData.prototype.down = function (event, is_edge) {
  if (is_edge) {
    this.down_edge++;
  }
  this.state = DOWN;
  this.origin_time = eventTimestamp(event);
};

const MIN_EVENT_TIME_DELTA = 0.01; // fractions of a millisecond
function timeDelta(event, origin_time) {
  let et = eventTimestamp(event);
  // timestamps on events are often back in time relative to the last tick time
  return max(et - origin_time, MIN_EVENT_TIME_DELTA);
}

function KeyData() {
  this.down_edge = 0;
  // this.down_start = 0;
  this.origin_time = 0;
  this.down_time = 0;
  this.up_edge = 0;
  this.state = UP;
}
KeyData.prototype.keyUp = function (event) {
  ++this.up_edge;
  this.down_time += timeDelta(event, this.origin_time);
  this.state = UP;
};

function setMouseToMid() {
  v2set(mouse_pos, engine.width*0.5/camera2d.domToCanvasRatio(), engine.height*0.5/camera2d.domToCanvasRatio());
}

export function pointerLocked() {
  return pointer_lock.isLocked();
}
let pointerlock_touch_id = `m${POINTERLOCK}`;
let pointerlock_frame = -1;
// only works reliably when called from an event handler
export function pointerLockEnter(when) {
  pointer_lock.enter(when);
}
function onPointerLockEnter() {
  if (touch_mode) {
    return;
  }
  pointerlock_frame = engine.frame_index;
  let touch_data = touches[pointerlock_touch_id];
  setMouseToMid();
  if (touch_data) {
    v2copy(touch_data.start_pos, mouse_pos);
    touch_data.state = DOWN;
    touch_data.origin_time = engine.hrtime;
  } else {
    touch_data = touches[pointerlock_touch_id] = new TouchData(mouse_pos, false, POINTERLOCK, null);
  }
  movement_questionable_frames = MOVEMENT_QUESTIONABLE_FRAMES;
}
export function pointerLockJustEntered(num_frames) {
  return engine.frame_index <= pointerlock_frame + (num_frames || 1);
}
export function pointerLockExit() {
  let touch_data = touches[pointerlock_touch_id];
  if (touch_data) {
    v2copy(touch_data.cur_pos, mouse_pos);
    // no UP_EDGE for this
    touch_data.state = UP;
  }
  pointer_lock.exit();
  movement_questionable_frames = MOVEMENT_QUESTIONABLE_FRAMES;
}

let last_event;
const skip = { isTrusted: 1, sourceCapabilities: 1, path: 1, currentTarget: 1, view: 1 };
function eventlog(event) {
  if (event === last_event) {
    return;
  }
  last_event = event;
  let pairs = [];
  for (let k in event) {
    let v = event[k];
    if (!v || typeof v === 'function' || k.toUpperCase() === k || skip[k]) {
      continue;
    }
    pairs.push(`${k}:${v.id || v}`);
  }
  console.log(`${engine.frame_index} ${event.type} ${pointerLocked()?'ptrlck':'unlckd'} ${pairs.join(',')}`);
}

let allow_all_events = false;
export function inputAllowAllEvents(allow) {
  allow_all_events = allow;
}

function isInputElement(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
    target.tagName === 'LABEL' || target.tagName === 'VIDEO');
}

function letWheelEventThrough(event) {
  // *not* checking for `noglov`, as links have these, and we want to capture scroll events even if mouse is over links
  return allow_all_events || isInputElement(event.target);
}

let event_filter = () => false;

// `filter` returns true if the event should be allowed to propgate to the DOM, and not be sent to the engine
export function inputSetEventFilter(filter) {
  event_filter = filter;
}

function letEventThrough(event) {
  if (!event.target || allow_all_events || event.glov_do_not_cancel) {
    return true;
  }
  // Going to an input or related element
  return isInputElement(event.target) ||
    String(event.target.className).includes('noglov') || event_filter(event);
  /* Not doing this: this causes legitimate clicks (e.g. when an edit box is focused)
      to be lost, instead, relying on `allow_all_events` when an HTML UI is active.
    // or, one of those is focused, and going away from it (e.g. input elem focused, clicking on canvas)
    document.activeElement && event.target !== document.activeElement &&
    (isInputElement(document.activeElement) ||
      String(document.activeElement.className).includes('noglov'));*/
}

function ignored(event) {
  // eventlog(event);
  if (!letEventThrough(event)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

let ctrl_checked = false;
let unload_protected = false;
function beforeUnload(e) {
  if (unload_protected && ctrl_checked) {
    // Exit pointer lock if the browser didn't do that automatically
    pointerLockExit();
    // Cancel the event
    e.preventDefault();
    // Chrome requires returnValue to be set
    e.returnValue = 'Are you sure you want to quit?';
  } else {
    engine.releaseCanvas();
  }
}
function protectUnload(enable) {
  unload_protected = enable;
}

let last_input_time = 0;
export function inputLastTime() {
  return last_input_time;
}
function onUserInput() {
  soundResume();
  last_input_time = Date.now();
  renderNeeded();
}

function releaseAllKeysDown(evt) {
  for (let code in key_state_new) {
    let ks = key_state_new[code];
    if (ks.state === DOWN) {
      ks.keyUp(evt);
    }
  }
}

function onKeyUp(event) {
  renderNeeded();
  protectUnload(event.ctrlKey);
  let code = event.keyCode;
  if (!letEventThrough(event)) {
    event.stopPropagation();
    event.preventDefault();
  }

  if (code === KEYS.ESC && pointerLocked()) {
    pointerLockExit();
  }
  // Letting through to our code regardless of no_stop, because we handle things like ESC in INPUT elements

  let ks = key_state_new[code];
  if (ks && ks.state === DOWN) {
    if (is_mac_osx && event.key === 'Meta') {
      // We don't get keyUp events for any keys released while CMD is held, so we must assume all are released
      releaseAllKeysDown(event);
    } else {
      ks.keyUp(event);
    }
  }

  in_event.handle('keyup', event);
}

function onKeyDown(event) {
  protectUnload(event.ctrlKey);
  let code = event.keyCode;
  let no_stop = letEventThrough(event) ||
    code >= KEYS.F5 && code <= KEYS.F12 || // Chrome debug hotkeys
    code === KEYS.I && (event.altKey && event.metaKey || event.ctrlKey && event.shiftKey) || // Safari, alternate Chrome
    code === KEYS.R && event.ctrlKey; // Chrome reload hotkey
  if (!no_stop) {
    event.stopPropagation();
    event.preventDefault();
  }
  // console.log(`${event.code} ${event.keyCode}`);
  onUserInput();

  // Letting through to our code regardless of no_stop, because we handle things like ESC in INPUT elements
  let ks = key_state_new[code];
  if (!ks) {
    ks = key_state_new[code] = new KeyData();
  }
  if (ks.state !== DOWN) { // not a repeat event
    ++ks.down_edge;
    ks.state = DOWN;
    ks.origin_time = eventTimestamp(event);
    // ks.down_start = ks.origin_time;

    in_event.handle('keydown', event);
  }
}

let mouse_move_x = 0;
export function debugGetMouseMoveX() {
  let ret = mouse_move_x;
  mouse_move_x = 0;
  return ret;
}

let mouse_moved = false;
let mouse_button_had_edge = false;
let mouse_button_had_up_edge = false;
let temp_delta = vec2();
let last_abs_move = 0;
let last_abs_move_time = 0;
let last_move_x = 0;
let last_move_y = 0;
function onMouseMove(event, no_stop) {
  renderNeeded();
  /// eventlog(event);
  // Don't block mouse button 3, that's the Back button
  if (!letEventThrough(event) && !no_stop && event.button !== 3) {
    event.preventDefault();
    event.stopPropagation();
    if (touch_mode) {
      local_storage.setJSON('touch_mode', false);
      touch_mode = false;
    }
    if (pad_mode) {
      local_storage.setJSON('pad_mode', false);
      pad_mode = false;
    }
  }
  mouse_moved = true;
  // offsetX/layerX return position relative to text-entry boxes, not good!
  // clientX/clientY do not handle weird scrolling that happens on iOS, but
  //   should not affect mouse events (but maybe on Safari desktop?)
  mouse_pos[0] = event.pageX;
  mouse_pos[1] = event.pageY;
  // if (event.offsetX !== undefined) {
  //   mouse_pos[0] = event.offsetX;
  //   mouse_pos[1] = event.offsetY;
  // } else {
  //   mouse_pos[0] = event.layerX;
  //   mouse_pos[1] = event.layerY;
  // }
  mouse_pos_is_touch = false;

  let movement_x = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
  let movement_y = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

  mouse_move_x += movement_x;

  let any_movement = false;
  if (pointerLocked()) {
    setMouseToMid();
    if (movement_x || movement_y) {
      // Smooth out (ignore) large jumps in movement
      // This is, I believe, just a bug with Chromium on Windows, as it repositions the hidden mouse cursor
      let ts = event.timeStamp || Date.now();
      let abs_x = abs(movement_x);
      let abs_y = abs(movement_y);
      let abs_move = abs_x + abs_y;
      if (abs_move > 200 && (abs_move > 3 * last_abs_move || ts - last_abs_move_time > 1000)) {
        console.log(`Ignoring mousemove with sudden large delta: ${movement_x},${movement_y}`);
      } else if (is_firefox && movement_x === last_move_x && movement_y === last_move_y && abs_x < 2 && abs_y < 2) {
        // Ignoring mousemove similar to previous and with very little delta, due to a Firefox bug
      } else {
        v2set(temp_delta, movement_x || 0, movement_y || 0);
        any_movement = true;
      }
      last_abs_move = abs_move;
      last_abs_move_time = ts;
      last_move_x = movement_x;
      last_move_y = movement_y;
    }
  } else {
    v2sub(temp_delta, mouse_pos, last_mouse_pos);
    if (temp_delta[0] || temp_delta[1]) {
      any_movement = true;
    }
    v2copy(last_mouse_pos, mouse_pos);
  }
  if (any_movement && movement_questionable_frames && v2lengthSq(temp_delta) > 100*100) {
    // giant movement right after entering or exiting pointer lock, ignore (Chrome bug)
    // We get these unreasonable jumps in both movementXY and the other, presumably
    // because pointerLocked() is slightly out of sync, though the large .movementX/Y
    // is clearly erroneous.
    any_movement = false;
  }
  if (any_movement) {
    for (let button = POINTERLOCK; button < mouse_down.length; ++button) {
      if (mouse_down[button] || button === POINTERLOCK && pointerLocked()) {
        let touch_data = touches[`m${button}`];
        if (touch_data) {
          v2add(touch_data.delta, touch_data.delta, temp_delta);
          touch_data.total += abs(temp_delta[0]) + abs(temp_delta[1]);
          v2copy(touch_data.cur_pos, mouse_pos);
        }
      }
    }
  }
}

function onMouseDown(event) {
  if (mouse_log) {
    eventlog(event);
  }
  onMouseMove(event); // update mouse_pos
  onUserInput();
  let no_click = letEventThrough(event);

  let button = event.button;
  mouse_down[button] = true;
  let touch_id = `m${button}`;
  if (touches[touch_id]) {
    v2copy(touches[touch_id].start_pos, mouse_pos);
  } else {
    touches[touch_id] = new TouchData(mouse_pos, false, button, event);
  }
  touches[touch_id].down(event, !no_click);
  if (!no_click) {
    in_event.handle('mousedown', event);
  }
  mouse_button_had_edge = true;
  //This solves input bug when game is running as iframe. E.g. Facebook Instant
  if (window.focus) {
    window.focus();
  }
}

let last_up_edges = [{
  timestamp: 0,
  pos: vec2(),
},{
  timestamp: 0,
  pos: vec2(),
}];
function registerMouseUpEdge(touch_data, timestamp) {
  touch_data.up_edge++;
  let t = last_up_edges[0];
  last_up_edges[0] = last_up_edges[1];
  last_up_edges[1] = t;
  v2copy(t.pos, touch_data.cur_pos);
  t.timestamp = timestamp;
}

function onMouseUp(event) {
  if (mouse_log) {
    eventlog(event);
  }
  onMouseMove(event); // update mouse_pos
  let no_click = letEventThrough(event);
  let button = event.button;
  if (mouse_down[button]) {
    let touch_id = `m${button}`;
    let touch_data = touches[touch_id];
    if (touch_data) {
      v2copy(touch_data.cur_pos, mouse_pos);
      if (!no_click) {
        registerMouseUpEdge(touch_data, eventTimestamp(event));
      }
      touch_data.state = UP;
      touch_data.down_time += timeDelta(event, touch_data.origin_time);
    }
    delete mouse_down[button];
  }
  mouse_button_had_edge = true;
  mouse_button_had_up_edge = true;
  if (!no_click) {
    in_event.handle('mouseup', event);
  }
}

function onWheel(event) {
  renderNeeded();
  let saved = mouse_moved; // don't trigger mouseMoved()
  onMouseMove(event, true);
  mouse_moved = saved;
  let delta = -event.deltaY || event.wheelDelta || -event.detail;
  wheel_events.push({
    pos: [event.pageX, event.pageY],
    delta: delta > 0 ? 1 : -1,
    dispatched: false,
  });

  if (!letWheelEventThrough(event)) {
    event.stopPropagation();
    event.preventDefault();
  }
}

let touch_pos = vec2();
let released_touch_id = 0;
function onTouchChange(event) {
  // eventlog(event);
  // Using .pageX/Y here because on iOS when a text entry is selected, it scrolls
  // our canvas offscreen.  Should maybe have the canvas resize and use clientX
  // instead, but this works well enough.
  onUserInput();
  if (!touch_mode) {
    local_storage.set('touch_mode', true);
    touch_mode = true;
  }
  if (pad_mode) {
    local_storage.set('pad_mode', false);
    pad_mode = false;
  }
  if (event.cancelable !== false) {
    event.preventDefault();
  }
  let ct = event.touches;
  let seen = {};

  let new_count = ct.length;
  let old_count = 0;
  let first_valid_touch;
  // Look for press and movement
  for (let ii = 0; ii < ct.length; ++ii) {
    let touch = ct[ii];
    try {
      if (!isFinite(touch.pageX) || !isFinite(touch.pageY)) {
        // getting bad touch events sometimes (Moto phones?), simply ignore
        --new_count;
        continue;
      }
    } catch (e) {
      // getting "Permission denied to access property "pageX" rarely on Firefox, simply ignore
      --new_count;
      continue;
    }
    if (!first_valid_touch) {
      first_valid_touch = touch;
    }

    let last_touch = touches[touch.identifier];
    v2set(touch_pos, touch.pageX, touch.pageY);
    if (!last_touch) {
      last_touch = touches[touch.identifier] = new TouchData(touch_pos, true, 0, event);
      last_touch.down(event, true);
      mouse_button_had_edge = true;
      in_event.handle('mousedown', touch);
    } else {
      ++old_count;
      v2sub(temp_delta, touch_pos, last_touch.cur_pos);
      v2add(last_touch.delta, last_touch.delta, temp_delta);
      last_touch.total += abs(temp_delta[0]) + abs(temp_delta[1]);
      v2copy(last_touch.cur_pos, touch_pos);
    }

    seen[touch.identifier] = true;
    if (TOUCH_AS_MOUSE && new_count === 1) {
      // Single touch, treat as mouse movement
      v2copy(mouse_pos, touch_pos);
      mouse_pos_is_touch = true;
    }
  }
  // Look for release, if releasing exactly one final touch
  let released_touch;
  let released_ids = [];
  for (let id in touches) {
    if (!seen[id]) {
      let touch = touches[id];
      if (touch.touch && touch.state === DOWN) {
        ++old_count;
        released_touch = touch;
        released_ids.push(id);
        in_event.handle('mouseup', { pageX: touch.cur_pos[0], pageY: touch.cur_pos[1] });
        registerMouseUpEdge(touch, eventTimestamp(event));
        mouse_button_had_edge = true;
        mouse_button_had_up_edge = true;
        touch.state = UP;
        touch.down_time += timeDelta(event, touch.origin_time);
        touch.release = true;
      }
    }
  }
  for (let ii = 0; ii < released_ids.length; ++ii) {
    let id = released_ids[ii];
    let touch = touches[id];
    // get new id, not overlapping with touch.identifier values,
    // so that if we get a new touch event before the next tick, we still see the release, etc
    let new_id = `r${++released_touch_id}`;
    delete touches[id];
    touches[new_id] = touch;
  }
  if (TOUCH_AS_MOUSE) {
    if (old_count === 1 && new_count === 0) {
      delete mouse_down[0];
      v2copy(mouse_pos, released_touch.cur_pos);
      mouse_pos_is_touch = true;
    } else if (new_count === 1) {
      if (!old_count) {
        mouse_down[0] = true;
      }
      v2set(mouse_pos, first_valid_touch.pageX, first_valid_touch.pageY);
      mouse_pos_is_touch = true;
    } else if (new_count > 1) {
      // multiple touches, release mouse_down without emitting click
      delete mouse_down[0];
    }
  }
}

function onBlurOrFocus(evt) {
  renderNeeded();
  protectUnload(false);
  releaseAllKeysDown(evt);
}

let ANALOG_MAP = {};
function genAnalogMap() {
  if (map_analog_to_dpad) {
    ANALOG_MAP[PAD.LEFT] = [PAD.LSTICK_LEFT, PAD.RSTICK_LEFT];
    ANALOG_MAP[PAD.RIGHT] = [PAD.LSTICK_RIGHT, PAD.RSTICK_RIGHT];
    ANALOG_MAP[PAD.UP] = [PAD.LSTICK_UP, PAD.RSTICK_UP];
    ANALOG_MAP[PAD.DOWN] = [PAD.LSTICK_DOWN, PAD.RSTICK_DOWN];
  }
}

let passive_param = false;
export function handleTouches(elem) {
  elem.addEventListener('touchstart', onTouchChange, passive_param);
  elem.addEventListener('touchmove', onTouchChange, passive_param);
  elem.addEventListener('touchend', onTouchChange, passive_param);
  elem.addEventListener('touchcancel', onTouchChange, passive_param);
}

export function startup(_canvas, params) {
  canvas = _canvas;
  pointer_lock.startup(canvas, onPointerLockEnter);
  if (params.map_analog_to_dpad !== undefined) {
    map_analog_to_dpad = params.map_analog_to_dpad;
  }
  pad_to_touch = params.pad_to_touch;
  genAnalogMap();

  try {
    let opts = Object.defineProperty({}, 'passive', {
      get: function () {
        passive_param = { passive: false };
        return false;
      }
    });
    window.addEventListener('test', null, opts);
    window.removeEventListener('test', null, opts);
  } catch (e) {
    passive_param = false;
  }

  window.addEventListener('keydown', onKeyDown, false);
  window.addEventListener('keyup', onKeyUp, false);

  window.addEventListener('click', ignored, false);
  //window.addEventListener('click', eventlog, false);
  window.addEventListener('contextmenu', ignored, false);
  window.addEventListener('mousemove', onMouseMove, false);
  window.addEventListener('mousedown', onMouseDown, false);
  window.addEventListener('mouseup', onMouseUp, false);
  if (window.WheelEvent) {
    window.addEventListener('wheel', onWheel, passive_param);
  } else {
    window.addEventListener('DOMMouseScroll', onWheel, false);
    window.addEventListener('mousewheel', onWheel, false);
  }

  window.addEventListener('blur', onBlurOrFocus, false);
  window.addEventListener('focus', onBlurOrFocus, false);

  handleTouches(canvas);

  // For iOS, this is needed in test_fullscreen, but not here, for some reason
  //window.addEventListener('gesturestart', ignored, false);

  window.addEventListener('beforeunload', beforeUnload, false);
}


const DEADZONE = 0.26;
const DEADZONE_SQ = DEADZONE * DEADZONE;
const NUM_STICKS = 2;
const PAD_THRESHOLD = 0.35; // for turning analog motion into digital events

function getGamepadData(idx) {
  let gpd = gamepad_data[idx];
  if (!gpd) {
    gpd = gamepad_data[idx] = {
      id: idx,
      timestamp: 0,
      sticks: new Array(NUM_STICKS),
    };
    for (let ii = 0; ii < NUM_STICKS; ++ii) {
      gpd.sticks[ii] = vec2();
    }
    pad_states[idx] = {};
  }
  return gpd;
}

function updatePadState(gpd, ps, b, padcode) {
  if (b && !ps[padcode]) {
    ps[padcode] = DOWN_EDGE;
    onUserInput();
    if (touch_mode) {
      local_storage.set('touch_mode', false);
      touch_mode = false;
    }
    if (!pad_mode) {
      local_storage.setJSON('pad_mode', true);
      pad_mode = true;
    }
    if (padcode === pad_to_touch) {
      let touch_id = `g${gpd.id}`;
      if (touches[touch_id]) {
        setMouseToMid();
        v2copy(touches[touch_id].start_pos, mouse_pos);
      } else {
        touches[touch_id] = new TouchData(mouse_pos, false, 0, null);
      }
      touches[touch_id].down(null, true);
    }
  } else if (!b && ps[padcode]) {
    ps[padcode] = UP_EDGE;
    if (padcode === pad_to_touch) {
      let touch_id = `g${gpd.id}`;
      let touch_data = touches[touch_id];
      if (touch_data) {
        setMouseToMid();
        v2copy(touch_data.cur_pos, mouse_pos);
        registerMouseUpEdge(touch_data, engine.hrtime);
        touch_data.state = UP;
        touch_data.down_time += max(engine.hrtime - touch_data.origin_time, MIN_EVENT_TIME_DELTA);
      }
    }
  }
}

function gamepadUpdate() {
  let gamepads;
  try {
    gamepads = (navigator.gamepads ||
      navigator.webkitGamepads ||
      (navigator.getGamepads && navigator.getGamepads()) ||
      (navigator.webkitGetGamepads && navigator.webkitGetGamepads()));
  } catch (e) {
    // Firefox blocks gamepad access sometimes, just ignore it we can't access it
  }

  if (gamepads) {
    let numGamePads = gamepads.length;
    for (let ii = 0; ii < numGamePads; ii++) {
      let gamepad = gamepads[ii];
      if (!gamepad) {
        continue;
      }
      let gpd = getGamepadData(ii);
      let ps = pad_states[ii];
      // Update button states
      if (gpd.timestamp < gamepad.timestamp) {
        let buttons = gamepad.buttons;
        gpd.timestamp = gamepad.timestamp;

        let numButtons = buttons.length;
        for (let n = 0; n < numButtons; n++) {
          let value = buttons[n];
          if (typeof value === 'object') {
            value = value.value;
          }
          value = value > 0.5;
          updatePadState(gpd, ps, value, n);
        }
      }

      // Update axes states
      let axes = gamepad.axes;
      if (axes.length >= NUM_STICKS * 2) {
        for (let n = 0; n < NUM_STICKS; ++n) {
          let pair = gpd.sticks[n];
          v2set(pair, axes[n*2], -axes[n*2 + 1]);
          let magnitude = v2lengthSq(pair);
          if (magnitude > DEADZONE_SQ) {
            magnitude = sqrt(magnitude);

            // Normalize lX and lY
            v2scale(pair, pair, 1 / magnitude);

            // Clip the magnitude at its max possible value
            magnitude = min(magnitude, 1);

            // Adjust magnitude relative to the end of the dead zone
            magnitude = ((magnitude - DEADZONE) / (1 - DEADZONE));

            v2scale(pair, pair, magnitude);
          } else {
            v2set(pair, 0, 0);
          }

          // Apply "movement" to drag events
          if (n <= 1 && pad_to_touch !== undefined) {
            let touch_data = touches[`g${gpd.id}`];
            if (touch_data) {
              v2scale(temp_delta, pair, engine.frame_dt);
              v2add(touch_data.delta, touch_data.delta, temp_delta);
              touch_data.total += abs(temp_delta[0]) + abs(temp_delta[1]);
              setMouseToMid();
              v2copy(touch_data.cur_pos, mouse_pos);
            }
          }
        }

        // Calculate virtual directional buttons
        updatePadState(gpd, ps, gpd.sticks[0][0] < -PAD_THRESHOLD, PAD.LSTICK_LEFT);
        updatePadState(gpd, ps, gpd.sticks[0][0] > PAD_THRESHOLD, PAD.LSTICK_RIGHT);
        updatePadState(gpd, ps, gpd.sticks[0][1] < -PAD_THRESHOLD, PAD.LSTICK_DOWN);
        updatePadState(gpd, ps, gpd.sticks[0][1] > PAD_THRESHOLD, PAD.LSTICK_UP);

        updatePadState(gpd, ps, gpd.sticks[1][0] < -PAD_THRESHOLD, PAD.RSTICK_LEFT);
        updatePadState(gpd, ps, gpd.sticks[1][0] > PAD_THRESHOLD, PAD.RSTICK_RIGHT);
        updatePadState(gpd, ps, gpd.sticks[1][1] < -PAD_THRESHOLD, PAD.RSTICK_DOWN);
        updatePadState(gpd, ps, gpd.sticks[1][1] > PAD_THRESHOLD, PAD.RSTICK_UP);
      }
    }
  }
}

export function fakeTouchEvent(is_down) {
  const touch_id = 'faketouch';
  let touch_data = touches[touch_id];
  if (touch_data && !is_down) {
    setMouseToMid();
    v2copy(touch_data.cur_pos, mouse_pos);
    registerMouseUpEdge(touch_data, engine.hrtime);
    touch_data.state = UP;
    touch_data.down_time += max(engine.hrtime - touch_data.origin_time, MIN_EVENT_TIME_DELTA);
  } else if (!touch_data && is_down) {
    setMouseToMid();
    touches[touch_id] = new TouchData(mouse_pos, false, 0, null);
  }
}

export function tickInput() {
  // browser frame has occurred since the call to endFrame(),
  // we should now have `touches` and `key_state` populated with edge events
  if (movement_questionable_frames) {
    --movement_questionable_frames;
  }

  // update timing of key down states
  let hrtime = engine.hrtime;
  for (let code in key_state_new) {
    let ks = key_state_new[code];
    if (ks.state === DOWN) {
      ks.down_time += max(hrtime - ks.origin_time, MIN_EVENT_TIME_DELTA);
      // assert(hrtime >= ks.origin_time); - should be true, but often isn't
      ks.origin_time = hrtime;
    }
  }

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (touch_data.state === DOWN) {
      touch_data.down_time += max(hrtime - touch_data.origin_time, MIN_EVENT_TIME_DELTA);
      // assert(hrtime >= touch_data.origin_time); - should be true, but often isn't
      touch_data.origin_time = hrtime;
    }
  }

  mouse_over_captured = false;
  gamepadUpdate();
  in_event.topOfFrame();
  ctrl_checked = false;
  if (touches[pointerlock_touch_id] && !pointerLocked()) {
    pointerLockExit();
  }
  no_active_touches = empty(touches);
}

function endFrameTickMap(map) {
  Object.keys(map).forEach((keycode) => {
    switch (map[keycode]) {
      case DOWN_EDGE:
        map[keycode] = DOWN;
        break;
      case UP_EDGE:
        delete map[keycode];
        break;
      default:
    }
  });
}
export function endFrame(skip_mouse) {
  for (let code in key_state_new) {
    let ks = key_state_new[code];
    if (ks.state === UP) {
      key_state_new[code] = null;
      delete key_state_new[code];
    } else {
      ks.up_edge = 0;
      ks.down_edge = 0;
      ks.down_time = 0;
    }
  }

  pad_states.forEach(endFrameTickMap);
  if (!skip_mouse) {
    for (let touch_id in touches) {
      let touch_data = touches[touch_id];
      if (touch_data.state === UP) {
        // Manually null out touches[touch_id] - some Chrome optimizer bug causes
        // callers to later get this old value (instead of the newly added on with
        // the same ID) unless we null it out (then they seem to get the new one).
        touches[touch_id] = null;
        delete touches[touch_id];
      } else {
        touch_data.delta[0] = touch_data.delta[1] = 0;
        touch_data.dispatched = false;
        touch_data.dispatched_drag = false;
        touch_data.dispatched_drag_over = false;
        if (touch_data.drag_payload_frame === engine.frame_index - 2) {
          // Clear this after an entire frame of not being set (usually, things
          // on the next frame will need to get the payload that was set later
          // in the previous frame)
          touch_data.drag_payload = null;
        }
        touch_data.up_edge = 0;
        touch_data.down_edge = 0;
        touch_data.down_time = 0;
      }
    }
    wheel_events.length = 0;
    input_eaten_mouse = false;
    mouse_moved = false;
    mouse_button_had_edge = false;
    mouse_button_had_up_edge = false;
  }
  input_eaten_kb = false;
}

export function tickInputInactive() {
  in_event.topOfFrame();
  ctrl_checked = false;
  endFrame();
}

export function eatAllInput(skip_mouse) {
  // destroy touches, remove all down and up edges
  endFrame(skip_mouse);
  if (!skip_mouse) {
    mouse_over_captured = true;
    input_eaten_mouse = true;
  }
  input_eaten_kb = true;
}

export function eatAllKeyboardInput() {
  eatAllInput(true);
}

// returns position mapped to current camera view
export function mousePos(dst) {
  dst = dst || vec2();
  camera2d.domToVirtual(dst, mouse_pos);
  return dst;
}

export function mouseDomPos() {
  return mouse_pos;
}

export function mouseMoved() {
  return mouse_moved;
}

export function mouseButtonHadEdge() {
  return mouse_button_had_edge;
}

export function mouseButtonHadUpEdge() {
  return mouse_button_had_up_edge;
}

const full_screen_pos_param = {};
function mousePosParamUnique(param) {
  param = param || full_screen_pos_param;
  let pos_param = param.mouse_pos_param;
  if (!pos_param) {
    pos_param = param.mouse_pos_param = {};
  }
  pos_param.x = param.x === undefined ? camera2d.x0Real() : param.x;
  pos_param.y = param.y === undefined ? camera2d.y0Real() : param.y;
  pos_param.w = param.w === undefined ? camera2d.wReal() : param.w;
  pos_param.h = param.h === undefined ? camera2d.hReal() : param.h;
  pos_param.button = param.button === undefined ? ANY : param.button;
  return pos_param;
}

let pos_param_temp = {};
function mousePosParam(param) {
  param = param || {};
  pos_param_temp.x = param.x === undefined ? camera2d.x0Real() : param.x;
  pos_param_temp.y = param.y === undefined ? camera2d.y0Real() : param.y;
  pos_param_temp.w = param.w === undefined ? camera2d.wReal() : param.w;
  pos_param_temp.h = param.h === undefined ? camera2d.hReal() : param.h;
  pos_param_temp.button = param.button === undefined ? ANY : param.button;
  return pos_param_temp;
}

let check_pos = vec2();
function checkPos(pos, param) {
  if (!camera2d.domToVirtual(check_pos, pos)) {
    return false;
  }
  return check_pos[0] >= param.x && (param.w === Infinity || check_pos[0] < param.x + param.w) &&
    check_pos[1] >= param.y && (param.h === Infinity || check_pos[1] < param.y + param.h);
}

function wasDoubleClick(pos_param) {
  if (engine.hrtime - last_up_edges[0].timestamp > settings.double_click_time) {
    return false;
  }
  return checkPos(last_up_edges[0].pos, pos_param);
}

export function mouseWheel(param) {
  if (input_eaten_mouse || !wheel_events.length) {
    return 0;
  }
  param = param || {};
  let pos_param = mousePosParam(param);
  let ret = 0;
  for (let ii = 0; ii < wheel_events.length; ++ii) {
    let data = wheel_events[ii];
    if (data.dispatched) {
      continue;
    }
    if (checkPos(data.pos, pos_param)) {
      ret += data.delta;
      data.dispatched = true;
    }
  }
  return ret;
}

export function mouseOverCaptured() {
  mouse_over_captured = true;
}

export function mouseOver(param) {
  profilerStartFunc();
  param = param || {};
  let pos_param = mousePosParamUnique(param);
  spotMouseoverHook(pos_param, param);
  if (mouse_over_captured || pointerLocked() && !param.allow_pointerlock) {
    profilerStopFunc();
    return false;
  }

  // eat mouse up/down/drag events
  if (!param.peek && !param.peek_touch) {
    for (let id in touches) {
      let touch = touches[id];
      if (checkPos(touch.cur_pos, pos_param)) {
        touch.down_edge = 0;
        touch.up_edge = 0;
        if (!param || !param.drag_target) {
          touch.dispatched = true;
        }
      }
    }
  }

  let ret = false;
  if (checkPos(mouse_pos, pos_param)) {
    if (!param.peek && !param.peek_over) {
      mouse_over_captured = true;
    }
    ret = true;
  }
  profilerStopFunc();
  return ret;
}

export function mouseDownAnywhere(button) {
  if (input_eaten_mouse) {
    return false;
  }
  if (button === undefined) {
    button = ANY;
  }

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (touch_data.state !== DOWN ||
      !(button === ANY || button === touch_data.button)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

export function mouseDownMidClick(param) {
  if (input_eaten_mouse || no_active_touches) {
    return false;
  }
  // Same logic as mouseUpEdge()
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;
  let max_click_dist = param.max_dist || 50; // TODO: relative to camera distance?

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (touch_data.state !== DOWN ||
      !(button === ANY || button === touch_data.button) ||
      touch_data.total > max_click_dist
    ) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      return true;
    }
  }

  return false;
}

export function mouseDownOverBounds(param) {
  if (input_eaten_mouse || no_active_touches) {
    return false;
  }
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (touch_data.state !== DOWN ||
      !(button === ANY || button === touch_data.button)
    ) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      return true;
    }
  }

  return false;
}

export function mousePosIsTouch() {
  return mouse_pos_is_touch;
}

export function numTouches() {
  return Object.keys(touches).length;
}

export function keyDown(keycode) {
  if (keycode === KEYS.CTRL) {
    ctrl_checked = true;
  }
  if (input_eaten_kb) {
    return 0;
  }
  let ks = key_state_new[keycode];
  if (!ks) {
    return 0;
  }
  if (ks.state === DOWN) {
    assert(ks.down_time); // Will fire if we call keyDown() before tickInput()
  }
  return ks.down_time;
}
export function keyDownEdge(keycode, opts) {
  if (input_eaten_kb) {
    return 0;
  }

  if (opts && opts.in_event_cb) {
    in_event.on('keydown', keycode, opts.in_event_cb);
  }

  let ks = key_state_new[keycode];
  if (!ks) {
    return 0;
  }
  let r = ks.down_edge;
  ks.down_edge = 0;
  return r;
}
export function keyUpEdge(keycode, opts) {
  if (input_eaten_kb) {
    return 0;
  }

  if (opts && opts.in_event_cb) {
    in_event.on('keyup', keycode, opts.in_event_cb);
  }

  let ks = key_state_new[keycode];
  if (!ks) {
    return 0;
  }
  let r = ks.up_edge;
  ks.up_edge = 0;
  return r;
}

export function padGetAxes(out, stickindex, padindex) {
  assert(stickindex >= 0 && stickindex < NUM_STICKS);
  if (padindex === undefined) {
    let sub = vec2();
    v2set(out, 0, 0);
    for (let ii = 0; ii < gamepad_data.length; ++ii) {
      padGetAxes(sub, stickindex, ii);
      v2add(out, out, sub);
    }
    return;
  }
  let sticks = getGamepadData(padindex).sticks;
  v2copy(out, sticks[stickindex]);
}

function padButtonDownInternal(gpd, ps, padcode) {
  if (ps[padcode]) {
    return engine.frame_dt;
  }
  return 0;
}
function padButtonDownEdgeInternal(gpd, ps, padcode) {
  if (ps[padcode] === DOWN_EDGE) {
    ps[padcode] = DOWN;
    return 1;
  }
  return 0;
}
function padButtonUpEdgeInternal(gpd, ps, padcode) {
  if (ps[padcode] === UP_EDGE) {
    delete ps[padcode];
    return 1;
  }
  return 0;
}

function padButtonShared(fn, padcode, padindex) {
  assert(padcode !== undefined);
  let r = 0;
  // Handle calling without a specific pad index
  if (padindex === undefined) {
    for (let ii = 0; ii < pad_states.length; ++ii) {
      r += padButtonShared(fn, padcode, ii);
    }
    return r;
  }

  if (input_eaten_mouse) {
    return 0;
  }
  let gpd = gamepad_data[padindex];
  if (!gpd) {
    return 0;
  }
  let ps = pad_states[padindex];

  let am = ANALOG_MAP[padcode];
  if (am) {
    for (let ii = 0; ii < am.length; ++ii) {
      r += fn(gpd, ps, am[ii]) || 0;
    }
  }
  r += fn(gpd, ps, padcode);
  return r;
}
export function padButtonDown(padcode, padindex) {
  return padButtonShared(padButtonDownInternal, padcode, padindex);
}
export function padButtonDownEdge(padcode, padindex) {
  return padButtonShared(padButtonDownEdgeInternal, padcode, padindex);
}
export function padButtonUpEdge(padcode, padindex) {
  return padButtonShared(padButtonUpEdgeInternal, padcode, padindex);
}

let start_pos = vec2();
let cur_pos = vec2();
let delta = vec2();

export function mouseUpEdge(param) {
  param = param || {};
  if (input_eaten_mouse || !param.in_event_cb && no_active_touches) {
    return null;
  }
  let pos_param = mousePosParam(param);
  let button = pos_param.button;
  let max_click_dist = param.max_dist || 50; // TODO: relative to camera distance?
  let dragged_too_far = false;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (touch_data.total > max_click_dist) {
      // Do *not* register in_event_cb, would fire even when we would disregard this click
      dragged_too_far = true;
      continue;
    }
    if (!touch_data.up_edge) {
      continue;
    }
    if (touch_data.long_press_dispatched) {
      // If this touch has already triggered a long-press, do not additionally trigger a click
      continue;
    }
    if (!(button === ANY || button === touch_data.button)) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      if (!param.peek) {
        touch_data.up_edge = 0;
      }
      return {
        button: touch_data.button,
        pos: check_pos.slice(0),
        start_time: touch_data.start_time,
        was_double_click: wasDoubleClick(pos_param),
      };
    }
  }

  if (param.in_event_cb && !mouse_over_captured && !dragged_too_far) {
    // TODO: Maybe need to also pass along earlier exclusions?  Working okay for now though.
    if (!param.phys) {
      param.phys = {};
    }
    param.phys.button = typeof param.in_event_button === 'number' ? param.in_event_button : button;
    camera2d.virtualToDomPosParam(param.phys, pos_param);
    in_event.on('mouseup', param.phys, param.in_event_cb);
  }
  return null;
}

export function mouseDownEdge(param) {
  param = param || {};
  if (input_eaten_mouse || !param.in_event_cb && no_active_touches) {
    return null;
  }
  let pos_param = mousePosParam(param);
  let button = pos_param.button;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (!touch_data.down_edge ||
      !(button === ANY || button === touch_data.button)
    ) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      if (!param.peek) {
        touch_data.down_edge = 0;
      }
      return {
        button: touch_data.button,
        pos: check_pos.slice(0),
        start_time: touch_data.start_time,
      };
    }
  }

  if (param.in_event_cb && !mouse_over_captured) {
    // TODO: Maybe need to also pass along earlier exclusions?  Working okay for now though.
    if (!param.phys) {
      param.phys = {};
    }
    param.phys.button = button;
    camera2d.virtualToDomPosParam(param.phys, pos_param);
    in_event.on('mousedown', param.phys, param.in_event_cb);
  }
  return null;
}

// Completely consume any clicks or drags coming from a mouse down event in this
// area - used to catch focus leaving an edit box without wanting to do what
// a click would normally do.
export function mouseConsumeClicks(param) {
  if (no_active_touches) {
    return;
  }
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;
  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    // Skipping those that already dispatched a drag this frame, must have been handled, do not consume it!
    if (!(button === ANY || button === touch_data.button) || touch_data.dispatched_drag) {
      continue;
    }
    if (checkPos(touch_data.start_pos, pos_param)) {
      touch_data.down_edge = 0;
      // Set start pos so that it will not pass checkPos
      touch_data.start_pos[0] = touch_data.start_pos[1] = Infinity;
      // Set .total so that mouseUpEdge will not detect it as a click
      touch_data.total = Infinity;
    }
  }
}

export function drag(param) {
  if (input_eaten_mouse || no_active_touches) {
    return null;
  }
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;
  let min_dist = param.min_dist || 0;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (!(button === ANY || button === touch_data.button) || touch_data.dispatched_drag ||
      touch_id === param.not_touch_id
    ) {
      continue;
    }
    if (checkPos(touch_data.start_pos, pos_param)) {
      camera2d.domDeltaToVirtual(delta, [touch_data.total/2, touch_data.total/2]);
      let total = delta[0] + delta[1];
      if (total < min_dist) {
        continue;
      }
      if (!param.peek) {
        touch_data.dispatched_drag = true;
      }
      let is_down_edge = touch_data.down_edge;
      if (param.eat_clicks) {
        touch_data.down_edge = touch_data.up_edge = 0;
      }
      if (param.payload) {
        touch_data.drag_payload = param.payload;
        touch_data.drag_payload_frame = engine.frame_index;
      }
      camera2d.domToVirtual(start_pos, touch_data.start_pos);
      camera2d.domToVirtual(cur_pos, touch_data.cur_pos);
      camera2d.domDeltaToVirtual(delta, touch_data.delta);
      return {
        cur_pos,
        start_pos,
        delta, // this frame's delta
        total, // total (linear) distance dragged
        button: touch_data.button,
        touch: touch_data.touch,
        start_time: touch_data.start_time,
        is_down_edge,
        down_time: touch_data.down_time,
        touch_id,
      };
    }
  }
  return null;
}

// a lot like drag(), refactor to share more?
export function longPress(param) {
  if (input_eaten_mouse || no_active_touches) {
    return null;
  }
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;
  let max_dist = param.long_press_max_dist || 50;
  let min_time = param.min_time || 500;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (!(button === ANY || button === touch_data.button) || touch_data.long_press_dispatched) {
      continue;
    }
    if (checkPos(touch_data.start_pos, pos_param)) {
      camera2d.domDeltaToVirtual(delta, [touch_data.total/2, touch_data.total/2]);
      let total = delta[0] + delta[1];
      if (total > max_dist) {
        continue;
      }
      let time = Date.now() - touch_data.start_time;
      if (time < min_time) {
        continue;
      }
      if (!param.peek) {
        // ? touch_data.dispatched = true;
        touch_data.long_press_dispatched = true;
      }
      let is_down_edge = touch_data.down_edge;
      if (param.eat_clicks) {
        touch_data.down_edge = touch_data.up_edge = 0;
      }
      camera2d.domToVirtual(start_pos, touch_data.start_pos);
      camera2d.domToVirtual(cur_pos, touch_data.cur_pos);
      camera2d.domDeltaToVirtual(delta, touch_data.delta);
      return {
        long_press: true,
        cur_pos,
        start_pos,
        delta, // this frame's delta
        total, // total (linear) distance dragged
        button: touch_data.button,
        touch: touch_data.touch,
        start_time: touch_data.start_time,
        is_down_edge,
        down_time: touch_data.down_time,
      };
    }
  }
  return null;
}

export function dragDrop(param) {
  if (input_eaten_mouse || no_active_touches) {
    return null;
  }
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    // Maybe touch_data.dispatched_drag_over instead/as well?
    if (!(button === ANY || button === touch_data.button) || touch_data.dispatched || !touch_data.drag_payload) {
      continue;
    }
    if (!touch_data.up_edge) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      if (!param.peek) {
        // don't want the source (possibly called later this frame) to still think it's dragging
        touch_data.dispatched_drag_over = true;
        touch_data.dispatched_drag = true;
        touch_data.dispatched = true;
      }
      return { drag_payload: touch_data.drag_payload };
    }
  }
  return null;
}

export function dragOver(param) {
  if (input_eaten_mouse || no_active_touches) {
    return null;
  }
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (!(button === ANY || button === touch_data.button) ||
      touch_data.dispatched_drag_over ||
      !touch_data.drag_payload
    ) {
      continue;
    }
    if (touch_data.state !== DOWN) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      // Separate 'dispatched' for dragOver (target) and drag (source) - they both need one dispatch per frame
      if (!param.peek) {
        touch_data.dispatched_drag_over = true;
      }
      camera2d.domToVirtual(cur_pos, touch_data.cur_pos);
      return {
        cur_pos,
        drag_payload: touch_data.drag_payload
      };
    }
  }
  return null;
}
