// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint complexity:off */

// eslint-disable-next-line @typescript-eslint/no-use-before-define
exports.create = selectionBoxCreate;

import * as assert from 'assert';
const { max, round, sin } = Math;
import { clamp, cloneShallow, easeIn, merge } from 'glov/common/util.js';
import { v4copy, vec4 } from 'glov/common/vmath.js';
import * as camera2d from './camera2d.js';
import * as glov_engine from './engine.js';
import * as glov_font from './font.js';
import {
  KEYS,
  PAD,
  drag,
  keyDownEdge,
  mouseButtonHadUpEdge,
  padButtonDown,
  padButtonDownEdge,
} from './input.js';
import { link } from './link.js';
import { scrollAreaCreate } from './scroll_area.js';
import {
  SPOT_DEFAULT_BUTTON,
  SPOT_NAV_DOWN,
  SPOT_NAV_LEFT,
  SPOT_NAV_RIGHT,
  SPOT_NAV_UP,
  SPOT_STATE_DISABLED,
  SPOT_STATE_DOWN,
  SPOT_STATE_FOCUSED,
  SPOT_STATE_REGULAR,
  spot,
  spotFocusSteal,
  spotPadMode,
  spotSubBegin,
  spotSubEnd,
  spotSubPop,
  spotSubPush,
} from './spot.js';
import { spriteClipPause, spriteClipResume, spriteClipped } from './sprites.js';
import {
  drawHBox,
  getUIElemData,
  playUISound,
  uiButtonHeight,
  uiButtonWidth,
  uiFontStyleFocused,
  uiFontStyleNormal,
  uiGetFont,
  uiTextHeight,
} from './ui.js';
import * as glov_ui from './ui.js';

let glov_markup = null; // Not ported

let last_key_id = 0;

let font;

const selbox_font_style_default = glov_font.style(null, {
  color: 0xDFDFDFff,
});

const selbox_font_style_selected = glov_font.style(null, {
  color: 0xFFFFFFff,
});

const selbox_font_style_down = glov_font.style(null, {
  color: 0x000000ff,
});

const selbox_font_style_disabled = glov_font.style(null, {
  color: 0x808080ff,
});

const pad = 8;

const color_white = vec4(1, 1, 1, 1);

let color_temp_fade = vec4(1,1,1,1);
export function selboxDefaultDrawItemBackground({
  item_idx, item,
  x, y, z,
  w, h,
  image_set, color,
  image_set_extra, image_set_extra_alpha,
}) {
  drawHBox({ x, y, z, w, h },
    image_set, color);
  if (image_set_extra && image_set_extra_alpha) {
    v4copy(color_temp_fade, color);
    color_temp_fade[3] *= easeIn(image_set_extra_alpha, 2);
    drawHBox({ x, y, z: z + 0.001, w, h },
      image_set_extra, color_temp_fade);
  }
}

export function selboxDefaultDrawItemText({
  item_idx, item,
  x, y, z,
  w, h,
  display,
  font_height,
  style,
}) {
  let text_z = z + 1;
  // spriteListClipperPush(x, y + yoffs, eff_width - pad, h);
  let did_tab = false;
  if (display.tab_stop) {
    let str = item.name;
    let tab_idx = str.indexOf('\t');
    if (tab_idx !== -1) {
      did_tab = true;
      let pre = str.slice(0, tab_idx);
      let post = str.slice(tab_idx + 1);
      let x1 = x + display.xpad;
      let x2 = x + display.xpad + display.tab_stop + pad;
      let w1 = display.tab_stop;
      let w2 = w - display.tab_stop - display.xpad * 2 - pad;
      if (display.use_markup) {
        let md = {};
        md.align = glov_font.ALIGN.HFIT;
        md.x_size = md.y_size = font_height;
        md.w = w1;
        md.h = 1;
        md.style = style;
        glov_markup.print(md, x1, y, text_z, pre);
        md.w = w2;
        glov_markup.print(md, x2, y, text_z, post);
      } else {
        font.drawSizedAligned(style, x1, y, text_z, font_height,
          glov_font.ALIGN.HFIT | glov_font.ALIGN.VCENTER,
          w1, h, pre);
        font.drawSizedAligned(style, x2, y, text_z, font_height,
          glov_font.ALIGN.HFIT | glov_font.ALIGN.VCENTER,
          w2, h, post);
      }
    }
  }
  if (!did_tab) {
    let md = {};
    md.align = (item.centered || display.centered ? glov_font.ALIGN.HCENTERFIT : glov_font.ALIGN.HFIT) |
      glov_font.ALIGN.VCENTER;
    md.x_size = md.y_size = font_height;
    md.w = w - display.xpad * 2;
    md.h = h;
    md.style = style;
    let xx = x + display.xpad;
    if (display.use_markup) {
      glov_markup.print(md, xx, y, text_z, item.name);
    } else {
      font.drawSizedAligned(md.style, xx, y, text_z, md.x_size,
        md.align, md.w, md.h, item.name);
    }
  }
  // spriteListClipperPop();
  // if (display.selection_highlight && this.selected === i && show_selection) {
  //   let grow = 0.2 * (1 - bounce_amt);
  //   display.selection_highlight.DrawStretched(
  //     x - grow * w, y - grow * h, text_z + 1.5,
  //     w * (1 + 2 * grow), h * (1 + 2 * grow), 0, 0xFF);
  // }
}

export function selboxDefaultDrawItem(param) {
  selboxDefaultDrawItemBackground(param);
  selboxDefaultDrawItemText(param);
}


export const default_display = {
  style_default: selbox_font_style_default,
  style_selected: selbox_font_style_selected,
  style_disabled: selbox_font_style_disabled,
  style_down: selbox_font_style_down,
  color_default: color_white,
  color_selected: color_white,
  color_disabled: color_white,
  color_down: color_white,
  // old: no_buttons: false, instead pass `nop` to draw_cb
  draw_item_cb: selboxDefaultDrawItem,
  centered: false,
  bounce: true,
  tab_stop: 0,
  xpad: 8,
  selection_fade: Infinity, // alpha per millisecond
  // selection_highlight: null, // TODO: custom / better selection highlight for menus
  use_markup: false, // always false, Markup not ported
};


const color_gray80 = vec4(0.500, 0.500, 0.500, 1.000);
const color_grayD0 = vec4(0.816, 0.816, 0.816, 1.000);
const COLORS = {
  [SPOT_STATE_REGULAR]: color_white,
  [SPOT_STATE_DOWN]: color_grayD0,
  [SPOT_STATE_FOCUSED]: color_grayD0,
  [SPOT_STATE_DISABLED]: color_gray80,
};

const SELBOX_BOUNCE_TIME = 80;

// Used by GlovSimpleMenu and GlovSelectionBox and GlovDropDown
export class GlovMenuItem {
  constructor(params) {
    params = params || {};
    if (params instanceof GlovMenuItem) {
      for (let field in params) {
        this[field] = params[field];
      }
      return;
    }
    if (typeof params === 'string') {
      params = { name: params };
    }
    this.name = params.name || 'NO_NAME'; // name to display
    this.state = params.state || null; // state to set upon selection
    this.cb = params.cb || null; // callback to call upon selection
    // TODO - cb function on value change?
    this.value = params.value === undefined ? null : params.value; // can be number or string
    this.value_min = params.value_min || 0;
    this.value_max = params.value_max || 0;
    this.value_inc = params.value_inc || 0;
    this.href = params.href || null; // for links
    this.tag = params.tag || null; // for isSelected(tag)
    this.style = params.style || null;
    // was bitmask
    this.exit = Boolean(params.exit);
    this.prompt_int = Boolean(params.prompt_int);
    this.prompt_string = Boolean(params.prompt_string);
    this.no_sound = Boolean(params.no_sound);
    this.slider = Boolean(params.slider);
    this.no_controller_exit = Boolean(params.no_controller_exit);
    this.plus_minus = Boolean(params.plus_minus);
    this.disabled = Boolean(params.disabled);
    this.centered = Boolean(params.centered);
    this.auto_focus = Boolean(params.auto_focus);
    this.selection_alpha = 0;
  }
}


class SelectionBoxBase {
  constructor(params) {
    assert(!params.auto_unfocus, 'Old parameter: auto_unfocus');
    // Options (and defaults)
    this.key = `dd${++last_key_id}`;
    this.x = 0;
    this.y = 0;
    this.z = Z.UI;
    this.width = uiButtonWidth();
    this.items = [];
    this.disabled = false;
    this.display = cloneShallow(default_display);
    this.scroll_height = 0;
    this.font_height = uiTextHeight();
    this.entry_height = uiButtonHeight();
    this.auto_reset = true;
    this.reset_selection = false;
    this.initial_selection = 0;
    this.show_as_focused = -1;
    this.applyParams(params);

    // Run-time inter-frame state
    this.selected = 0;
    this.was_clicked = false;
    this.was_right_clicked = false;
    this.is_focused = false;
    this.expected_frame_index = 0;
    // Run-time intra-frame state
    this.ctx = {};
    if (this.is_dropdown || this.scroll_height) {
      this.sa = scrollAreaCreate({
        //focusable_elem: this,
        //background_color: null,
      });
    }
  }

  applyParams(params) {
    if (!params) {
      return;
    }
    for (let f in params) {
      if (f === 'items') {
        this.items = params.items.map((item) => new GlovMenuItem(item));
      } else if (f === 'display') {
        merge(this.display, params[f]);
      } else {
        this[f] = params[f];
      }
    }
  }

  wasClicked() {
    return this.was_clicked;
  }

  wasRightClicked() {
    return this.was_right_clicked;
  }

  isSelected(tag_or_index) {
    if (typeof tag_or_index === 'number') {
      return this.selected === tag_or_index;
    }
    return this.items[this.selected].tag === tag_or_index;
  }

  getSelected() {
    return this.items[this.selected];
  }

  findIndex(tag_or_index) {
    if (typeof tag_or_index === 'number') {
      assert(tag_or_index < this.items.length);
      return tag_or_index;
    } else {
      for (let ii = 0; ii < this.items.length; ++ii) {
        if (this.items[ii].tag === tag_or_index) {
          return ii;
        }
      }
    }
    return -1;
  }

  setSelected(tag_or_index) {
    let idx = this.findIndex(tag_or_index);
    if (idx !== -1) {
      this.selected = idx;
    }
  }

  handleInitialSelection() {
    let { auto_reset } = this;
    if (this.reset_selection || auto_reset && this.expected_frame_index !== glov_engine.getFrameIndex()) {
      this.reset_selection = false;
      // Reset
      if (this.items[this.initial_selection] && !this.items[this.initial_selection].disabled) {
        this.selected = this.initial_selection;
      } else {
        // Selection out of range or disabled, select first non-disabled entry
        for (let ii = 0; ii < this.items.length; ++ii) {
          if (!this.items[ii].disabled) {
            this.selected = ii;
            break;
          }
        }
      }
    }
  }

  runPrep(y) {
    let { ctx, entry_height, is_dropdown } = this;
    this.was_clicked = false;
    this.was_right_clicked = false;

    let num_non_disabled_selections = 0;
    let first_non_disabled_selection = -1;
    let last_non_disabled_selection = -1;
    for (let ii = 0; ii < this.items.length; ++ii) {
      let item = this.items[ii];
      if (!item.disabled) {
        if (first_non_disabled_selection === -1) {
          first_non_disabled_selection = ii;
        }
        num_non_disabled_selections++;
        last_non_disabled_selection = ii;
      }
    }
    // This is OK, can have an empty selection box: assert(num_non_disabled_selections);

    let scroll_height = this.scroll_height;
    if (!scroll_height && is_dropdown) {
      scroll_height = camera2d.y1() - (y + entry_height);
    }

    ctx.first_non_disabled_selection = first_non_disabled_selection;
    ctx.last_non_disabled_selection = last_non_disabled_selection;
    ctx.num_non_disabled_selections = num_non_disabled_selections;
    ctx.list_visible = !is_dropdown || this.dropdown_visible;
    ctx.scroll_height = scroll_height;
  }

  selectWalk(idx, delta) {
    let { ctx, selected: old_sel, key } = this;
    let {
      num_non_disabled_selections,
      first_non_disabled_selection,
      last_non_disabled_selection,
      list_visible,
    } = ctx;
    if (!num_non_disabled_selections) {
      this.selected = 0;
    } else if (idx >= last_non_disabled_selection) {
      this.selected = last_non_disabled_selection;
    } else if (idx <= first_non_disabled_selection) {
      this.selected = first_non_disabled_selection;
    } else {
      while (this.items[idx].disabled) {
        idx += delta;
      }
      this.selected = idx;
    }
    if (this.selected !== old_sel) {
      if (list_visible) {
        // Selection changed (via disabled states changing, or pad/keyboard operation,
        // Show the new focus
        spotFocusSteal({ key: `${key}_${this.selected}` });
      } else {
        this.was_clicked = true; // trigger value change immediately
      }
    }
  }
  // Select `idx`, or the next non-disabled selection after it
  selectForward(idx) {
    this.selectWalk(idx, 1);
  }

  // Select `idx` or the next non-disabled selection before it
  selectBackward(idx) {
    this.selectWalk(idx, -1);
  }

  doPadMovement() {
    let { ctx, entry_height } = this;
    let { list_visible, scroll_height } = ctx;
    let page_size = round(max(scroll_height - 1, 0) / entry_height);
    if (!list_visible) {
      // since arrows navigate to other elements, page up/down scroll the selection by one
      page_size = 1;
    }
    if (page_size) {
      let pad_shift = padButtonDown(PAD.RIGHT_TRIGGER) || padButtonDown(PAD.LEFT_TRIGGER);
      let value = keyDownEdge(KEYS.PAGEDOWN) +
        (pad_shift ? padButtonDownEdge(PAD.DOWN) : 0);
      if (value) {
        playUISound('rollover');
        this.selectForward(this.selected + page_size * value);
      }
      value = keyDownEdge(KEYS.PAGEUP) +
        (pad_shift ? padButtonDownEdge(PAD.UP) : 0);
      if (value) {
        playUISound('rollover');
        this.selectBackward(this.selected - page_size * value);
      }
    }
    if (keyDownEdge(KEYS.HOME)) {
      playUISound('rollover');
      this.selectForward(0);
    }
    if (keyDownEdge(KEYS.END)) {
      playUISound('rollover');
      this.selectBackward(Infinity);
    }
  }

  doList(x, y, z, do_scroll, eff_selection) {
    let {
      ctx,
      disabled,
      display,
      entry_height,
      font_height,
      key,
      selected: old_sel,
      show_as_focused,
      width,
    } = this;
    let { scroll_height } = ctx;
    let eff_width = width;
    const y_save = y;
    if (do_scroll) {
      this.sa.begin({
        x, y, z,
        w: width,
        h: scroll_height,
      });
      y = 0;
      x = 0;
      eff_width = width - this.sa.barWidth();
    } else if (this.is_dropdown) {
      // Need a spot sub here so that navigation within elements does not target
      //   other elements that happen to be behind the dropdown
      spotSubBegin({
        key,
        x, y, z,
        w: width,
        h: scroll_height || entry_height,
      });
    }
    let dt = glov_engine.getFrameDt();
    let any_focused = false;
    let { first_non_disabled_selection, last_non_disabled_selection } = ctx;
    for (let ii = 0; ii < this.items.length; ii++) {
      let item = this.items[ii];
      let entry_disabled = item.disabled;
      let image_set = null;
      let image_set_extra = null;
      let image_set_extra_alpha = 0;
      if (item.href) {
        link({
          x, y, w: width, h: entry_height,
          url: item.href,
        });
      }
      let entry_spot_rect = {
        def: SPOT_DEFAULT_BUTTON,
        key: `${key}_${ii}`,
        disabled: disabled || entry_disabled,
        disabled_focusable: false,
        x, y, w: width, h: entry_height,
        custom_nav: {
          [SPOT_NAV_RIGHT]: null,
          [SPOT_NAV_LEFT]: null,
        },
        auto_focus: item.auto_focus,
      };
      if (ii === first_non_disabled_selection && this.nav_loop) {
        entry_spot_rect.custom_nav[SPOT_NAV_UP] = `${key}_${last_non_disabled_selection}`;
      }
      if (ii === last_non_disabled_selection && this.nav_loop) {
        entry_spot_rect.custom_nav[SPOT_NAV_DOWN] = `${key}_${first_non_disabled_selection}`;
      }
      let entry_spot_ret = spot(entry_spot_rect);
      if (ii === show_as_focused) {
        entry_spot_ret.focused = true;
        entry_spot_ret.spot_state = SPOT_STATE_FOCUSED;
      }
      let focused_or_down = entry_spot_ret.focused || entry_spot_ret.spot_state === SPOT_STATE_DOWN;
      any_focused = any_focused || focused_or_down;
      if (item.slider || item.plus_minus) {
        // Allow left to negatively select
        if (entry_spot_ret.nav === SPOT_NAV_LEFT) {
          entry_spot_ret.nav = SPOT_NAV_RIGHT;
          entry_spot_ret.button = 2; // hack: right click is also treated as negative-select
        }
      }
      if (entry_spot_ret.nav === SPOT_NAV_RIGHT) {
        // select
        playUISound('button_click');
        entry_spot_ret.spot_state = SPOT_STATE_DOWN;
        entry_spot_ret.ret = true;
      }
      if (entry_spot_ret.ret) {
        // select
        this.was_clicked = true;
        this.was_right_clicked = entry_spot_ret.button === 2;
        this.selected = ii;
        this.onListSelect();
      }

      let bounce = false;
      if (focused_or_down) {
        this.selected = ii;
        if (!this.is_dropdown && display.bounce) {
          if (this.selected !== old_sel) {
            bounce = true;
            this.bounce_time = SELBOX_BOUNCE_TIME;
          } else if (dt >= this.bounce_time) {
            this.bounce_time = 0;
          } else {
            bounce = true;
            this.bounce_time -= dt;
          }
        }
      }
      if (entry_spot_ret.nav === SPOT_NAV_LEFT) {
        // cancel
        this.selected = eff_selection;
        this.onListSelect();
      }

      let color;
      let style;
      if (entry_spot_ret.spot_state === SPOT_STATE_DOWN || entry_spot_ret.spot_state === SPOT_STATE_FOCUSED) {
        style = display.style_selected || selbox_font_style_selected;
        color = display.color_selected || default_display.color_selected;
        item.selection_alpha = clamp(item.selection_alpha + dt * display.selection_fade, 0, 1);
        if (item.selection_alpha === 1) {
          image_set = glov_ui.sprites.menu_selected;
        } else {
          image_set = glov_ui.sprites.menu_entry;
          image_set_extra = glov_ui.sprites.menu_selected;
          image_set_extra_alpha = item.selection_alpha;
        }
        if (entry_spot_ret.spot_state === SPOT_STATE_DOWN) {
          if (glov_ui.sprites.menu_down) {
            image_set = glov_ui.sprites.menu_down;
            if (display.style_down) {
              style = display.style_down;
              color = display.color_down || default_display.color_down;
            }
          } else {
            style = display.style_down || selbox_font_style_down;
            color = display.color_down || default_display.color_down;
          }
        }
      } else {
        item.selection_alpha = clamp(item.selection_alpha - dt * display.selection_fade, 0, 1);
        if (item.selection_alpha !== 1) {
          image_set_extra = glov_ui.sprites.menu_selected;
          image_set_extra_alpha = item.selection_alpha;
        }
        if (entry_spot_ret.spot_state === SPOT_STATE_DISABLED) {
          style = display.style_disabled || selbox_font_style_disabled;
          color = display.color_disabled || default_display.color_disabled;
          image_set = glov_ui.sprites.menu_entry;
        } else {
          style = item.style || display.style_default || selbox_font_style_default;
          color = display.color_default || default_display.color_default;
          image_set = glov_ui.sprites.menu_entry;
        }
      }

      let yoffs = 0;
      if (bounce) {
        let bounce_amt = sin(this.bounce_time * 20 / SELBOX_BOUNCE_TIME / 10);
        yoffs = -4 * bounce_amt * entry_height / 32;
      }

      display.draw_item_cb({
        item_idx: ii, item,
        x, y: y + yoffs, z: z + 1,
        w: eff_width, h: entry_height,
        image_set, color,
        image_set_extra, image_set_extra_alpha,
        font_height,
        display,
        style,
      });

      if (entry_spot_ret.ret && item.href) {
        window.location.href = item.href;
      }
      y += entry_height;
    }
    ctx.scroll_area_consumed_click = false;
    if (do_scroll) {
      this.sa.end(y);
      ctx.scroll_area_consumed_click = this.sa.consumedClick();
      y = y_save + scroll_height;
    } else if (this.is_dropdown) {
      // Consume drag events (desired for drop-down menu temporarily overlapping a slider)
      drag({
        x, y: y_save,
        w: width,
        h: y - y_save,
      });
      spotSubEnd();
    }
    ctx.any_focused = any_focused;
    return y;
  }
}

class GlovSelectionBox extends SelectionBoxBase {
  constructor(params) {
    assert(!params.is_dropdown, 'Use dropDownCreate() instead');
    super(params);

    // Run-time state
    this.bounce_time = 0;
  }

  getHeight() {
    let { entry_height } = this;
    // if (this.is_dropdown) {
    //   return entry_height + 2;
    // }
    let list_height = this.items.length * entry_height;
    let do_scroll = this.scroll_height && this.items.length * entry_height > this.scroll_height;
    if (do_scroll) {
      list_height = this.scroll_height;
    }
    list_height += 2;
    return list_height + 3;
  }

  focus() {
    assert(false, 'deprecated?');
    // focus the currently select element?  top element?
    let { key } = this;
    spotFocusSteal({ key: `${key}_0` });
  }

  onListSelect() {
    // nothing
  }

  isDropdownVisible() {
    return false;
  }

  run(params) {
    this.applyParams(params);
    let { x, y, z, entry_height, ctx } = this;

    this.handleInitialSelection();

    let y0 = y;
    let yret;

    this.runPrep(y);

    let { scroll_height } = ctx;

    let do_scroll = scroll_height && this.items.length * entry_height > scroll_height;

    y = this.doList(x, y, z, do_scroll, this.selected);

    if (ctx.any_focused) {
      this.doPadMovement();
    }

    this.expected_frame_index = glov_engine.getFrameIndex() + 1;
    x = 10;
    y += 5;
    yret = y;
    assert.equal(yret - y0, this.getHeight());
    return yret - y0;
  }
}
GlovSelectionBox.prototype.is_dropdown = false;
GlovSelectionBox.prototype.nav_loop = false;

class GlovDropDown extends SelectionBoxBase {
  constructor(params) {
    assert(!params.is_dropdown, 'Old parameter: is_dropdown');
    super(params);

    // Run-time state
    this.dropdown_visible = false;
    this.last_selected = undefined;
  }

  isDropdownVisible() {
    return this.dropdown_visible;
  }

  focus() {
    assert(false, 'deprecated?');
    spotFocusSteal(this);
    this.is_focused = true;
  }

  onListSelect() {
    this.dropdown_visible = false;
    spotFocusSteal(this);
  }

  run(params) {
    this.applyParams(params);
    let { x, y, z, width, font_height, entry_height, disabled, key, display, ctx } = this;

    this.handleInitialSelection();

    if (this.last_selected !== undefined &&
      (this.last_selected >= this.items.length || this.items[this.last_selected].disabled)
    ) {
      this.last_selected = undefined;
    }

    let y0 = y;
    let yret;

    this.runPrep(y);

    let { first_non_disabled_selection, list_visible, scroll_height } = ctx;

    let root_spot_rect = {
      key,
      disabled,
      x, y,
      z: z + 2 - 0.1, // z used for checkHooks
      w: width, h: entry_height,
      def: SPOT_DEFAULT_BUTTON,
      custom_nav: {
        // left/right toggle the dropdown visibility - maybe make this customizable?
        [SPOT_NAV_RIGHT]: null,
      },
    };
    ctx.root_spot_rect = root_spot_rect;
    if (this.dropdown_visible) {
      root_spot_rect.custom_nav[SPOT_NAV_LEFT] = null;
      root_spot_rect.custom_nav[SPOT_NAV_DOWN] = `${key}_${first_non_disabled_selection}`;
    }
    let root_spot_ret = spot(root_spot_rect);
    this.is_focused = root_spot_ret.focused;

    if (root_spot_ret.kb_focused || list_visible) {
      this.doPadMovement();
    }

    // Ensure the current selection is not disabled
    this.selectForward(this.selected);

    let eff_selection = this.dropdown_visible && this.last_selected !== undefined ?
      this.last_selected :
      this.selected;

    if (this.dropdown_visible && (
      keyDownEdge(KEYS.ESC) || padButtonDownEdge(PAD.B)
    )) {
      this.selected = eff_selection;
      this.onListSelect();
    }

    // display header, respond to clicks
    if (root_spot_ret.ret || root_spot_ret.nav) {
      if (root_spot_ret.nav) {
        playUISound('button_click');
      }
      if (this.dropdown_visible) {
        this.selected = eff_selection;
        this.dropdown_visible = false;
      } else {
        this.dropdown_visible = true;
        this.last_selected = this.selected;
        if (spotPadMode()) {
          spotFocusSteal({ key: `${key}_${this.selected}` });
        }
      }
    }
    drawHBox({
      x, y, z: z + 1,
      w: width, h: entry_height
    }, glov_ui.sprites.menu_header, COLORS[root_spot_ret.spot_state]);
    let align = (display.centered ? glov_font.ALIGN.HCENTER : glov_font.ALIGN.HLEFT) |
      glov_font.ALIGN.HFIT | glov_font.ALIGN.VCENTER;
    font.drawSizedAligned(root_spot_ret.focused ? uiFontStyleFocused() : uiFontStyleNormal(),
      x + display.xpad, y, z + 2,
      font_height, align,
      width - display.xpad - glov_ui.sprites.menu_header.uidata.wh[2] * entry_height, entry_height,
      this.items[eff_selection].name);
    y += entry_height;
    yret = y + 2;

    if (this.dropdown_visible) {
      z += 1000; // drop-down part should be above everything except tooltips
      let clip_pause = spriteClipped();
      if (clip_pause) {
        spriteClipPause();
      }
      spotSubPush();
      let do_scroll = scroll_height && this.items.length * entry_height > scroll_height;
      if (!do_scroll && y + this.items.length * entry_height >= camera2d.y1()) {
        y = camera2d.y1() - this.items.length * entry_height;
      }

      this.doList(x, y, z, do_scroll, eff_selection);

      if (this.was_clicked) {
        this.dropdown_visible = false;
      }
      spotSubPop();
      if (clip_pause) {
        spriteClipResume();
      }

      let { any_focused, scroll_area_consumed_click } = ctx;
      if (root_spot_ret.ret || this.was_clicked) {
        any_focused = true;
      }
      this.is_focused = this.is_focused || any_focused;
      if (!any_focused) {
        // Nothing focused?  Don't preview any current selection.
        this.selected = eff_selection;
      }
      if (!any_focused && !root_spot_ret.focused && !scroll_area_consumed_click) {
        // Not focused, and not toggled this frame
        if (
          // Clicked anywhere else?
          mouseButtonHadUpEdge() ||
          // In pad mode
          spotPadMode()
        ) {
          // Cancel and close dropdown
          this.selected = eff_selection;
          this.dropdown_visible = false;
        }
      }
    }


    this.expected_frame_index = glov_engine.getFrameIndex() + 1;
    return yret - y0;
  }
}

GlovDropDown.prototype.is_dropdown = true;
GlovDropDown.prototype.nav_loop = true;


export function selectionBoxCreate(params) {
  if (!font) {
    font = uiGetFont();
  }
  return new GlovSelectionBox(params);
}

export function dropDownCreate(params) {
  if (!font) {
    font = uiGetFont();
  }
  return new GlovDropDown(params);
}

export function dropDown(param, current, opts) {
  opts = opts || {};
  param.auto_reset = false; // Handled every frame here automatically
  let { suppress_return_during_dropdown } = opts;
  // let dropdown = getUIElemData<SelectionBox, SelectionBoxOpts>('dropdown', param, dropDownCreate);
  let dropdown = getUIElemData('dropdown', param, dropDownCreate);
  dropdown.applyParams(param);
  if (!dropdown.isDropdownVisible()) {
    dropdown.setSelected(current);
  }
  let old_selected;
  if (suppress_return_during_dropdown) {
    let old_idx = dropdown.findIndex(current);
    old_selected = old_idx === -1 ? null : dropdown.items[old_idx];
  } else {
    old_selected = dropdown.getSelected();
  }
  dropdown.run();
  if (suppress_return_during_dropdown && dropdown.was_clicked ||
    !suppress_return_during_dropdown
  ) {
    if (old_selected !== dropdown.getSelected()) {
      // Return input item (which may have additional data lost upon conversion
      //   to a MenuItem), instead of `dropdown.getSelected()`
      return param.items[dropdown.selected];
    }
  }
  return null;
}
