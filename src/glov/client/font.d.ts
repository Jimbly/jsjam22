import { Vec4 } from 'glov/common/vmath';
import { LocalizableString } from './localization';

type RGBA = number; // In the 0xRRGGBBAA format

export interface FontStyleParam {
  color?: RGBA;
  outline_width?: number;
  outline_color?: RGBA;
  // Glow: can be used for a dropshadow as well
  //   inner can be negative to have the glow be less opaque (can also just change the alpha of the glow color)
  //   a glow would be e.g. (0, 0, -1, 5)
  //   a dropshadow would be e.g. (3.25, 3.25, -2.5, 5)
  glow_xoffs?: number;
  glow_yoffs?: number;
  glow_inner?: number;
  glow_outer?: number;
  glow_color?: RGBA;
}

export type FontStyle = { _opaque: 'FontStyle' };

export function fontStyle(base: FontStyle | null, param: FontStyleParam): FontStyle;
export function fontStyleAlpha(base: FontStyle | null, alpha: number): FontStyle;
export function fontStyleColored(base: FontStyle | null, color: RGBA): FontStyle;

export enum ALIGN {
  HLEFT,
  HCENTER,
  HRIGHT,

  VTOP,
  VCENTER,
  VBOTTOM,

  HFIT,
  HWRAP,

  // Convenience combinations of the above:
  HCENTERFIT,
  HRIGHTFIT,
  HVCENTER,
  HVCENTERFIT,
}

export function fontSetDefaultSize(h: number): void;
export function intColorFromVec4Color(v: Vec4): RGBA;
export function vec4ColorFromIntColor(v: Vec4, c: RGBA): Vec4;

interface FontDrawOpts {
  style?: FontStyle;
  color?: RGBA;
  alpha?: number;
  x: number; y: number; z?: number;
  size?: number;
  w?: number; h?: number;
  align?: ALIGN;
  indent?: number;
  text: string | LocalizableString;
}

type FontLineWrapCallback = (x0: number, linenum: number, line: string, x1: number) => void;
type Text = string | LocalizableString;

export interface Font {
  // General draw functions return width
  // Pass null for style to use default style
  // If the function takes a color, this overrides the color on the style
  drawSized(
    style: FontStyle | null,
    x: number, y: number, z: number,
    size: number,
    text: Text
  ): number;
  drawSizedColor(
    style: FontStyle | null,
    x: number, y: number, z: number,
    size: number,
    color: RGBA,
    text: Text
  ): number;
  drawSizedAligned(
    style: FontStyle | null,
    x: number, y: number, z: number,
    size: number,
    align: ALIGN, w: number, h: number,
    text: Text
  ): number;
  drawSizedAlignedWrapped(
    style: FontStyle | null,
    x: number, y: number, z: number,
    indent: number, size: number,
    align: ALIGN, w: number, h: number,
    text: Text
  ): number;
  // Wrapped raw functions return height
  drawSizedColorWrapped(
    style: FontStyle | null,
    x: number, y: number, z: number,
    w: number, indent: number,
    size: number,
    color: RGBA,
    text: Text
  ): number;
  drawSizedWrapped(
    style: FontStyle | null,
    x: number, y: number, z: number,
    w: number, indent: number,
    size: number,
    text: Text
  ): number;

  // Generic draw: if (align & HWRAP), returns height, otherwise returns width
  draw(param: FontDrawOpts): number;

  // Returns number of lines
  wrapLines(
    style: FontStyle | null,
    w: number, indent: number, size: number,
    text: Text, align: ALIGN,
    line_cb: FontLineWrapCallback
  ): number;
  numLines(style: FontStyle | null, w: number, indent: number, size: number, text: Text): number;
  dims(style: FontStyle | null, w: number, indent: number, size: number, text: Text): {
    w: number; h: number; numlines: number;
  };

  getCharacterWidth(style: FontStyle | null, x_size: number, c: number): number;

  getStringWidth(style: FontStyle | null, x_size: number, text: Text): number;

  readonly integral: boolean;

  // Constants and utility functions are replicated on all font instances as well:
  readonly ALIGN: typeof ALIGN;
  style(base: FontStyle | null, param: FontStyleParam): FontStyle;
  styleAlpha(base: FontStyle | null, alpha: number): FontStyle;
  styleColored(base: FontStyle | null, color: RGBA): FontStyle;
}

export function fontCreate(font_info: unknown, texture_name: string): Font;

// Legacy interfaces
export function style(base: FontStyle | null, param: FontStyleParam): FontStyle;
export function styleAlpha(base: FontStyle | null, alpha: number): FontStyle;
export function styleColored(base: FontStyle | null, color: RGBA): FontStyle;
