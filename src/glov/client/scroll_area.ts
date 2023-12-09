// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import { clamp, merge } from 'glov/common/util';
import { Vec4, vec2, vec4 } from 'glov/common/vmath';
import * as camera2d from './camera2d';
import * as engine from './engine';
import { renderNeeded } from './engine';
import { Box } from './geom_types';
import * as input from './input';
import {
  BUTTON_LEFT,
  KEYS,
  PAD,
} from './input';
import {
  SPOT_DEFAULT_BUTTON,
  SPOT_STATE_DOWN,
  SPOT_STATE_FOCUSED,
  spot,
  spotPadMode,
  spotSubBegin,
  spotSubEnd,
  spotUnfocus,
} from './spot';
import { spriteClipPop, spriteClipPush } from './sprites';
import * as ui from './ui';
import { uiTextHeight } from './ui';

const { abs, max, min, round } = Math;

// TODO: move FocusableElement to appropriate TS file after conversion (probably input)
interface FocusableElement {
  focus: () => void;
  is_focused: boolean;
}

const MAX_OVERSCROLL = 50;
const OVERSCROLL_DELAY_WHEEL = 180;

function darken(color: Vec4, factor: number): Vec4 {
  return vec4(color[0] * factor, color[1] * factor, color[2] * factor, color[3]);
}

let default_pixel_scale = 1;
export function scrollAreaSetPixelScale(scale: number): void {
  default_pixel_scale = scale;
}

interface ScrollAreaOptsAll extends Box {
  // configuration options
  z: number;
  // h: number (from Box) is height of visible area, not interior scrolled area
  rate_scroll_click: number;
  pixel_scale: number;
  top_pad: boolean; // set to false it the top/bottom "buttons" don't look like buttons
  color: Vec4;
  background_color: Vec4 | null;
  auto_scroll: boolean; // If true, will scroll to the bottom if the height changes and we're not actively scrolling
  auto_hide: boolean; // If true, will hide the scroll bar when the scroll area does not require it
  no_disable: boolean; // Use with auto_hide=false to always do scrolling actions (overscroll, mousewheel)
  focusable_elem: FocusableElement | null; // Another element to call .focus() on if we think we are focused
  min_dist: number | undefined; // Minimum drag distance for background drag
  disabled: boolean;

  // Calculated (only once) if not set
  rate_scroll_wheel: number;
  rollover_color: Vec4;
  rollover_color_light: Vec4;
  disabled_color: Vec4;
}

export type ScrollAreaOpts = Partial<ScrollAreaOptsAll>;

export interface ScrollArea extends Readonly<ScrollAreaOptsAll> {
  resetScroll(): void;
  barWidth(): number;
  isFocused(): boolean;
  consumedClick(): boolean;
  isVisible(): boolean;
  begin(params?: ScrollAreaOpts): void;
  // Includes overscroll - actual visible scroll pos for this frame
  getScrollPos(): number;
  keyboardScroll(): void;
  end(h: number): void;
  // h is height of visible area
  scrollIntoFocus(miny: number, maxy: number, h: number): void;
}

let temp_pos = vec2();
let last_scroll_area_id = 0;
class ScrollAreaInternal implements ScrollArea {
  id = `sa:${++last_scroll_area_id}`;
  x = 0;
  y = 0;
  z = Z.UI;
  w = 10;
  h = 10;
  rate_scroll_click = uiTextHeight();
  pixel_scale = default_pixel_scale;
  top_pad = true;
  color = vec4(1,1,1,1);
  background_color: Vec4 | null = vec4(0.4, 0.4, 0.4, 1);
  auto_scroll = false;
  auto_hide = false;
  no_disable = false;
  focusable_elem: FocusableElement | null = null;
  min_dist: number | undefined;
  disabled = false;

  // Calculated (only once) if not set
  rate_scroll_wheel;
  rollover_color;
  rollover_color_light;
  disabled_color;

  // run-time state
  scroll_pos = 0;
  overscroll = 0; // overscroll beyond beginning or end
  overscroll_delay = 0;
  grabbed_pos = 0;
  grabbed = false;
  consumed_click = false;
  drag_start: number | null = null;
  began = false;
  last_internal_h = 0;
  last_frame = 0;
  was_disabled = false;
  scrollbar_visible = false;
  last_max_value = 0;
  ignore_this_fram_drag = false;

  constructor(params?: ScrollAreaOpts) {
    params = params || {};
    this.applyParams(params);
    this.rate_scroll_wheel = params.rate_scroll_wheel || this.rate_scroll_click * 2;
    this.rollover_color = params.rollover_color || darken(this.color, 0.75);
    this.rollover_color_light = params.rollover_color_light || darken(this.color, 0.95);
    // equality is used to detect if this gets used and prevent rollover
    assert(this.rollover_color_light !== this.color);
    this.disabled_color = params.disabled_color || this.rollover_color;
  }

  applyParams(params?: ScrollAreaOpts): void {
    if (!params) {
      return;
    }
    merge(this, params);
  }

  barWidth(): number {
    let { pixel_scale } = this;
    let { scrollbar_top } = ui.sprites;
    return scrollbar_top.uidata.total_w * pixel_scale;
  }

  isFocused(): boolean {
    assert(false, 'deprecated?');
    return false;
  }

  consumedClick(): boolean {
    return this.consumed_click;
  }

  isVisible(): boolean {
    return this.scrollbar_visible;
  }

  begin(params?: ScrollAreaOpts): void {
    this.applyParams(params);
    let { x, y, w, h, z, id } = this;
    // verify(!this.began); // Checking mismatched begin/end - likely from previous frame crash though!
    this.began = true;
    spotSubBegin({ x, y, w, h, key: id });
    // Set up camera and clippers
    spriteClipPush(z + 0.05, x, y, w - this.barWidth(), h);
    let camera_orig_x0 = camera2d.x0();
    let camera_orig_x1 = camera2d.x1();
    let camera_orig_y0 = camera2d.y0();
    let camera_orig_y1 = camera2d.y1();
    // map (0,0) onto (x,y) in the current camera space, keeping w/h scale the same
    let camera_new_x0 = -(x - camera_orig_x0);
    let camera_new_y0 = -(y - camera_orig_y0) + this.getScrollPos();
    let camera_new_x1 = camera_new_x0 + camera_orig_x1 - camera_orig_x0;
    let camera_new_y1 = camera_new_y0 + camera_orig_y1 - camera_orig_y0;
    camera2d.push();
    camera2d.set(camera_new_x0, camera_new_y0, camera_new_x1, camera_new_y1);
    this.ignore_this_fram_drag = false;
  }

  // Includes overscroll - actual visible scroll pos for this frame
  getScrollPos(): number {
    return round(this.scroll_pos + this.overscroll);
  }

  clampScrollPos(): void {
    let clamped_pos = clamp(this.scroll_pos, 0, this.last_max_value);
    if (this.scroll_pos < 0) {
      this.overscroll = max(this.scroll_pos, -MAX_OVERSCROLL);
    } else if (this.scroll_pos > this.last_max_value) {
      this.overscroll = min(this.scroll_pos - this.last_max_value, MAX_OVERSCROLL);
    }
    this.scroll_pos = clamped_pos;
  }

  keyboardScroll(): void {
    if (this.was_disabled) {
      return;
    }
    let modified = false;
    let pad_shift = input.padButtonDown(PAD.RIGHT_TRIGGER) || input.padButtonDown(PAD.LEFT_TRIGGER);
    let value = input.keyDownEdge(KEYS.PAGEDOWN) +
      (pad_shift ? input.padButtonDownEdge(PAD.DOWN) : 0);
    if (value) {
      // don't overscroll on pageup/pagedown unless we're already at the end
      this.scroll_pos = min(this.scroll_pos + this.h,
        this.scroll_pos === this.last_max_value ? Infinity : this.last_max_value);
      modified = true;
    }
    value = input.keyDownEdge(KEYS.PAGEUP) +
      (pad_shift ? input.padButtonDownEdge(PAD.UP) : 0);
    if (value) {
      this.scroll_pos = max(this.scroll_pos - this.h,
        this.scroll_pos === 0 ? -this.h : 0);
      modified = true;
    }

    if (modified) {
      this.clampScrollPos();
    }
  }

  end(h: number): void {
    //ScrollAreaDisplay *display = OR(this.display, &scroll_area_display_default);
    assert(h >= 0);
    h = max(h, 1); // prevent math from going awry on height of 0
    assert(this.began); // Checking mismatched begin/end
    this.began = false;
    this.consumed_click = false;
    let focused_sub_elem = spotSubEnd();
    // restore camera and clippers
    camera2d.pop();
    spriteClipPop();

    if (focused_sub_elem && spotPadMode()) {
      // assumes the focus'd spot was in the same camera transform, if not, need to adapt to use .dom_pos instead
      this.scrollIntoFocus(focused_sub_elem.y, focused_sub_elem.y + focused_sub_elem.h + 1, this.h);
    }

    let maxvalue = max(h - this.h+1, 0);
    if (this.scroll_pos > maxvalue) {
      // internal height must have shrunk, or we otherwise scrolled farther than allowed
      let extra = this.scroll_pos - maxvalue;
      this.scroll_pos = max(0, maxvalue);
      if (this.overscroll < 0) {
        // Remove any overscroll that corresponds to this extra (e.g. from scrollIntoFocus)
        this.overscroll = min(this.overscroll + extra, 0);
      }
    }

    let was_at_bottom = this.scroll_pos === this.last_max_value;
    if (this.auto_scroll && (
      this.last_frame !== engine.getFrameIndex() - 1 || // was not seen last frame, do a reset
      this.last_internal_h !== h && was_at_bottom
    )) {
      // We were at the bottom, but we are now not, and auto-scroll is enabled
      // want to be at the bottom, scroll down (effective next frame for the contents,
      // but this frame for the handle, to prevent flicker)
      this.overscroll = max(0, this.scroll_pos + this.overscroll - maxvalue);
      this.scroll_pos = maxvalue;
    }
    this.last_internal_h = h;
    this.last_frame = engine.getFrameIndex();


    if (this.overscroll) {
      let dt = engine.getFrameDt();
      if (dt >= this.overscroll_delay) {
        this.overscroll_delay = 0;
        this.overscroll *= max(1 - dt * 0.008, 0);
        if (abs(this.overscroll) < 0.001) {
          this.overscroll = 0;
        }
      } else {
        this.overscroll_delay -= dt;
      }
      renderNeeded();
    }

    let {
      auto_hide,
      pixel_scale,
      rollover_color,
      rollover_color_light,
    } = this;

    let {
      scrollbar_top, scrollbar_bottom, scrollbar_trough, scrollbar_handle, scrollbar_handle_grabber
    } = ui.sprites;

    let bar_w = scrollbar_top.uidata.total_w * pixel_scale;
    let button_h = min(scrollbar_top.uidata.total_h * pixel_scale, this.h / 3);
    let button_h_nopad = this.top_pad ? button_h : 0;
    let bar_x0 = this.x + this.w - bar_w;
    let handle_h = this.h / h; // How much of the area is visible
    handle_h = clamp(handle_h, 0, 1);
    let handle_pos = (this.h >= h) ? 0 : (this.scroll_pos / (h - this.h));
    handle_pos = clamp(handle_pos, 0, 1);
    assert(isFinite(handle_pos));
    let handle_pixel_h = handle_h * (this.h - button_h_nopad * 2);
    let handle_pixel_min_h = scrollbar_handle.uidata.total_h * pixel_scale;
    let trough_height = this.h - button_h * 2;
    handle_pixel_h = max(handle_pixel_h, min(handle_pixel_min_h, trough_height * 0.75));
    let handle_screenpos = this.y + button_h_nopad + handle_pos * (this.h - button_h_nopad * 2 - handle_pixel_h);
    // TODO: round handle_screenpos in pixely modes?
    let top_color = this.color;
    let bottom_color = this.color;
    let handle_color = this.color;
    let trough_color = this.color;
    let disabled = this.disabled;
    let auto_hidden = false;
    if (!this.h) {
      disabled = true;
      auto_hidden = true;
    } else if (handle_h === 1) {
      auto_hidden = true;
      if (this.no_disable) {
        // Just *look* disabled, but still do overscroll, eat mousewheel events
        trough_color = top_color = bottom_color = handle_color = this.disabled_color;
      } else {
        disabled = true;
      }
    }
    this.was_disabled = disabled;

    let gained_focus = false;

    // Handle UI interactions
    if (disabled) {
      trough_color = top_color = bottom_color = handle_color = this.disabled_color;
      this.drag_start = null;
    } else {
      // handle scroll wheel
      let wheel_delta = input.mouseWheel({
        x: this.x,
        y: this.y,
        w: this.w,
        h: this.h
      });
      if (wheel_delta) {
        this.overscroll_delay = OVERSCROLL_DELAY_WHEEL;
        this.scroll_pos -= this.rate_scroll_wheel * wheel_delta;
        if (focused_sub_elem) {
          spotUnfocus();
        }
      }

      // handle drag of handle
      // before end buttons, as those might be effectively hidden in some UIs
      let handle_rect = {
        x: bar_x0,
        y: handle_screenpos,
        w: bar_w,
        h: handle_pixel_h,
        button: 0,
        spot_debug_ignore: true,
      };

      let down = input.mouseDownEdge(handle_rect);
      if (down) {
        this.grabbed_pos = (down.pos[1] - handle_screenpos);
        this.grabbed = true;
        handle_color = rollover_color_light;
      }
      if (this.grabbed) {
        gained_focus = true;
      }
      if (this.grabbed) {
        // update pos
        let up = input.mouseUpEdge({ button: 0 });
        if (up) {
          temp_pos[1] = up.pos[1];
          this.consumed_click = true;
        } else if (!input.mouseDownAnywhere(0)) {
          // released but someone else ate it, release anyway!
          this.grabbed = false;
          this.consumed_click = true;
        } else {
          input.mousePos(temp_pos);
        }
        if (this.grabbed) {
          let delta = temp_pos[1] - (this.y + button_h_nopad) - this.grabbed_pos;
          let denom = this.h - button_h_nopad * 2 - handle_pixel_h;
          if (denom > 0) {
            this.scroll_pos = (h - this.h) * delta / denom;
            assert(isFinite(this.scroll_pos));
          }
          handle_color = rollover_color_light;
        }
      }
      if (input.mouseOver(handle_rect)) {
        if (handle_color !== rollover_color_light) {
          handle_color = rollover_color;
        }
      }

      // handle clicking on end buttons
      let button_param_up = {
        x: bar_x0,
        y: this.y,
        w: bar_w,
        h: button_h,
        button: BUTTON_LEFT,
        pad_focusable: false,
        disabled: this.grabbed,
        disabled_focusable: false,
        def: SPOT_DEFAULT_BUTTON,
      };
      let button_param_down = {
        ...button_param_up,
        y: this.y + this.h - button_h,
      };
      let button_spot_ret = spot(button_param_up);
      while (button_spot_ret.ret) {
        --button_spot_ret.ret;
        gained_focus = true;
        this.scroll_pos -= this.rate_scroll_click;
        this.consumed_click = true;
      }
      if (button_spot_ret.spot_state === SPOT_STATE_DOWN) {
        top_color = rollover_color_light;
      } else if (button_spot_ret.spot_state === SPOT_STATE_FOCUSED) {
        top_color = rollover_color;
      }
      button_spot_ret = spot(button_param_down);
      while (button_spot_ret.ret) {
        --button_spot_ret.ret;
        gained_focus = true;
        this.scroll_pos += this.rate_scroll_click;
        this.consumed_click = true;
      }
      if (button_spot_ret.spot_state === SPOT_STATE_DOWN) {
        bottom_color = rollover_color_light;
      } else if (button_spot_ret.spot_state === SPOT_STATE_FOCUSED) {
        bottom_color = rollover_color;
      }

      // handle clicking trough if not caught by anything above +/-
      let bar_param = {
        key: `bar_${this.id}`,
        x: bar_x0,
        y: this.y,
        w: bar_w,
        h: this.h,
        button: BUTTON_LEFT,
        sound_rollover: null,
        pad_focusable: false,
        def: SPOT_DEFAULT_BUTTON,
      };
      let bar_spot_ret = spot(bar_param);
      while (bar_spot_ret.ret) {
        --bar_spot_ret.ret;
        gained_focus = true;
        this.consumed_click = true;
        if (bar_spot_ret.pos) {
          if (bar_spot_ret.pos[1] > handle_screenpos + handle_pixel_h/2) {
            this.scroll_pos += this.h;
          } else {
            this.scroll_pos -= this.h;
          }
        }
      }

      // handle dragging the scroll area background
      let drag = input.drag({ x: this.x, y: this.y, w: this.w - bar_w, h: this.h, button: 0, min_dist: this.min_dist });
      if (drag && !this.ignore_this_fram_drag) {
        // Drag should not steal focus
        // This also fixes an interaction with chat_ui where clicking on the chat background (which causes
        //   a flicker of a drag) would cause pointer lock to be lost
        //spotFocusSteal(this);
        if (this.drag_start === null) {
          this.drag_start = this.scroll_pos;
        }
        this.scroll_pos = this.drag_start - drag.cur_pos[1] + drag.start_pos[1];
        this.consumed_click = true;
      } else {
        this.drag_start = null;
      }
      // Also eat drag for bar area, we handle it
      input.drag({ x: this.x + this.w - bar_w, y: this.y, w: bar_w, h: this.h, button: 0 });
    }

    if (gained_focus && this.focusable_elem) {
      this.focusable_elem.focus();
    }

    this.last_max_value = maxvalue;
    this.clampScrollPos();

    if (this.background_color) {
      ui.drawRect(this.x, this.y, this.x + this.w, this.y + this.h, this.z, this.background_color);
    }

    if (disabled && (auto_hide && auto_hidden || !this.h)) {
      this.scrollbar_visible = false;
      return;
    }
    this.scrollbar_visible = true;

    scrollbar_top.draw({
      x: bar_x0, y: this.y, z: this.z + 0.2,
      w: bar_w, h: button_h,
      color: top_color,
    });
    scrollbar_bottom.draw({
      x: bar_x0, y: this.y + this.h - button_h, z: this.z + 0.2,
      w: bar_w, h: button_h,
      color: bottom_color,
    });
    let trough_draw_pad = button_h / 2;
    let trough_draw_height = trough_height + trough_draw_pad * 2;
    let trough_v0 = -trough_draw_pad / pixel_scale / scrollbar_trough.uidata.total_h;
    let trough_v1 = trough_v0 + trough_draw_height / pixel_scale / scrollbar_trough.uidata.total_h;
    scrollbar_trough.draw({
      x: bar_x0, y: this.y + trough_draw_pad, z: this.z+0.1,
      w: bar_w, h: trough_draw_height,
      uvs: [scrollbar_trough.uvs[0], trough_v0, scrollbar_trough.uvs[2], trough_v1],
      color: trough_color,
    });

    ui.drawVBox({
      x: bar_x0, y: handle_screenpos, z: this.z + 0.3,
      w: bar_w, h: handle_pixel_h,
    }, scrollbar_handle, handle_color);
    let grabber_h = scrollbar_handle_grabber.uidata.total_h * pixel_scale;
    scrollbar_handle_grabber.draw({
      x: bar_x0, y: handle_screenpos + (handle_pixel_h - grabber_h) / 2, z: this.z + 0.4,
      w: bar_w, h: grabber_h,
      color: handle_color,
    });
  }

  // h is height of visible area
  scrollIntoFocus(miny: number, maxy: number, h: number): void {
    let old_scroll_pos = this.scroll_pos;
    let changed = false;
    miny = max(miny, 0);
    if (miny < this.scroll_pos) {
      this.scroll_pos = miny;
      changed = true;
    }
    maxy -= h;
    if (maxy > this.scroll_pos) {
      this.scroll_pos = maxy;
      changed = true;
    }
    if (changed) {
      // Make it smooth/bouncy a bit
      this.overscroll = old_scroll_pos - this.scroll_pos;
    }
    this.ignore_this_fram_drag = true;
  }

  scrollToEnd(): void {
    this.scroll_pos = this.last_max_value;
  }

  resetScroll(): void {
    this.scroll_pos = 0;
    this.overscroll = 0;
  }
}

export function scrollAreaCreate(params?: ScrollAreaOpts): ScrollArea {
  return new ScrollAreaInternal(params);
}
