// Portions Copyright 2023 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import {
  ROVec4,
  v4mul,
  vec4,
} from 'glov/common/vmath';
import {
  ALIGN,
  FontStyle,
  Text,
  fontStyleColored,
} from './font';
import { ScrollArea } from './scroll_area';
import {
  SPOT_DEFAULT_BUTTON,
  SpotKeyable,
  SpotRet,
  spot,
  spotKey,
} from './spot';
import {
  spriteClipPop,
  spriteClipPush,
  spriteFlippedUVsApplyHFlip,
  spriteFlippedUVsRestore,
} from './sprites';
import {
  drawHBox,
  getUIElemData,
  uiGetButtonRolloverColor,
} from './ui';
import * as ui from './ui';

const { abs, min, round } = Math;

export type CollapsagoriesStartParam = {
  x: number;
  z?: number;
  w: number;
  num_headers: number;
  view_y: number;
  view_h: number;
  header_h: number;
  parent_scroll?: ScrollArea;
} & SpotKeyable;

export type CollapsagoriesHeaderParam<T> = {
  y: number;
  draw?: (param: CollapsagoriesHeaderDrawParam<T>) => void; // Only optional if T = CollapsagoriesDrawDefaultParam
  earlydraw?: (param: CollapsagoriesHeaderDrawParam<T>) => void; // Only optional if T = CollapsagoriesDrawDefaultParam
} & T;

export type CollapsagoriesHeaderDrawParam<T> = T & {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  ret: SpotRet;
};

export type CollapsagoriesDrawDefaultParam = {
  text: Text;
  text_height: number;
  text_pad?: number;
  bar_color?: ROVec4;
  font_style?: FontStyle;
};

const collapsagories_default_header_style = fontStyleColored(null, 0x000000ff);

let temp_color_bar = vec4();
export function collapsagoriesDrawDefault(param: CollapsagoriesHeaderDrawParam<CollapsagoriesDrawDefaultParam>): void {
  const { x, y, z, w, h, text, text_height, font_style } = param;
  let { bar_color } = param;
  let { text_pad } = param;
  if (text_pad === undefined) {
    text_pad = round(text_height * 0.2);
  }
  let spr = ui.sprites.collapsagories;
  if (param.ret.focused) {
    if (ui.sprites.collapsagories_rollover) {
      spr = ui.sprites.collapsagories_rollover;
    } else {
      if (bar_color) {
        v4mul(temp_color_bar, bar_color, uiGetButtonRolloverColor());
        bar_color = temp_color_bar;
      } else {
        bar_color = uiGetButtonRolloverColor();
      }
    }
  }
  drawHBox(param, spr, bar_color);
  ui.title_font.draw({
    style: font_style || collapsagories_default_header_style,
    x: x + text_pad, y, w, h,
    z: z + 0.1,
    align: ALIGN.HFIT|ALIGN.VCENTER,
    size: text_height,
    text,
  });
}

let temp_color_fade = vec4(1,1,1,1);

export type Collapsagories = CollapsagoriesImpl;
class CollapsagoriesImpl {
  // constructor() {
  // }
  headers_done!: number;
  num_headers!: number;
  header_h!: number;
  view_y0!: number;
  view_y1!: number;
  clipper_active: boolean = false;
  key!: string;
  parent_scroll?: ScrollArea;
  did_shadow_up: boolean = false;
  need_shadow_down: number = 0;
  scroll_idx: number = -1;
  x!: number;
  z!: number;
  w!: number;
  start(param: CollapsagoriesStartParam): void {
    this.key = spotKey(param);
    this.num_headers = param.num_headers;
    this.headers_done = 0;
    this.header_h = param.header_h;
    this.view_y0 = param.view_y;
    this.view_y1 = param.view_y + param.view_h;
    this.parent_scroll = param.parent_scroll;
    this.did_shadow_up = false;
    this.need_shadow_down = 0;
    this.x = param.x;
    this.z = param.z || Z.UI;
    this.w = param.w;
  }
  private drawShadowDown(): void {
    if (this.need_shadow_down) {
      const { x, z, w, header_h } = this;
      let spr = ui.sprites.collapsagories_shadow_down;
      temp_color_fade[3] = this.need_shadow_down;
      drawHBox({
        x, y: this.view_y0, w, h: header_h, z: z - 0.1,
      }, spr, temp_color_fade);
      this.need_shadow_down = 0;
    }
  }
  header<T=CollapsagoriesDrawDefaultParam>(param: CollapsagoriesHeaderParam<T>): boolean {
    if (this.clipper_active) {
      spriteClipPop();
      this.clipper_active = false;
    }
    let { y, earlydraw } = param;
    let header_real_y = y;
    const { x, z, w, header_h, parent_scroll } = this;
    let draw: (param: CollapsagoriesHeaderDrawParam<T>) => void;
    draw = param.draw || collapsagoriesDrawDefault as unknown as typeof draw;
    let top_offs = this.view_y0 - y;
    let top_aligned = abs(top_offs) < 0.01;
    if (top_offs > 0) {
      y = this.view_y0;
      this.view_y0 += header_h;
      this.need_shadow_down = min(1, top_offs / header_h);
    } else {
      this.drawShadowDown();
    }
    let max_y = this.view_y1 - this.num_headers * header_h;
    if (y > max_y) {
      let offs = y - max_y;
      y = max_y;
      if (!this.did_shadow_up) {
        this.did_shadow_up = true;
        temp_color_fade[3] = min(1, offs / header_h);
        let spr = ui.sprites.collapsagories_shadow_up;
        if (!spr) {
          spr = ui.sprites.collapsagories_shadow_down;
          spriteFlippedUVsApplyHFlip(spr);
        }
        drawHBox({
          x, y: y - header_h, w, h: header_h, z: z - 0.1,
        }, spr, temp_color_fade);
        spriteFlippedUVsRestore(spr);
      }
    }
    --this.num_headers;

    let p2 = param as unknown as CollapsagoriesHeaderDrawParam<T>;
    p2.x = x;
    p2.y = y;
    p2.z = z;
    p2.h = header_h;
    p2.w = w;
    if (earlydraw) {
      earlydraw(p2);
    }

    let spot_param = {
      key: `${this.key}.${this.headers_done}`,
      def: SPOT_DEFAULT_BUTTON,
      x, y, w, h: header_h,
    };
    let spot_ret = spot(spot_param);
    if (this.scroll_idx === this.headers_done) {
      this.scroll_idx = -1;
      spot_ret.ret++;
    }
    if (spot_ret.ret && top_aligned) {
      if (!this.headers_done) {
        // we're aligned, and we're the first, scroll the next instead
        this.scroll_idx = this.headers_done + 1;
      } else {
        this.scroll_idx = this.headers_done - 1;
      }
      spot_ret.ret = 0;
    }
    if (spot_ret.ret && parent_scroll) {
      // scroll parent
      let desired_scroll_pos = header_real_y - this.headers_done * header_h;
      parent_scroll.scrollIntoFocus(desired_scroll_pos, desired_scroll_pos, 0);
    }
    p2.ret = spot_ret;
    draw(p2);

    let ystart = y + header_h;
    let yend = this.view_y1 - this.num_headers * header_h;
    let ret;
    if (ystart >= yend) {
      spriteClipPush(z - 1, x, ystart, w, 0);
      ret = false;
    } else {
      spriteClipPush(z - 1, x, ystart, w, yend - ystart);
      ret = true;
    }
    this.clipper_active = true;
    ++this.headers_done;
    return ret;
  }
  stop(): void {
    this.drawShadowDown();
    if (this.clipper_active) {
      spriteClipPop();
      this.clipper_active = false;
    }
  }
}

export function collapsagoriesCreate(): Collapsagories {
  return new CollapsagoriesImpl();
}

let active_elem: CollapsagoriesImpl | null = null;
export function collapsagoriesStart(param: CollapsagoriesStartParam): void {
  assert(!active_elem);
  active_elem = getUIElemData('collapsagories', param, collapsagoriesCreate);
  active_elem.start(param);
}

export function collapsagoriesHeader<T=CollapsagoriesDrawDefaultParam>(param: CollapsagoriesHeaderParam<T>): boolean {
  assert(active_elem);
  return active_elem.header(param);
}

export function collapsagoriesStop(): void {
  assert(active_elem);
  active_elem.stop();
  active_elem = null;
}
