// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// This is ported pretty directly from libGLOV, could really use a fresh
//   implementation that is more focus aware and gamepad friendly, and should
//   use ui.buttonShared logic.

const assert = require('assert');
const camera2d = require('./camera2d.js');
const engine = require('./engine.js');
const input = require('./input.js');
const { KEYS, PAD } = input;
const { max, min, round } = Math;
const { clipPush, clipPop } = require('./sprites.js');
const ui = require('./ui.js');
const { clamp } = require('glov/common/util.js');
const verify = require('glov/common/verify.js');
const { vec2, vec4 } = require('glov/common/vmath.js');

const MAX_OVERSCROLL = 50;
const OVERSCROLL_DELAY_WHEEL = 180;

function darken(color, factor) {
  return vec4(color[0] * factor, color[1] * factor, color[2] * factor, color[3]);
}

let default_pixel_scale = 1;
export function setPixelScale(scale) {
  default_pixel_scale = scale;
}

let last_scroll_area_id = 0;
function ScrollArea(params) {
  // configuration options
  this.id = ++last_scroll_area_id;
  this.x = 0;
  this.y = 0;
  this.z = Z.UI;
  this.w = 10;
  this.h = 10; // height of visible area, not scrolled area
  this.rate_scroll_click = ui.font_height;
  this.pixel_scale = default_pixel_scale;
  this.top_pad = true; // set to false it the top/bottom "buttons" don't look like buttons
  this.color = vec4(1,1,1,1);
  this.background_color = vec4(0.8, 0.8, 0.8, 1); // can be null
  this.auto_scroll = false; // If true, will scroll to the bottom if the height changes and we're not actively scrolling
  this.auto_hide = false; // If true, will hide the scroll bar when the scroll area does not require it
  this.no_disable = false; // Use with auto_hide=false to always do scrolling actions (overscroll, mousewheel)
  this.focusable_elem = null; // Another element to call .focus() on if we think we are focused
  this.min_dist = undefined; // Minimum drag distance for background drag
  this.disabled = false;
  this.applyParams(params);

  // Calculated (only once) if not set
  this.rate_scroll_wheel = this.rate_scroll_wheel || this.rate_scroll_click * 2;
  this.rollover_color = this.rollover_color || darken(this.color, 0.75);
  this.rollover_color_light = this.rollover_color_light || darken(this.color, 0.95);
  assert(this.rollover_color_light !== this.color); // equality is used to detect if this gets used and prevent rollover
  this.disabled_color = this.disabled_color || this.rollover_color;
  this.background_color_focused = this.background_color_focused || (
    this.background_color ? vec4(0.4, 0.4, 0.4, 1) : null
  );

  // run-time state
  this.scroll_pos = 0;
  this.overscroll = 0; // overscroll beyond beginning or end
  this.overscroll_delay = 0;
  this.grabbed_pos = 0;
  this.grabbed = false;
  this.drag_start = null;
  this.began = false;
  this.last_internal_h = 0;
  this.last_frame = 0;
  this.focused = false;
  this.was_disabled = false;
  this.scrollbar_visible = false;
  this.last_max_value = 0;
}

ScrollArea.prototype.applyParams = function (params) {
  if (!params) {
    return;
  }
  for (let f in params) {
    this[f] = params[f];
  }
};

ScrollArea.prototype.barWidth = function () {
  let { pixel_scale } = this;
  let { scrollbar_top } = ui.sprites;
  return scrollbar_top.uidata.total_w * pixel_scale;
};

ScrollArea.prototype.isFocused = function () {
  return this.focused;
};

ScrollArea.prototype.begin = function (params) {
  this.applyParams(params);
  let { x, y, w, h, z, id } = this;
  verify(!this.began); // Checking mismatched begin/end
  this.began = true;
  ui.focusIdSet(id);
  // Set up camera and clippers
  clipPush(z + 0.05, x, y, w - this.barWidth(), h);
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
};

// Includes overscroll - actual visible scroll pos for this frame
ScrollArea.prototype.getScrollPos = function () {
  return round(this.scroll_pos + this.overscroll);
};

ScrollArea.prototype.clampScrollPos = function () {
  let clamped_pos = clamp(this.scroll_pos, 0, this.last_max_value);
  if (this.scroll_pos < 0) {
    this.overscroll = max(this.scroll_pos, -MAX_OVERSCROLL);
  } else if (this.scroll_pos > this.last_max_value) {
    this.overscroll = min(this.scroll_pos - this.last_max_value, MAX_OVERSCROLL);
  }
  this.scroll_pos = clamped_pos;
};

ScrollArea.prototype.keyboardScroll = function () {
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
};

let temp_pos = vec2();
// h is height all members in the scroll area (can be more or less than visible height)
ScrollArea.prototype.end = function (h) {
  //ScrollAreaDisplay *display = OR(this.display, &scroll_area_display_default);
  assert(h >= 0);
  h = max(h, 1); // prevent math from going awry on height of 0
  assert(this.began); // Checking mismatched begin/end
  this.began = false;
  ui.focusIdSet(null);
  // restore camera and clippers
  camera2d.pop();
  clipPop();

  let maxvalue = max(h - this.h+1, 0);
  if (this.scroll_pos >= maxvalue) {
    // internal height must have shrunk
    this.scroll_pos = max(0, maxvalue);
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
    } else {
      this.overscroll_delay -= dt;
    }
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
  let handle_pos = (this.h > h) ? 0 : (this.scroll_pos / (h - this.h));
  handle_pos = clamp(handle_pos, 0, 1);
  let handle_pixel_h = handle_h * (this.h - button_h_nopad * 2);
  let handle_pixel_min_h = scrollbar_handle.uidata.total_h * pixel_scale;
  let trough_height = this.h - button_h * 2;
  handle_pixel_h = max(handle_pixel_h, min(handle_pixel_min_h, trough_height * 0.75));
  let handle_screenpos = round(this.y + button_h_nopad + handle_pos * (this.h - button_h_nopad * 2 - handle_pixel_h));
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
    }

    // handle drag of handle
    // before end buttons, as those might be effectively hidden in some UIs
    let down = input.mouseDownEdge({
      x: bar_x0,
      y: handle_screenpos,
      w: bar_w,
      h: handle_pixel_h,
      button: 0
    });
    if (down) {
      this.grabbed_pos = (down.pos[1] - handle_screenpos);
      this.grabbed = true;
      handle_color = rollover_color_light;
    }
    if (this.grabbed) {
      ui.focusSteal(this);
    }
    let up = this.grabbed && input.mouseUpEdge({ button: 0 });
    if (up) {
      this.grabbed = false;
      // update pos
      let delta = up.pos[1] - (this.y + button_h_nopad) - this.grabbed_pos;
      this.scroll_pos = (h - this.h) * delta / (this.h - button_h_nopad * 2 - handle_pixel_h);
      handle_color = rollover_color_light;
    }
    if (this.grabbed && !input.mouseDown({ button: 0 })) {
      // released but someone else ate it, release anyway!
      this.grabbed = false;
    }
    if (this.grabbed) {
      // update pos
      input.mousePos(temp_pos);
      let delta = temp_pos[1] - (this.y + button_h_nopad) - this.grabbed_pos;
      this.scroll_pos = (h - this.h) * delta / (this.h - button_h_nopad * 2 - handle_pixel_h);
      handle_color = rollover_color_light;
    }
    if (input.mouseOver({
      x: bar_x0,
      y: handle_screenpos,
      w: bar_w,
      h: handle_pixel_h
    })) {
      if (handle_color !== rollover_color_light) {
        handle_color = rollover_color;
      }
    }

    // handle clicking on end buttons
    let button_param = {
      x: bar_x0,
      y: this.y,
      w: bar_w,
      h: button_h,
      button: 0
    };
    while (input.mouseUpEdge(button_param)) {
      ui.focusSteal(this);
      top_color = rollover_color;
      this.scroll_pos -= this.rate_scroll_click;
    }
    if (input.mouseOver(button_param)) {
      top_color = rollover_color;
    }
    button_param.y = this.y + this.h - button_h;
    while (input.mouseUpEdge(button_param)) {
      ui.focusSteal(this);
      bottom_color = rollover_color;
      this.scroll_pos += this.rate_scroll_click;
    }
    if (input.mouseOver(button_param)) {
      bottom_color = rollover_color;
    }

    // handle clicking trough if not caught by anything above +/-
    let click;
    let bar_param = {
      x: bar_x0,
      y: this.y,
      w: bar_w,
      h: this.h,
      button: 0
    };
    while ((click = input.mouseUpEdge(bar_param))) {
      ui.focusSteal(this);
      if (click.pos[1] > handle_screenpos + handle_pixel_h/2) {
        this.scroll_pos += this.h;
      } else {
        this.scroll_pos -= this.h;
      }
    }
    // Catch mouse over on trough
    input.mouseOver(bar_param);

    // handle dragging the scroll area background
    let drag = input.drag({ x: this.x, y: this.y, w: this.w - bar_w, h: this.h, button: 0, min_dist: this.min_dist });
    if (drag) {
      // Drag should not steal focus
      // This also fixes an interaction with chat_ui where clicking on the chat background (which causes
      //   a flicker of a drag) would cause pointer lock to be lost
      //ui.focusSteal(this);
      if (this.drag_start === null) {
        this.drag_start = this.scroll_pos;
      }
      this.scroll_pos = this.drag_start - drag.cur_pos[1] + drag.start_pos[1];
    } else {
      this.drag_start = null;
    }
    // Also eat drag for bar area, we handle it
    input.drag({ x: this.x + this.w - bar_w, y: this.y, w: bar_w, h: this.h, button: 0 });
  }

  this.focused = !disabled && ui.focusCheck(this);
  if (this.focused && this.focusable_elem) {
    this.focusable_elem.focus();
  }

  this.last_max_value = maxvalue;
  this.clampScrollPos();

  let bg_color = this.focused || this.focusable_elem && this.focusable_elem.is_focused ?
    this.background_color_focused :
    this.background_color;
  if (bg_color) {
    ui.drawRect(this.x, this.y, this.x + this.w, this.y + this.h, this.z, bg_color);
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
};

// h is height of visible area
ScrollArea.prototype.scrollIntoFocus = function (miny, maxy, h) {
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
};

ScrollArea.prototype.scrollToEnd = function () {
  this.scroll_pos = this.last_max_value;
};

ScrollArea.prototype.resetScroll = function () {
  this.scroll_pos = 0;
  this.overscroll = 0;
};

export function scrollAreaCreate(params) {
  return new ScrollArea(params);
}
