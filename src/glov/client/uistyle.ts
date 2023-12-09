import assert from 'assert';
import { tail } from 'glov/common/util';
import verify from 'glov/common/verify';
import { internal as ui_internal } from './ui';
const { uiApplyStyle } = ui_internal;

import type { DataObject, TSMap } from 'glov/common/types';

export type UIStyleDef = {
  text_height?: number | string;
  button_width?: number | string;
  button_height?: number | string;
};

export type UIStyleFields = {
  // font: Font;
  // font_style: FontStyle;
  // font_style_focused: FontStyle;
  // font_style_disabled: FontStyle;
  text_height: number;
  // text_align: ALIGN;
  button_width: number;
  button_height: number;
  // color sets - always a full set, and style defs could do single color for convenience and button param tints color
  // button_color_set: ColorSet;
  // button_img_regular: Sprite;
  // button_img_down: Sprite;
  // button_img_focused: Sprite;
  // button_img_disabled: Sprite;
  // sound_button: string;
  // sound_rollover: string;
  // tooltip_width: number;
  // tooltip_pad: number;
  // tooltip_pixel_scale: number;
};

const default_style_params_init: UIStyleFields = {
  text_height: 24,
  button_width: 200,
  button_height: 32,
};


export type UIStyle = Readonly<UIStyleFields>;

let ui_style_default: UIStyle;
let ui_style_current: UIStyle;

class UIStyleImpl implements UIStyleFields {
  id_chain: string[];
  text_height!: number;
  button_width!: number;
  button_height!: number;
  constructor(id_chain: string[]) {
    this.id_chain = id_chain;
  }
}

type UIStyleDefEntry = {
  def: UIStyleDef;
  deps: UIStyleImpl[];
};
let style_params: TSMap<UIStyleDefEntry> = Object.create(null);
let style_param_auto_last_idx = 0;
style_params.default = {
  def: default_style_params_init,
  deps: [],
};

function uiStyleCompute(style: UIStyleImpl): void {
  let id_chain = style.id_chain;
  // TODO: do similar inheritance for every parameter
  let text_height!: number;
  let button_width!: number;
  let button_height!: number;
  for (let ii = 0; ii < id_chain.length; ++ii) {
    let id = id_chain[ii];
    let entry = style_params[id];
    assert(entry);
    let v = entry.def.text_height;
    if (v !== undefined) {
      if (typeof v === 'string') {
        let m = v.match(/^(\d+)%$/);
        assert(m);
        text_height *= Number(m[1])/100;
      } else {
        assert.equal(typeof v, 'number');
        text_height = v;
      }
    }
    v = entry.def.button_width;
    if (v !== undefined) {
      if (typeof v === 'string') {
        let m = v.match(/^(\d+)%$/);
        assert(m);
        button_width *= Number(m[1])/100;
      } else {
        assert.equal(typeof v, 'number');
        button_width = v;
      }
    }
    v = entry.def.button_height;
    if (v !== undefined) {
      if (typeof v === 'string') {
        let m = v.match(/^(\d+)%$/);
        assert(m);
        button_height *= Number(m[1])/100;
      } else {
        assert.equal(typeof v, 'number');
        button_height = v;
      }
    }
    if (ii === 0) {
      // First step, should always get valid values from the default style
      assert(typeof text_height === 'number');
      assert(typeof button_width === 'number');
      assert(typeof button_height === 'number');
    }
  }
  style.text_height = text_height;
  style.button_width = button_width;
  style.button_height = button_height;
}

// Potentially very slow!  Load-time/dev-time only
export function uiStyleModify(style: UIStyle, params: UIStyleDef): void {
  let id = tail((style as UIStyleImpl).id_chain);
  assert(id);
  let entry = style_params[id];
  assert(entry);
  let def = entry.def as DataObject;
  for (let key in params) {
    let v = (params as DataObject)[key];
    if (v === undefined) {
      delete def[key];
    } else {
      def[key] = v;
    }
  }
  for (let ii = 0; ii < entry.deps.length; ++ii) {
    let style_walk = entry.deps[ii];
    uiStyleCompute(style_walk);
    if (style_walk === ui_style_current) {
      uiApplyStyle(ui_style_current);
    }
  }
}

export type UIStyleReference = string | UIStyleDef;
export function uiStyleAlloc(...args: UIStyleReference[]): UIStyle {
  let id_chain: string[] = [];
  id_chain.push('default');
  for (let ii = 0; ii < args.length; ++ii) {
    let v = args[ii];
    let id: string;
    if (typeof v === 'string') {
      id = v;
      assert(style_params[v]); // TODO: dataError instead
    } else {
      id = `$${++style_param_auto_last_idx})`;
      style_params[id] = {
        def: v,
        deps: [],
      };
    }
    id_chain.push(id);
  }
  let ret = new UIStyleImpl(id_chain);
  uiStyleCompute(ret);
  for (let ii = 0; ii < id_chain.length; ++ii) {
    let id = id_chain[ii];
    style_params[id]!.deps.push(ret);
  }
  return ret;
}

export function uiStyleDefault(): UIStyle {
  return ui_style_default;
}

export function uiStyleCurrent(): UIStyle {
  return ui_style_current;
}

export function uiStyleSetCurrent(style: UIStyle): void {
  ui_style_current = style;
  uiApplyStyle(ui_style_current);
}

ui_style_default = uiStyleAlloc();
uiStyleSetCurrent(ui_style_default);

let style_stack: UIStyle[] = [];
export function uiStylePush(style: UIStyle): void {
  style_stack.push(ui_style_current);
  uiStyleSetCurrent(style);
}

export function uiStylePop(): void {
  let popped = style_stack.pop();
  assert(popped);
  uiStyleSetCurrent(popped);
}

let did_once = false;
export function uiStyleTopOfFrame(): void {
  if (style_stack.length) {
    if (!did_once) {
      did_once = true;
      verify(!style_stack.length, 'Style stack push/pop mismatch');
    }
    style_stack.length = 0;
  }
}
