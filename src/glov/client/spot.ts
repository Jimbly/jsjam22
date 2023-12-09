// eslint-disable-next-line import/order
import {
  BUTTON_ANY,
  ButtonIndex,
} from './input_constants';

export const SPOT_NAVTYPE_SIMPLE = 0; // just arrows
export const SPOT_NAVTYPE_EXTENDED = 1; // also WASD, numpad, etc
export type SpotNavtypeEnum = typeof SPOT_NAVTYPE_SIMPLE | typeof SPOT_NAVTYPE_EXTENDED;

export const SPOT_NAV_NONE = 0;
export const SPOT_NAV_LEFT = 1;
export const SPOT_NAV_UP = 2;
export const SPOT_NAV_RIGHT = 3;
export const SPOT_NAV_DOWN = 4;
export const SPOT_NAV_NEXT = 5;
export const SPOT_NAV_PREV = 6;
const SPOT_NAV_MAX = 7;

type SpotNavEnum = typeof SPOT_NAV_LEFT |
  typeof SPOT_NAV_UP |
  typeof SPOT_NAV_RIGHT |
  typeof SPOT_NAV_DOWN |
  typeof SPOT_NAV_NEXT |
  typeof SPOT_NAV_PREV;
type SpotNavEnumOrNone = SpotNavEnum | typeof SPOT_NAV_NONE;

export const SPOT_STATE_REGULAR = 1;
export const SPOT_STATE_DOWN = 2;
export const SPOT_STATE_FOCUSED = 3;
export const SPOT_STATE_DISABLED = 4;
export type SpotStateEnum = typeof SPOT_STATE_REGULAR |
  typeof SPOT_STATE_DOWN |
  typeof SPOT_STATE_FOCUSED |
  typeof SPOT_STATE_DISABLED;


type SpotCustomNavTarget = null | // indicates the spot should do no navigation, but allow the caller to handle
  undefined | // indicates navigation should target nothing (keys not consumed)
  string; // the key of a custom element

type SpotCustomNav = Partial<Record<SpotNavEnum, SpotCustomNavTarget>>;


// See SPOT_DEFAULT for defaults
export interface SpotParamBase {
  key?: string; // defaults to from x,y otherwise
  disabled: boolean;
  in_event_cb: EventCallback | null; // for clicks and key presses
  drag_target: boolean; // receive dragDrop events
  drag_over: boolean; // consume dragOver events
  button: ButtonIndex; // respond to which mouse button
  is_button: boolean; // can be activated/clicked/etc
  button_long_press: boolean; // detect long press differently than a regular click/tap
  pad_focusable: boolean; // is a target for keyboard/gamepad focus; set to false if only accessible via hotkey/button
  spatial_focus: boolean; // if pad_focusable: can be focused spatialy (via d-pad/etc), otherwise only through tab
  auto_focus: boolean; // if this spot is new this frame, and doing pad (not mouse/touch) focusing, automatically focus
  long_press_focuses: boolean; // a long press will focus an element (triggering tooltips, etc, on touch devices)
  sound_button: string | null; // when activated
  sound_rollover: string | null; // when mouse movement triggers focus
  touch_focuses: boolean; // first touch focuses (on touch devices), showing tooltip, etc, second activates the button
  disabled_focusable: boolean; // allow focusing even if disabled (e.g. to show tooltip)
  hotkey: number | null; // optional keyboard hotkey
  hotkeys: number[] | null; // optional keyboard hotkeys
  hotpad: number | null; // optional gamepad button
  // (silently) ensures we have the focus this frame (e.g. if dragging a slider, the slider
  // should retain focus even without mouseover)
  focus_steal: boolean;
  sticky_focus: boolean; // focus is not lost due to mouseover elsewhere
  // optional map of SPOT_NAV_* to either:
  //   null: indicates the spot should not do navigation, but allow the caller to handle (sets param.out.nav)
  //   undefined: indicates navigation should target nothing (and those keys will not be consumed)
  //   a string key: a custom element to target with navigation
  custom_nav: SpotCustomNav | null;
}

export const SPOT_DEFAULT = {
  key: undefined, // defaults to from x,y
  disabled: false,
  in_event_cb: null,
  drag_target: false,
  drag_over: false,
  button: BUTTON_ANY,
  is_button: false,
  button_long_press: false,
  pad_focusable: true,
  spatial_focus: true,
  auto_focus: false,
  long_press_focuses: true,
  sound_button: 'button_click',
  sound_rollover: 'rollover',
  touch_focuses: false,
  disabled_focusable: true,
  hotkey: null,
  hotkeys: null,
  hotpad: null,
  focus_steal: false,
  sticky_focus: false,
  custom_nav: null,
};

export const SPOT_DEFAULT_BUTTON: SpotParamBase = {
  ...SPOT_DEFAULT,
  is_button: true,
};

export const SPOT_DEFAULT_BUTTON_DISABLED: SpotParamBase = {
  ...SPOT_DEFAULT,
  disabled: true,
  sound_rollover: null,
};

export const SPOT_DEFAULT_BUTTON_DRAW_ONLY: SpotParamBase = {
  // Matches previous { draw_only: true, draw_only_mouseover: true, disabled_mouseover: true } option to ui.buttonShared
  ...SPOT_DEFAULT,
  pad_focusable: false,
};

export const SPOT_DEFAULT_LABEL: SpotParamBase = {
  ...SPOT_DEFAULT,
  sound_rollover: null,
  touch_focuses: true, // usually want this?
};

type SpotKeyableKeyed = {
  key: string;
};
type SpotKeyableAuto = Point2D;

export type SpotKeyable = (SpotKeyableKeyed | SpotKeyableAuto) & {
  // computed
  key_computed?: string;
};

export type SpotRet = {
  focused: boolean; // focused by any means
  kb_focused: boolean; // focused for the purpose of receiving keyboard input (focused and no other sticky focus)
  spot_state: SpotStateEnum;
  ret: number; // if `param.is_button` and was activated (0/1 or more if clicked multiple times in a frame)
  long_press?: boolean; // if button_long_press and ret and was a long press, set to true
  button?: number; // if ret, set to mouse button used to click it
  pos?: Vec2 | null | undefined; // if ret, set to position of the click
  double_click?: boolean; // if ret, set to true if it was a double click/tap/button press/etc
  drag_drop?: unknown | null; // if drag_target and a drop happened, contains dragDrop event { drag_payload }
  nav?: SpotNavEnumOrNone; // if custom_nav, and the user navigated, set to the navigation event
  allow_focus?: boolean; // set and used internally if this spot is allowed to be focused
};

type SpotComputedFields = {
  // internal run-time fields that might be useful to callers
  key_computed?: string;
  dom_pos?: Box;
  out?: SpotRet;
};

export interface SpotParam extends Partial<SpotParamBase>, Box, SpotComputedFields {
  def: SpotParamBase; // inherit all undefined SpotParamBase members from this
  tooltip?: TooltipValue | null;
  hook?: HookList;
}

export interface SpotSubParam extends Box, SpotComputedFields {
  key: string;
}

interface SpotInternal extends SpotParam {
  // internal run-time fields
  dom_pos: Box;
  key_computed: string;
  sub_rect: SpotSubInternal | null;
  out: SpotRet;

  // only on fake Spots from spotMouseoverHook
  only_mouseover?: true;
  spot_debug_ignore?: boolean;
}

interface SpotSubInternal extends SpotSubParam {
  // internal run-time fields
  dom_pos: Box;
  key_computed: string;
  sub_rect: SpotSubInternal | null;

  is_sub_rect: true;
  is_empty_sub_rect: boolean;
}

type SpotListElem = SpotInternal | SpotSubInternal;

// TODO: move to input.js when converted to TypeScript
type MouseOverParam = {
  peek?: boolean;
  eat_clicks?: boolean;
  spot_debug_ignore?: boolean;
};

import assert from 'assert';
const { abs, max } = Math;
import verify from 'glov/common/verify';
import { Vec2, Vec4 } from 'glov/common/vmath.js';
import * as camera2d from './camera2d.js';
import * as engine from './engine.js';
import {
  FontStyle,
  fontStyle,
} from './font.js';
import { Box, Point2D } from './geom_types';
import {
  KEYS,
  PAD,
  dragDrop,
  dragOver,
  inputClick,
  inputEatenMouse,
  inputTouchMode,
  keyDown,
  keyDownEdge,
  longPress,
  mouseButtonHadEdge,
  mouseDomPos,
  mouseDownAnywhere,
  mouseDownEdge,
  mouseDownMidClick,
  mouseMoved,
  mouseOver,
  mousePosIsTouch,
  padButtonDownEdge,
} from './input.js';
import * as settings from './settings.js';
import * as ui from './ui.js';
import {
  EventCallback,
  HookList,
  TooltipBoxParam,
  TooltipValue,
  drawLine,
  drawRect,
  drawTooltipBox,
  playUISound,
} from './ui.js';
const { checkHooks } = ui.internal;

let focus_sub_rect = null as (SpotSubInternal | null);
let focus_sub_rect_elem = null as (SpotInternal | null);
let sub_stack: [typeof focus_sub_rect, typeof focus_sub_rect_elem][] = [];
let focus_key: string | null = null;
// sticky focus: used for edit boxes so that they do not lose focus even when
//   mousing over other elements (those elements become the temporary `nonsticky`
//   focus.
let focus_is_sticky = false;
let focus_key_nonsticky: string | null = null;
let focus_pos: Box = { x: 0, y: 0, w: 0, h: 0 };
let last_frame_spots: SpotListElem[] = [];
let frame_spots: SpotListElem[] = [];
let focus_next: (SpotInternal|null|undefined)[] = []; // indexed by SPOT_NAV_*
let focus_next_via: (SpotSubInternal|undefined)[] = []; // just for spotDebug
let frame_autofocus_spots: Partial<Record<string, SpotInternal>> = {};
let last_frame_autofocus_spots: typeof frame_autofocus_spots = {};
// pad_mode: really "non-mouse-mode" - touch triggers this in various situations
// non-pad_mode (mouse mode) requires constant mouse over state to maintain focus
let pad_mode = false;
let suppress_pad = false;
let async_activate_key: string | null = null;

function isSubRect(area: SpotListElem): area is SpotSubInternal {
  return (area as SpotSubInternal).is_sub_rect;
}

export function spotPadMode(): boolean {
  return pad_mode;
}

export function spotSetPadMode(new_mode: boolean): void {
  pad_mode = new_mode;
}

export function spotlog(...args: unknown[]): void {
  // const { getFrameIndex } = require('./engine.js'); // eslint-disable-line global-require
  // console.log(`spotlog(${getFrameIndex()}): `, ...args);
}

export function spotGet(key: string, last_frame: boolean): SpotListElem | null {
  let frames = last_frame ? last_frame_spots : frame_spots;
  let key_computed_spot = null;
  // Match first by key, and afterwards by key_computed
  for (let ii = 0; ii < frames.length; ++ii) {
    if (key === frames[ii].key) {
      return frames[ii];
    }
    if (key === frames[ii].key_computed) {
      key_computed_spot = frames[ii];
    }
  }
  return key_computed_spot;
}

export function spotKey(param: SpotKeyable): string {
  if (param.key_computed) {
    // already computed, early this frame, or in a persistent object, use it
    if (!engine.defines.SPOT_DEBUG) {
      return param.key_computed;
    }
  }
  profilerStartFunc();
  let key = (param as SpotKeyableKeyed).key ||
    (`${focus_sub_rect ? focus_sub_rect.key_computed : ''}_` +
    `${(param as SpotKeyableAuto).x}_${(param as SpotKeyableAuto).y}`);
  if (param.key_computed) {
    // ensure two different spots on the same frame are not using the same param object
    assert.equal(param.key_computed, key);
  } else {
    param.key_computed = key;
  }
  profilerStopFunc();
  return param.key_computed;
}

function spotFocusSet(param: SpotInternal, from_mouseover: boolean, force: boolean, log: string): boolean {
  if (from_mouseover && (!mouseMoved() || mousePosIsTouch())) {
    return false;
  }
  const def = param.def || SPOT_DEFAULT;
  const sound_rollover = param.sound_rollover === undefined ? def.sound_rollover : param.sound_rollover;
  const key = param.key_computed || spotKey(param);
  const use_nonsticky = focus_is_sticky && !force && from_mouseover && key !== focus_key;
  const key_prev = use_nonsticky ? focus_key_nonsticky : focus_key;
  if ((sound_rollover || !from_mouseover) && key_prev !== key) {
    playUISound(sound_rollover || SPOT_DEFAULT.sound_rollover);
  }
  if (key_prev !== key || pad_mode !== !from_mouseover) {
    spotlog('spotFocusSet', key, log, from_mouseover ? '' : 'pad_mode', use_nonsticky ? 'nonsticky' : '');
  }
  pad_mode = !from_mouseover;
  if (use_nonsticky) {
    focus_key_nonsticky = key;
  } else {
    focus_key = key;
    const sticky_focus = param.sticky_focus === undefined ? def.sticky_focus : param.sticky_focus;
    focus_is_sticky = sticky_focus;
    focus_key_nonsticky = null;
  }
  assert(param.dom_pos);
  return true;
}

export function spotUnfocus(): void {
  spotlog('spotUnfocus');
  focus_key = null;
  focus_is_sticky = false;
  focus_key_nonsticky = null;
  pad_mode = false;
}

type SpotNavKeysEntry = {
  keys?: number[];
  pads?: number[];
  shift_keys?: number[];
  unshift_keys?: number[];
};
type SpotNavKeys = Record<SpotNavEnum, SpotNavKeysEntry>;
const spot_nav_keys_base: SpotNavKeys = {
  [SPOT_NAV_LEFT]: {
    pads: [PAD.LEFT],
  },
  [SPOT_NAV_UP]: {
    pads: [PAD.UP],
  },
  [SPOT_NAV_RIGHT]: {
    pads: [PAD.RIGHT],
  },
  [SPOT_NAV_DOWN]: {
    pads: [PAD.DOWN],
  },
  [SPOT_NAV_PREV]: {
    shift_keys: [KEYS.TAB],
    pads: [PAD.LEFT_BUMPER],
  },
  [SPOT_NAV_NEXT]: {
    pads: [PAD.RIGHT_BUMPER],
    unshift_keys: [KEYS.TAB],
  },
};
const spot_nav_keys_simple: SpotNavKeys = {
  [SPOT_NAV_LEFT]: {
    keys: [KEYS.LEFT],
    pads: spot_nav_keys_base[SPOT_NAV_LEFT].pads,
  },
  [SPOT_NAV_UP]: {
    keys: [KEYS.UP],
    pads: spot_nav_keys_base[SPOT_NAV_UP].pads,
  },
  [SPOT_NAV_RIGHT]: {
    keys: [KEYS.RIGHT],
    pads: spot_nav_keys_base[SPOT_NAV_RIGHT].pads,
  },
  [SPOT_NAV_DOWN]: {
    keys: [KEYS.DOWN],
    pads: spot_nav_keys_base[SPOT_NAV_DOWN].pads,
  },
  [SPOT_NAV_PREV]: spot_nav_keys_base[SPOT_NAV_PREV],
  [SPOT_NAV_NEXT]: spot_nav_keys_base[SPOT_NAV_NEXT],
};
const spot_nav_keys_extended: SpotNavKeys = {
  [SPOT_NAV_LEFT]: {
    keys: spot_nav_keys_simple[SPOT_NAV_LEFT].keys!.concat([KEYS.A, KEYS.NUMPAD4]),
    pads: spot_nav_keys_simple[SPOT_NAV_LEFT].pads,
  },
  [SPOT_NAV_UP]: {
    keys: spot_nav_keys_simple[SPOT_NAV_UP].keys!.concat([KEYS.W, KEYS.NUMPAD8]),
    pads: spot_nav_keys_simple[SPOT_NAV_UP].pads,
  },
  [SPOT_NAV_RIGHT]: {
    keys: spot_nav_keys_simple[SPOT_NAV_RIGHT].keys!.concat([KEYS.D, KEYS.NUMPAD6]),
    pads: spot_nav_keys_simple[SPOT_NAV_RIGHT].pads,
  },
  [SPOT_NAV_DOWN]: {
    keys: spot_nav_keys_simple[SPOT_NAV_DOWN].keys!.concat([KEYS.S, KEYS.NUMPAD5, KEYS.NUMPAD2]),
    pads: spot_nav_keys_simple[SPOT_NAV_DOWN].pads,
  },
  [SPOT_NAV_PREV]: spot_nav_keys_base[SPOT_NAV_PREV],
  [SPOT_NAV_NEXT]: spot_nav_keys_base[SPOT_NAV_NEXT],
};
function keyDownShifted(key: number): boolean {
  return keyDown(KEYS.SHIFT) && keyDownEdge(key);
}
function keyDownUnshifted(key: number): boolean {
  return !keyDown(KEYS.SHIFT) && keyDownEdge(key);
}
function compileSpotNavKeysEntry(entry: SpotNavKeysEntry): () => boolean {
  let fns: ((() => boolean) | (() => number))[] = [];
  if (entry.keys) {
    for (let ii = 0; ii < entry.keys.length; ++ii) {
      fns.push(keyDownEdge.bind(null, entry.keys[ii]));
    }
  }
  if (entry.pads) {
    for (let ii = 0; ii < entry.pads.length; ++ii) {
      fns.push(padButtonDownEdge.bind(null, entry.pads[ii]));
    }
  }
  if (entry.shift_keys) {
    for (let ii = 0; ii < entry.shift_keys.length; ++ii) {
      fns.push(keyDownShifted.bind(null, entry.shift_keys[ii]));
    }
  }
  if (entry.unshift_keys) {
    for (let ii = 0; ii < entry.unshift_keys.length; ++ii) {
      fns.push(keyDownUnshifted.bind(null, entry.unshift_keys[ii]));
    }
  }
  return function () {
    for (let ii = 0; ii < fns.length; ++ii) {
      if (fns[ii]()) {
        return true;
      }
    }
    return false;
  };
}
type SpotNavKeysCompiled = Record<SpotNavEnum, () => boolean>;
function compileSpotNavKeys(keys: SpotNavKeys): SpotNavKeysCompiled {
  return {
    [SPOT_NAV_LEFT]: compileSpotNavKeysEntry(keys[SPOT_NAV_LEFT]),
    [SPOT_NAV_UP]: compileSpotNavKeysEntry(keys[SPOT_NAV_UP]),
    [SPOT_NAV_RIGHT]: compileSpotNavKeysEntry(keys[SPOT_NAV_RIGHT]),
    [SPOT_NAV_DOWN]: compileSpotNavKeysEntry(keys[SPOT_NAV_DOWN]),
    [SPOT_NAV_PREV]: compileSpotNavKeysEntry(keys[SPOT_NAV_PREV]),
    [SPOT_NAV_NEXT]: compileSpotNavKeysEntry(keys[SPOT_NAV_NEXT]),
  };
}
const compiled_nav_base = compileSpotNavKeys(spot_nav_keys_base);
const compiled_nav_simple = compileSpotNavKeys(spot_nav_keys_simple);
const compiled_nav_extended = compileSpotNavKeys(spot_nav_keys_extended);
let spot_nav_type: SpotNavtypeEnum;
let spot_nav_keys: SpotNavKeysCompiled;
export function spotSetNavtype(type: SpotNavtypeEnum): void {
  spot_nav_type = type;
  spot_nav_keys = (type === SPOT_NAVTYPE_SIMPLE) ? compiled_nav_simple : compiled_nav_extended;
}
spotSetNavtype(SPOT_NAVTYPE_EXTENDED);
function resetNavKeys(): void {
  spot_nav_keys = (spot_nav_type === SPOT_NAVTYPE_SIMPLE) ? compiled_nav_simple : compiled_nav_extended;
}
let suppress_kb_nav_this_frame = false;

export function spotSuppressKBNav(left_right: boolean, up_down: boolean): void {
  suppress_kb_nav_this_frame = true;
  assert(left_right);
  let active = (spot_nav_type === SPOT_NAVTYPE_SIMPLE) ? compiled_nav_simple : compiled_nav_extended;
  if (up_down) {
    spot_nav_keys = {
      [SPOT_NAV_LEFT]: compiled_nav_base[SPOT_NAV_LEFT],
      [SPOT_NAV_UP]: compiled_nav_base[SPOT_NAV_UP],
      [SPOT_NAV_RIGHT]: compiled_nav_base[SPOT_NAV_RIGHT],
      [SPOT_NAV_DOWN]: compiled_nav_base[SPOT_NAV_DOWN],
      [SPOT_NAV_PREV]: active[SPOT_NAV_PREV],
      [SPOT_NAV_NEXT]: active[SPOT_NAV_NEXT],
    };
  } else {
    // just left/right arrows, but still all text input keys
    spot_nav_keys = {
      [SPOT_NAV_LEFT]: compiled_nav_base[SPOT_NAV_LEFT],
      [SPOT_NAV_UP]: compiled_nav_simple[SPOT_NAV_UP],
      [SPOT_NAV_RIGHT]: compiled_nav_base[SPOT_NAV_RIGHT],
      [SPOT_NAV_DOWN]: compiled_nav_simple[SPOT_NAV_DOWN],
      [SPOT_NAV_PREV]: active[SPOT_NAV_PREV],
      [SPOT_NAV_NEXT]: active[SPOT_NAV_NEXT],
    };
  }
}


const TARGET_QUAD = 0;
const TARGET_HALF = 1;
const TARGET_ALL = 2;
type TargetTypeEnum = typeof TARGET_QUAD | typeof TARGET_HALF | typeof TARGET_ALL;

function findBestTargetInternal(
  nav: SpotNavEnum,
  dom_pos: Box,
  targets: SpotListElem[],
  precision: TargetTypeEnum,
  filter: (param: SpotListElem) => boolean
): SpotListElem | null {
  let start_w2 = dom_pos.w/2;
  let start_h2 = dom_pos.h/2;
  let start_x = dom_pos.x + start_w2;
  let start_y = dom_pos.y + start_h2;
  let start_left = dom_pos.x;
  let start_right = dom_pos.x + dom_pos.w;
  let start_top = dom_pos.y;
  let start_bottom = dom_pos.y + dom_pos.h;
  let best = null;
  let bestd;
  for (let ii = 0; ii < targets.length; ++ii) {
    let param = targets[ii];
    if (!filter(param)) {
      continue;
    }
    let target = param.dom_pos;
    let d;
    if (precision === TARGET_QUAD) {
      let quadrant;
      // edge facing quadrant calc: to be to the "left" our right edge must be
      //   in the quadrant formed by the 2 45-degree lines passing through the
      //   left 2 points of the start rect.
      // In this case, for `d`, use the Manhattan distance from the center of
      //   the start edge to the nearest point in the target, this will favor
      //   those that are nearby and aligned without skipping past a large, wide
      //   button in favor of a small (closer) button on the other side of it.
      let target_right = target.x + target.w;
      let target_bottom = target.y + target.h;
      let left_dx = start_left - target_right;
      let right_dx = target.x - start_right;
      let top_dy = start_top - target_bottom;
      let bottom_dy = target.y - start_bottom;
      if (left_dx >= -start_w2 && target_bottom > start_top - left_dx && target.y < start_bottom + left_dx) {
        quadrant = SPOT_NAV_LEFT;
        d = left_dx + max(target.y - start_y, start_y - target_bottom, 0);
      } else if (right_dx >= -start_w2 && target_bottom > start_top - right_dx && target.y < start_bottom + right_dx) {
        quadrant = SPOT_NAV_RIGHT;
        d = right_dx + max(target.y - start_y, start_y - target_bottom, 0);
      } else if (top_dy >= -start_h2 && target_right >= start_left - top_dy && target.x <= start_right + top_dy) {
        quadrant = SPOT_NAV_UP;
        d = top_dy + max(target.x - start_x, start_x - target_right, 0);
      } else if (bottom_dy >= -start_h2 && target_right >= start_left - bottom_dy &&
        target.x <= start_right + bottom_dy
      ) {
        quadrant = SPOT_NAV_DOWN;
        d = bottom_dy + max(target.x - start_x, start_x - target_right, 0);
      }

      if (quadrant === undefined) {
        // smart logic didn't work, perhaps heavily overlapping, instead use
        // simple center-point quadrant calc:
        let x = target.x + target.w/2;
        let y = target.y + target.h/2;
        let dx = x - start_x;
        let dy = y - start_y;
        d = abs(dx) + abs(dy);
        if (abs(dx) > abs(dy)) {
          if (dx > 0) {
            quadrant = SPOT_NAV_RIGHT;
          } else {
            quadrant = SPOT_NAV_LEFT;
          }
        } else {
          if (dy > 0) {
            quadrant = SPOT_NAV_DOWN;
          } else {
            quadrant = SPOT_NAV_UP;
          }
        }
      }
      if (quadrant !== nav) {
        continue;
      }
    } else {
      let x = target.x + target.w/2;
      let y = target.y + target.h/2;
      let dx = x - start_x;
      let dy = y - start_y;
      d = abs(dx) + abs(dy);
      if (precision === TARGET_HALF) {
        if (dx <= 0 && nav === SPOT_NAV_RIGHT ||
          dx >= 0 && nav === SPOT_NAV_LEFT ||
          dy <= 0 && nav === SPOT_NAV_DOWN ||
          dy >= 0 && nav === SPOT_NAV_UP
        ) {
          continue;
        }
      } else {
        // allow any, just find closest
      }
    }
    if (!best || (d as number) < (bestd as number)) {
      best = param;
      bestd = d;
    }
  }
  return best;
}

const EPSILON = 0.00001;
let debug_style: FontStyle;
function spotDebugList(show_all: boolean, list: SpotListElem[]): void {
  if (!debug_style) {
    debug_style = fontStyle(null, {
      color: 0x000000ff,
      outline_color: 0xFFFFFFcc,
      outline_width: 2,
    });
  }
  for (let ii = 0; ii < list.length; ++ii) {
    let area = list[ii];
    let pos = area.dom_pos;
    let color: Vec4 | undefined;
    if (isSubRect(area)) {
      if (show_all) {
        ui.font.drawSizedAligned(debug_style, pos.x, pos.y, Z.DEBUG, 8,
          ui.font.ALIGN.HVCENTERFIT, pos.w, pos.h, area.key_computed || 'unknown');
      }
      continue;
    }
    if (area.spot_debug_ignore) {
      continue;
    }
    if (area.only_mouseover) {
      color = [1,0.5,0, 0.5];
    } else {
      const def = area.def || SPOT_DEFAULT;
      const pad_focusable = area.pad_focusable === undefined ? def.pad_focusable : area.pad_focusable;
      if (!pad_focusable) {
        continue;
      }
      const spatial_focus = area.spatial_focus === undefined ? def.spatial_focus : area.spatial_focus;
      if (!spatial_focus) {
        continue;
      }
      for (let jj = 0; jj < list.length; ++jj) {
        if (ii === jj) {
          continue;
        }
        let other = list[jj];
        if (isSubRect(other)) {
          continue;
        }
        if (other.sub_rect !== area.sub_rect) {
          continue;
        }
        const other_def = other.def || SPOT_DEFAULT;
        const other_pad_focusable = other.pad_focusable === undefined ? other_def.pad_focusable : other.pad_focusable;
        if (other.only_mouseover || !other_pad_focusable) {
          continue;
        }
        const other_spatial_focus = other.spatial_focus === undefined ? other_def.spatial_focus : other.spatial_focus;
        if (!other_spatial_focus) {
          continue;
        }
        let other_pos = other.dom_pos;
        if (pos.x < other_pos.x + other_pos.w - EPSILON && pos.x + pos.w > other_pos.x + EPSILON &&
          pos.y < other_pos.y + other_pos.h - EPSILON && pos.y + pos.h > other_pos.y + EPSILON
        ) {
          color = [1,0,0, 0.5];
        }
      }
    }
    if (!show_all && !color) {
      continue;
    }
    drawRect(pos.x, pos.y, pos.x + pos.w, pos.y + pos.h, Z.DEBUG, color || [1,1,0, 0.5]);
    ui.font.drawSizedAligned(debug_style, pos.x, pos.y, Z.DEBUG, 8,
      ui.font.ALIGN.HVCENTERFIT, pos.w, pos.h, area.key_computed || 'unknown');
  }
}
function spotDebug(): void {
  camera2d.push();
  camera2d.setDOMMapped();
  let show_all = keyDown(KEYS.SHIFT);
  spotDebugList(show_all, frame_spots);

  if (pad_mode || show_all) {
    for (let ii = SPOT_NAV_LEFT; ii <= SPOT_NAV_DOWN; ++ii) {
      let next_spot = focus_next[ii];
      if (next_spot) {
        let pos = focus_pos;
        let next = next_spot.dom_pos;
        let via = focus_next_via[ii];
        if (via) {
          pos = via.dom_pos;
          drawLine(pos.x + pos.w/2, pos.y + pos.h/2, next.x + next.w/2, next.y+next.h/2,
            Z.DEBUG, 1, 0.95, [1, 0.5, 0, 1]);
          pos = focus_pos;
          next = via.dom_pos;
        }
        drawLine(pos.x + pos.w/2, pos.y + pos.h/2, next.x + next.w/2, next.y+next.h/2,
          Z.DEBUG, 1, 0.95, [1, 1, 0, 1]);
      }
    }
  }

  camera2d.pop();
}

let filter_sub_rect: SpotSubInternal | null;
let filter_not: SpotListElem | null;
function filterMatchesSubrect(param: SpotListElem): boolean {
  return param !== filter_not && param.sub_rect === filter_sub_rect;
}

function overlaps(r1: Box, r2: Box): boolean {
  return r1.x + r1.w > r2.x && r1.x < r2.x + r2.w &&
    r1.y + r1.h > r2.y && r1.y < r2.y + r2.h;
}
function contains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.x + inner.w <= outer.x + outer.w &&
    inner.y >= outer.y && inner.y + inner.h <= outer.y + outer.h;
}

function filterInSubrectView(param: SpotListElem): boolean {
  if (param.sub_rect !== filter_sub_rect) {
    return false;
  }
  return overlaps(param.dom_pos, (filter_sub_rect as SpotSubInternal).dom_pos);
}

function filterMatchesSubrectOrInVisibleChild(param: SpotListElem): boolean {
  if (param === filter_not) {
    return false;
  }
  if (param.sub_rect === filter_sub_rect) {
    return true;
  }
  if (param.sub_rect && param.sub_rect.sub_rect === filter_sub_rect) {
    // in immediate child
    return overlaps(param.dom_pos, param.sub_rect.dom_pos);
  }
  return false;
}

const SUBRECT_FILTERS = [filterInSubrectView, filterMatchesSubrect];
function findBestWithinSubrect(
  nav: SpotNavEnum,
  dom_pos: Box,
  pad_focusable_list: SpotListElem[],
  best: SpotSubInternal,
  precision_max: TargetTypeEnum,
): SpotInternal | null {
  // we hit a sub rect, find the best target inside it, first trying all
  //   in view (all precision), then all out of view
  filter_sub_rect = best;
  for (let jj = 0; jj < SUBRECT_FILTERS.length; ++jj) {
    let filter = SUBRECT_FILTERS[jj];
    for (let precision = 0 as TargetTypeEnum; precision <= precision_max; ++precision) {
      let best_inside = findBestTargetInternal(nav, dom_pos, pad_focusable_list, precision, filter);
      if (best_inside) {
        assert(!isSubRect(best_inside));
        return best_inside;
      }
    }
  }
  return null;
}

function findBestTargetFromSubRect(
  start_sub_rect: SpotSubInternal | null,
  nav: SpotNavEnum,
  dom_pos: Box,
  pad_focusable_list: SpotListElem[],
  precision: TargetTypeEnum,
): SpotInternal | null {
  // Go to the one in the appropriate quadrant which has the smallest Manhattan distance
  filter_sub_rect = start_sub_rect;
  let best = findBestTargetInternal(nav, dom_pos, pad_focusable_list, precision, filterMatchesSubrectOrInVisibleChild);
  if (best) {
    if (isSubRect(best)) {
      focus_next_via[nav] = best;
      best = findBestWithinSubrect(nav, dom_pos, pad_focusable_list, best, precision);
      if (!best) {
        focus_next_via[nav] = undefined;
      }
    }
  }
  return best;
}

function spotCalcNavTargets(): void {
  // Computes, for each direction, where we would target from the current focus
  //   state, to be used next frame if a focus key is pressed.
  // Note: cannot compute this trivially only upon keypress since we do not know
  //   which keys to check until we reached a focused / focusable element.  We
  //   could, however, instead, do this at the beginning of the frame only if
  //   we peek at the key/pad state and see that it *might be* pressed this
  //   frame.
  for (let ii = 1; ii < SPOT_NAV_MAX; ++ii) {
    focus_next[ii] = undefined;
    focus_next_via[ii] = undefined;
  }
  // First, find current focused element (if any) and gather the list of potentially
  //  focusable elements, computing where "prev" and "next should go (based on
  //  the in-frame order).
  let start;
  let pad_focusable_list = [];
  let prev;
  let first_non_sub_rect;
  for (let ii = 0; ii < frame_spots.length; ++ii) {
    let param = frame_spots[ii];
    if (isSubRect(param)) {
      // Not actually "focusable", but need to target it to then target its contents
      if (!param.is_empty_sub_rect) {
        pad_focusable_list.push(param);
      }
    } else if (param.key_computed === focus_key) {
      if (!focus_next[SPOT_NAV_PREV] && prev) {
        focus_next[SPOT_NAV_PREV] = prev;
      }
      start = param;
    } else {
      const def = param.def || SPOT_DEFAULT;
      const pad_focusable = param.pad_focusable === undefined ? def.pad_focusable : param.pad_focusable;
      if (pad_focusable) {
        if (!first_non_sub_rect) {
          first_non_sub_rect = param;
        }
        prev = param;
        if (!focus_next[SPOT_NAV_NEXT] && start) {
          focus_next[SPOT_NAV_NEXT] = param;
        }
        const spatial_focus = param.spatial_focus === undefined ? def.spatial_focus : param.spatial_focus;
        if (spatial_focus) {
          pad_focusable_list.push(param);
        }
      }
    }
  }
  if (!focus_next[SPOT_NAV_PREV] && prev) {
    // but, didn't trigger above, must have been first, wrap to end
    focus_next[SPOT_NAV_PREV] = prev;
  }
  if (!focus_next[SPOT_NAV_NEXT]) {
    // nothing next, go to first non-sub_rect
    focus_next[SPOT_NAV_NEXT] = first_non_sub_rect;
  }
  let precision_max;
  let start_sub_rect: SpotSubInternal | null;
  if (start) {
    start_sub_rect = start.sub_rect;
    focus_pos.x = start.dom_pos.x;
    focus_pos.y = start.dom_pos.y;
    focus_pos.w = start.dom_pos.w;
    focus_pos.h = start.dom_pos.h;
    precision_max = TARGET_HALF;
  } else {
    // use the subrect overlapped, if any
    start_sub_rect = null;
    for (let ii = 0; ii < frame_spots.length; ++ii) {
      let param = frame_spots[ii];
      if (isSubRect(param)) {
        if (contains(param.dom_pos, focus_pos)) {
          start_sub_rect = param;
        }
      }
    }
    if (start_sub_rect) {
      precision_max = TARGET_HALF;
    } else {
      precision_max = TARGET_ALL;
    }
  }

  // Second, using the currently focused rect as a starting point, find
  //   appropriate elements to focus in each of the cardinal directions.
  for (let nav = 1 as SpotNavEnum; nav <= SPOT_NAV_DOWN; ++nav) {
    for (let precision = 0 as TargetTypeEnum; precision <= precision_max; ++precision) {
      filter_not = null;
      let best = findBestTargetFromSubRect(start_sub_rect, nav, focus_pos, pad_focusable_list, precision);
      if (best) {
        focus_next[nav] = best;
        break;
      }
      if (start_sub_rect) {
        // Did not find anything within our subrect, try searching outside, from the subrect itself
        filter_not = start_sub_rect; // do not target oneself
        best = findBestTargetFromSubRect(start_sub_rect.sub_rect, nav, focus_pos,
          pad_focusable_list, precision);
        if (best) {
          focus_next[nav] = best;
          break;
        }
      }
    }
  }

  // Finally, apply any custom navigation instructions (keys which should not change
  //   focus or which target a particular other element by key) based on the currently
  //   focused element.
  if (start) {
    const def = start.def || SPOT_DEFAULT;
    const custom_nav = start.custom_nav === undefined ? def.custom_nav : start.custom_nav;
    if (custom_nav) {
      let by_key: Partial<Record<string,SpotInternal>> | undefined;
      for (let key_string in custom_nav) {
        let key = Number(key_string) as SpotNavEnum;
        let target = custom_nav[key];
        if (target === null || target === undefined) {
          focus_next[key] = target;
        } else {
          if (!by_key) {
            by_key = {};
            for (let ii = 0; ii < frame_spots.length; ++ii) {
              let param = frame_spots[ii];
              if (!isSubRect(param)) {
                by_key[param.key_computed] = param;
              }
            }
          }
          if (by_key[target]) {
            focus_next[key] = by_key[target];
          }
        }
      }
    }
  }
}

export function spotTopOfFrame(): void {
  if (mouseMoved()) {
    let pos = mouseDomPos();
    focus_pos.x = pos[0];
    focus_pos.y = pos[1];
    focus_pos.w = 0;
    focus_pos.h = 0;
  }
  if (mouseDownEdge({ peek: true })) {
    pad_mode = false;
  }
  sub_stack.length = 0;
  focus_sub_rect = null;
}

export function spotSuppressPad(): void {
  suppress_pad = true;
  if (pad_mode && focus_key && !focus_is_sticky) {
    spotUnfocus();
    pad_mode = true; // but, keep pad_mode set
  }
}

export function spotPadSuppressed(): boolean {
  return suppress_pad;
}

export function spotEndOfFrame(): void {
  spotCalcNavTargets();

  last_frame_autofocus_spots = frame_autofocus_spots;
  suppress_pad = false;
  last_frame_spots = frame_spots;
  frame_spots = [];
  frame_autofocus_spots = {};
  async_activate_key = null;
  if (!suppress_kb_nav_this_frame) {
    resetNavKeys();
  }
  suppress_kb_nav_this_frame = false;
}

function frameSpotsPush(param: SpotListElem): void {
  assert(param.dom_pos);
  verify(isFinite(param.dom_pos.x));
  verify(isFinite(param.dom_pos.y));
  verify(isFinite(param.dom_pos.w));
  verify(isFinite(param.dom_pos.h));
  param.sub_rect = focus_sub_rect;
  frame_spots.push(param);
  if (focus_sub_rect) {
    focus_sub_rect.is_empty_sub_rect = false;
  }
}

type HasPosCache = {
  dom_pos: Box;
};

function spotEntirelyObscured(param: HasPosCache): boolean {
  let pos = param.dom_pos;
  for (let ii = 0; ii < frame_spots.length; ++ii) {
    let other = frame_spots[ii];
    if (isSubRect(other)) {
      continue;
    }
    if (other.sub_rect !== focus_sub_rect) {
      continue;
    }
    let other_pos = other.dom_pos;
    if (other_pos.x <= pos.x && other_pos.x + other_pos.w >= pos.x + pos.w &&
      other_pos.y <= pos.y && other_pos.y + other_pos.h >= pos.y + pos.h
    ) {
      return true;
    }
  }
  return false;
}

export function spotSubPush(): void {
  sub_stack.push([focus_sub_rect, focus_sub_rect_elem]);
  focus_sub_rect = null;
}
export function spotSubPop(): void {
  ([focus_sub_rect, focus_sub_rect_elem] = verify(sub_stack.pop()));
}

export function spotSubBegin(param_in: SpotSubParam): void {
  assert(param_in.key);
  if (focus_sub_rect) {
    // no recursive nesting supported yet
    assert(!focus_sub_rect, `Recursive spot, parent:${focus_sub_rect.key},` +
      ` self:${param_in.key},` +
      ` same=${param_in === focus_sub_rect}`);
  }
  spotKey(param_in);
  let sub_rect = param_in as SpotSubInternal;
  sub_rect.is_sub_rect = true;
  if (!sub_rect.dom_pos) {
    sub_rect.dom_pos = {} as Box;
  }
  camera2d.virtualToDomPosParam(sub_rect.dom_pos, sub_rect);
  if (!spotEntirelyObscured(sub_rect)) {
    frameSpotsPush(sub_rect);
  }
  focus_sub_rect = sub_rect;
  focus_sub_rect.is_empty_sub_rect = true;
  focus_sub_rect_elem = null;
}

export function spotSubEnd(): SpotParam | null {
  assert(focus_sub_rect);
  focus_sub_rect = null;
  return focus_sub_rect_elem;
}

export function spotMouseoverHook(pos_param_in: Box, param: MouseOverParam): void {
  if (inputEatenMouse() || param.peek) {
    return;
  }
  if ((param as SpotParam).key_computed) { // presumably in a call to `spot()`
    return;
  }
  let pos_param = pos_param_in as Box & HasPosCache;
  if (!pos_param.dom_pos) {
    pos_param.dom_pos = {} as Box;
  }
  camera2d.virtualToDomPosParam(pos_param.dom_pos, pos_param);
  if (!spotEntirelyObscured(pos_param)) {
    let area = pos_param as SpotInternal;
    area.only_mouseover = true;
    area.pad_focusable = false;
    if (engine.defines.SPOT_DEBUG) {
      area.spot_debug_ignore = param.eat_clicks || // just consuming mouseover, not a button / etc
        param.spot_debug_ignore;
    }
    frameSpotsPush(area);
  }
}

function keyCheck(nav_dir: SpotNavEnum): boolean {
  if (suppress_pad) {
    return false;
  }
  return spot_nav_keys[nav_dir]();
}

type SpotParamWithOut = SpotParam & {
  out: SpotRet;
};

function spotFocusCheckNavButtonsFocused(param: SpotParamWithOut): void {
  for (let ii = 1 as SpotNavEnum; ii < SPOT_NAV_MAX; ++ii) {
    let elem = focus_next[ii];
    if (elem !== undefined && keyCheck(ii)) {
      if (elem) {
        spotFocusSet(elem, false, false, 'nav_focused');
      } else {
        param.out.nav = ii;
      }
    }
  }
}

function spotFocusCheckNavButtonsUnfocused(param: SpotParamWithOut): void {
  for (let ii = 1 as SpotNavEnum; ii < SPOT_NAV_MAX; ++ii) {
    let elem = focus_next[ii];
    if (elem && elem.key_computed === param.key_computed && keyCheck(ii)) {
      spotFocusSet(elem, false, false, 'nav_unfocused');
    }
  }
}

// Silently steal (keep) focus
function spotFocusSetSilent(param: SpotParam): void {
  const key = spotKey(param);
  const def = param.def || SPOT_DEFAULT;
  focus_key = key;
  const sticky_focus = param.sticky_focus === undefined ? def.sticky_focus : param.sticky_focus;
  focus_is_sticky = sticky_focus;
  focus_key_nonsticky = null;
}

export function spotGetCurrentFocusKey(): string {
  return [focus_key, focus_is_sticky, focus_key_nonsticky].join(';');
}

export function spotFocusSteal(param: SpotParam): void {
  const key = spotKey(param);
  spotlog('spotFocusSteal', key, false);
  // Silent, no sound, no checking parameters, just set the key string
  pad_mode = true;
  spotFocusSetSilent(param);
}

function spotParamAddOut(param: SpotParam): asserts param is SpotParamWithOut {
  if (!param.out) {
    param.out = {} as SpotRet;
  }
}

function spotParamAddPosCache(param: SpotParamWithOut): asserts param is SpotInternal {
  assert(param.key_computed);
  if (!param.dom_pos) {
    param.dom_pos = {} as Box;
  }
}

function spotParamIsSpotInternal(param: SpotParam): asserts param is SpotInternal {
  // nothing, just for TypeScript
}

// sets param.out.allow_focus, param.out.nav, and param.dom_pos (if allow_focus)
export function spotFocusCheck(param: SpotParam): SpotRet {
  spotParamAddOut(param);
  let out = param.out;
  out.focused = false;
  out.kb_focused = false;
  out.allow_focus = false;
  const key = spotKey(param); // Doing this even if disabled for spotDebug()
  const def = param.def || SPOT_DEFAULT;
  const disabled = param.disabled === undefined ? def.disabled : param.disabled;
  if (disabled) {
    const disabled_focusable = param.disabled_focusable === undefined ? def.disabled_focusable :
      param.disabled_focusable;
    if (!disabled_focusable) {
      return out;
    }
    // Otherwise disabled_focusable - allow focusing
  }
  const focus_steal = param.focus_steal === undefined ? def.focus_steal : param.focus_steal;
  if (focus_steal) {
    // Silently steal (keep) focus
    spotFocusSetSilent(param);
  }
  if (focus_key === key) {
    // last_frame_focus_found = true;
    spotFocusCheckNavButtonsFocused(param);
  } else {
    spotFocusCheckNavButtonsUnfocused(param);
  }
  let focused = focus_key === key || focus_key_nonsticky === key;
  if (inputEatenMouse()) {
    if (focus_key === key) {
      spotUnfocus();
      focused = false;
    }
    if (focus_key_nonsticky === key) {
      focus_key_nonsticky = null;
      focused = false;
    }
  } else {
    out.allow_focus = true;
    spotParamAddPosCache(param);
    camera2d.virtualToDomPosParam(param.dom_pos, param);
    const auto_focus = param.auto_focus === undefined ? def.auto_focus : param.auto_focus;
    if (!spotEntirelyObscured(param) || focused && focus_is_sticky) {
      frameSpotsPush(param);
      if (auto_focus) {
        if (!focused && !last_frame_autofocus_spots[key] && pad_mode) {
          spotlog('auto_focus', key);
          // play no sound, etc, just silently steal focus
          spotFocusSetSilent(param);
          focused = true;
        }
      }
    }
    if (auto_focus) {
      frame_autofocus_spots[key] = param;
    }
    if (focus_sub_rect && focus_key === key) {
      focus_sub_rect_elem = param;
    }
  }

  out.kb_focused = focus_key === key;
  out.focused = focused;
  return out;
}

export function spotEndInput(): void {
  if (engine.defines.SPOT_DEBUG) {
    spotDebug();
  }
}

// This is useful for preemptively triggering a button press within an in_event_cb that has
// a side-effect (such as rotating the screen) that might cause the actual button press to
// not reach the appropriate button.
export function spotAsyncActivateButton(key: string): void {
  async_activate_key = key;
}

let last_signal = {
  key: '',
  timestamp: 0,
};
function spotSignalRet(param: SpotInternal): void {
  let out = param.out;
  let key = param.key_computed;
  assert(key);
  out.double_click = key === last_signal.key &&
    engine.frame_timestamp - last_signal.timestamp <
    // TODO: After input.js and settings.js are converted to TypeScript, remove type casts
    (settings as unknown as { double_click_time:number }).double_click_time;
  last_signal.key = key;
  last_signal.timestamp = engine.frame_timestamp;
  out.ret++;
}

// param:
//   See SPOT_DEFAULT, additionally:
//   x,y,w,h : number // only parameters not inherited from `def`
//   def: used for any undefined parameters (defaults to SPOT_DEFAULT)
//   out: object // holds return values, lazy-allocated if needed
// returns/modifies param.out:
//   focused : boolean // focused by any means
//   kb_focused : boolean // focused for the purpose of receiving keyboard input (focused and no other sticky focus)
//   spot_state: one of SPOT_STATE_*
//   ret: number // if `param.is_button` and was activated (0/1 or more if clicked multiple times in a frame)
//   long_press: boolean // if button_long_press and ret and was a long press, set to true
//   button: number // if ret, set to mouse button used to click it
//   pos: vec2 // if ret, set to position of the click
//   double_click: boolean // if ret, set to true if it was a double click/tap/button press/etc
//   drag_drop: any // if drag_target and a drop happened, contains dragDrop event { drag_payload }
//   nav: SPOT_NAV_* // if custom_nav, and the user navigated, set to the navigation event
export function spot(param: SpotParam): SpotRet {
  profilerStartFunc();
  const def = param.def || SPOT_DEFAULT;
  const disabled = param.disabled === undefined ? def.disabled : param.disabled;
  const is_button = param.is_button === undefined ? def.is_button : param.is_button;
  const button_long_press = param.button_long_press === undefined ? def.button_long_press : param.button_long_press;
  const in_event_cb = param.in_event_cb === undefined ? def.in_event_cb : param.in_event_cb;
  const drag_target = param.drag_target === undefined ? def.drag_target : param.drag_target;
  const drag_over = param.drag_over === undefined ? def.drag_over : param.drag_over;
  const touch_focuses = param.touch_focuses === undefined ? def.touch_focuses : param.touch_focuses;
  const focus_steal = param.focus_steal === undefined ? def.focus_steal : param.focus_steal;
  const custom_nav = param.custom_nav === undefined ? def.custom_nav : param.custom_nav;

  spotParamAddOut(param);
  let out = param.out;
  out.focused = false;
  out.ret = 0;
  if (button_long_press) {
    out.long_press = false;
  }
  if (drag_target) {
    out.drag_drop = null;
  }
  if (custom_nav) {
    out.nav = SPOT_NAV_NONE;
  }

  let state: SpotStateEnum = SPOT_STATE_REGULAR;
  let { focused, allow_focus, kb_focused } = spotFocusCheck(param);
  spotParamIsSpotInternal(param); // massaged in spotFocusCheck(), but type assertion is lost
  if (disabled) {
    state = SPOT_STATE_DISABLED;
  } else {
    let button_click;
    let long_press_ret;
    if (drag_target && (out.drag_drop = dragDrop(param))) {
      spotFocusSet(param, true, true, 'drag_drop');
      spotSignalRet(param);
      focused = true;
    } else if (button_long_press && (long_press_ret = longPress(param)) ||
        is_button && (button_click = inputClick(param))
    ) {
      // TODO: change `ret` to be a count of how many clicks/taps happened?
      if (long_press_ret) {
        out.long_press = long_press_ret.long_press;
        out.button = long_press_ret.button;
        out.pos = undefined;
      } else {
        assert(button_click);
        out.button = button_click.button;
        out.pos = button_click.pos as Vec2;
      }
      // Not using button_click.was_double_click: relying on doubly activating this exact spot instead
      // out.double_click = button_click.was_double_click;
      if (mousePosIsTouch()) {
        if (touch_focuses) {
          if (!focused) {
            // Just focus, show tooltip
            // touch_changed_focus = true;
            // Considering this a "pad" focus, not mouse, as it's sticky
            spotFocusSet(param, false, false, 'touch_focus');
            focused = true;
          } else {
            // activate, and also unfocus
            spotSignalRet(param);
            spotUnfocus();
            focused = false;
          }
        } else {
          // not focusing, would flicker a tooltip for 1 frame
          // also, unfocusing, in case it was focused via long_press_focuses
          spotSignalRet(param);
          spotUnfocus();
          focused = false;
        }
      } else {
        spotSignalRet(param);
        spotFocusSet(param, true, true, 'click');
        focused = true;
      }
    } else if (!is_button && touch_focuses && mousePosIsTouch() && inputClick(param)) {
      // Considering this a "pad" focus, not mouse, as it's sticky
      spotFocusSet(param, false, false, 'touch_focus');
      focused = true;
    } else if (drag_target && dragOver(param)) {
      spotFocusSet(param, true, false, 'drag_over');
      focused = true;
      if (mouseDownAnywhere()) {
        state = SPOT_STATE_DOWN;
      }
    } else if (drag_over && dragOver(param)) {
      // do nothing, just consume event
      // not even set focus?
    }
  }
  // Long-press (on touch) focuses, a la mouse rollover
  if (allow_focus && inputTouchMode()) {
    const long_press_focuses = param.long_press_focuses === undefined ?
      def.long_press_focuses : param.long_press_focuses;
    if (long_press_focuses && longPress(param)) {
      // Considering this a "pad" focus, not mouse, as it's sticky
      spotFocusSet(param, false, false, 'long_press');
      focused = true;
    }
  }
  let is_mouseover = mouseOver(param);
  if (focused && !focus_steal && !is_mouseover) {
    // Want to unfocus if mouse is in use
    if (mouseButtonHadEdge()) {
      // Unfocus regardless
      focused = false;
      spotUnfocus();
    } else if (mouseMoved()) {
      // Unfocus just focus_non_sticky if appropriate
      focused = false;
      if (focus_key === param.key_computed) {
        spotUnfocus();
      } else if (focus_key_nonsticky === param.key_computed) {
        focus_key_nonsticky = null;
      }
    }
  }
  if (is_mouseover) {
    if (allow_focus) {
      if (spotFocusSet(param, true, false, 'mouseover')) {
        focused = true;
      }
    }
  }
  if (is_button && is_mouseover && mouseDownMidClick(param)) {
    if (!disabled) {
      state = SPOT_STATE_DOWN;
    }
  }

  let button_activate = false;
  if (focused) {
    if (state === SPOT_STATE_REGULAR) {
      state = SPOT_STATE_FOCUSED;
    }
    if (is_button && !disabled && kb_focused && !suppress_pad) {
      let key_opts = in_event_cb ? { in_event_cb } : null;
      if (keyDownEdge(KEYS.SPACE, key_opts) || keyDownEdge(KEYS.RETURN, key_opts) || padButtonDownEdge(PAD.A)) {
        button_activate = true;
      }
    }
  }
  if (!disabled) {
    const hotkey = param.hotkey === undefined ? def.hotkey : param.hotkey;
    const hotkeys = param.hotkeys === undefined ? def.hotkeys : param.hotkeys;
    const hotpad = param.hotpad === undefined ? def.hotpad : param.hotpad;
    if (hotkey || hotkeys) {
      let key_opts = in_event_cb ? { in_event_cb } : null;
      if (hotkey && keyDownEdge(hotkey, key_opts)) {
        button_activate = true;
      }
      if (hotkeys) {
        for (let ii = 0; ii < hotkeys.length; ++ii) {
          if (keyDownEdge(hotkeys[ii], key_opts)) {
            button_activate = true;
          }
        }
      }
    }
    if (hotpad) {
      if (padButtonDownEdge(hotpad)) {
        button_activate = true;
      }
    }
    if (async_activate_key === param.key_computed) {
      button_activate = true;
    }
  }
  if (button_activate) {
    spotSignalRet(param);
    out.button = 0;
    out.pos = null;
  }

  out.focused = focused;
  if (out.ret) {
    state = SPOT_STATE_DOWN;
    const sound_button = param.sound_button === undefined ? def.sound_button : param.sound_button;
    if (sound_button) {
      playUISound(sound_button);
    }
  }
  if (out.focused && param.tooltip) {
    drawTooltipBox(param as TooltipBoxParam);
  }
  checkHooks(param, Boolean(out.ret));
  out.spot_state = state;

  profilerStopFunc();
  return out;
}
