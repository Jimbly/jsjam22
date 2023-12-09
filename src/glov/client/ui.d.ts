// eslint-disable-next-line @typescript-eslint/no-redeclare
/* globals HTMLElement, Event */

import { ROVec4 } from 'glov/common/vmath';
import { EditBoxOptsAll } from './edit_box';
import { ALIGN, Font, FontStyle, Text } from './font';
import { Box } from './geom_types';
import { SoundID } from './sound';
import { SpotKeyable, SpotParam, SpotRet, SpotStateEnum } from './spot';
import { Sprite, UISprite } from './sprites';
import { UIStyle } from './uistyle';

export type ColorSet = { _opaque: 'ColorSet' };
export const Z: Partial<Record<string, number>>;
export const Z_MIN_INC: number;
export const LINE_ALIGN: number;
export const LINE_CAP_SQUARE: number;
export const LINE_CAP_ROUND: number;
export function makeColorSet(color: ROVec4): ColorSet;
export function colorSetMakeCustom(regular: ROVec4, rollover: ROVec4, down: ROVec4, disabled: ROVec4): ColorSet;
export interface UIBox extends Box {
  z?: number;
}
export interface UIBoxColored extends UIBox {
  color?: ROVec4;
}
export type UIHookFn = (param: UIBox & { hook: HookList }) => void;
export function addHook(draw: UIHookFn, click: UIHookFn): void;
export function getUIElemData<T, P extends SpotKeyable>(type: string, param: P, allocator: (param: P)=>T) : T;
export const font: Font;
export const title_font: Font;
export function uiGetFont(): Font;
export function uiGetTitleFont(): Font;
export function uiFontStyleNormal(): FontStyle;
export function uiFontStyleFocused(): FontStyle;
export function uiFontStyleDisabled(): FontStyle;
export function uiFontStyleModal(): FontStyle;
export interface UISprites {
  button: UISprite;
  button_rollover: null | UISprite;
  button_down: UISprite;
  button_disabled: UISprite;
  panel: UISprite;
  menu_entry: UISprite;
  menu_selected: UISprite;
  menu_down: UISprite;
  menu_header: UISprite;
  slider: UISprite;
  slider_handle: UISprite;

  collapsagories: UISprite;
  collapsagories_rollover: null | UISprite;
  collapsagories_shadow_down: UISprite;
  collapsagories_shadow_up: null | UISprite;

  scrollbar_bottom: UISprite;
  scrollbar_trough: UISprite;
  scrollbar_top: UISprite;
  scrollbar_handle_grabber: UISprite;
  scrollbar_handle: UISprite;
  progress_bar: UISprite;
  progress_bar_trough: UISprite;
  white: UISprite;
}
export const sprites: UISprites;
// DEPRECATED: export const font_height: number; // use uiStyleCurrent().text_height or uiTextHeight()
// DEPRECATED: export const button_width: number;
// DEPRECATED: export const button_height: number;
export function uiTextHeight(): number;
export function uiButtonHeight(): number;
export function uiButtonWidth(): number;
export const panel_pixel_scale: number;
export function buttonWasFocused(): boolean;
export function colorSetSetShades(rollover: number, down: number, disabled: number): void;
export function loadUISprite(name: string, ws: number[], hs: number[]): void;
type UISpriteDef = {
  name?: string;
  url?: string;
  ws?: number[];
  hs?: number[];
  wrap_t?: number; // gl.REPEAT | gl.CLAMP_TO_EDGE
  layers?: number;
};
export function loadUISprite2(name: string, param: UISpriteDef): void;
type BaseButtonLabels = Record<'ok' | 'cancel' | 'yes' | 'no', Text>;
type ExtraButtonLabels = Partial<Record<string, Text>>;
type ButtonLabels = BaseButtonLabels & ExtraButtonLabels;
export function setButtonsDefaultLabels(buttons_labels: ButtonLabels): void;
export function setProvideUserStringDefaultMessages(success_msg: Text, failure_msg: Text): void;
export function suppressNewDOMElemWarnings(): void;
export function uiGetDOMElem(last_elem: HTMLElement, allow_modal: boolean): null | HTMLElement;
export function uiGetDOMTabIndex(): number;
export type BaseSoundKey = 'button_click' | 'rollover';
export function uiBindSounds(sounds?: Partial<Record<string, SoundID | SoundID[] | null>>): void;
export interface DrawHBoxParam extends UIBox {
  no_min_width?: boolean;
}
export function drawHBox(coords: DrawHBoxParam, s: Sprite, color?: ROVec4): void;
export function drawVBox(coords: UIBox, s: Sprite, color?: ROVec4): void;
export function drawBox(coords: UIBox, s: Sprite, pixel_scale: number, color?: ROVec4, color1?: ROVec4): void;
export function drawMultiPartBox(
  coords: UIBox,
  scaleable_data: {
    widths: number[];
    heights: number[];
  }, sprite: Sprite,
  pixel_scale: number,
  color?: ROVec4,
): void;
export function playUISound(name: string, volume?: number): void;
export function focusCanvas(): void;
export function uiHandlingNav(): boolean;

export interface PanelParam extends UIBoxColored {
  eat_clicks?: boolean;
  pixel_scale?: number;
  sprite?: Sprite;
}
export function panel(param: PanelParam): void;

export type TooltipValue = Text | ((param:unknown) => (Text | null));
export interface TooltipParam {
  x: number;
  y: number;
  z?: number;
  tooltip_width?: number;
  tooltip_pad?: number;
  tooltip_above?: boolean;
  tooltip_auto_above_offset?: number;
  tooltip_right?: boolean;
  tooltip_auto_right_offset?: number;
  pixel_scale?: number;
  tooltip: TooltipValue | null;
}
export function drawTooltip(param: TooltipParam): void;
export interface TooltipBoxParam {
  x: number;
  y: number;
  h: number;
  w?: number;
  tooltip_width?: number;
  tooltip_above?: boolean;
  tooltip_right?: boolean;
  tooltip: Text | ((param:unknown) => (Text | null));
}
export function drawTooltipBox(param: TooltipBoxParam): void;

export interface ProgressBarParam extends UIBoxColored {
  progress: number; // 0..1
  color_trough?: ROVec4;
  centered?: boolean;
  tooltip?: Text;
}
export function progressBar(param: ProgressBarParam): void;

export type EventCallback = (event: Event) => void;
export type HookList = string | string[];
export type ButtonStateString = 'regular' | 'down' | 'rollover' | 'disabled';
export type ButtonRet = SpotRet & {
  // ui.button-specific
  state: ButtonStateString;
};
export interface ButtonParam extends Partial<TooltipParam>, Partial<SpotParam> {
  // importantly: everything in SpotParam
  x: number;
  y: number;
  z?: number;
  draw_only?: boolean;
  draw_only_mouseover?: boolean;
  color?: ROVec4;
  rollover_quiet?: boolean;
  colors?: ColorSet;
  sound?: string;
  z_bias?: Partial<Record<ButtonStateString, number>>;
  base_name?: string;
  no_bg?: boolean;
  style?: UIStyle;
}
export interface ButtonTextParam extends ButtonParam {
  text: Text;
  font?: Font;
  font_height?: number;
  font_style_normal?: FontStyle;
  font_style_focused?: FontStyle;
  font_style_disabled?: FontStyle;
  align?: ALIGN;
}
export interface ButtonImageParamBase extends ButtonParam {
  shrink?: number;
  frame?: number;
  img_rect?: ROVec4;
  left_align?: boolean;
  img_color?: ROVec4;
  z_inc?: number;
  color1?: ROVec4;
  rotation?: number;
  flip?: boolean;
}
export interface ButtonImageParam1 extends ButtonImageParamBase {
  imgs: Sprite[];
}
export interface ButtonImageParam2 extends ButtonImageParamBase {
  img: Sprite;
}
export type ButtonImageParam = ButtonImageParam1 | ButtonImageParam2;
export function buttonShared(param: ButtonParam): ButtonRet;
export function buttonBackgroundDraw(param: ButtonParam, state: ButtonStateString): void;
export function buttonSpotBackgroundDraw(param: ButtonParam, spot_state: SpotStateEnum): void;
export function buttonTextDraw(param: ButtonTextParam, state: ButtonStateString, focused: boolean): void;
export function buttonText(param: ButtonTextParam): ButtonRet | null;
export function buttonImage(param: ButtonImageParam): ButtonRet | null;
export function button(param: ButtonTextParam | ButtonImageParam): ButtonRet | null;

export function print(font_style: FontStyle | null, x: number, y: number, z: number, text: Text): number;

export type LabelParam = Partial<TooltipBoxParam> & {
  x: number;
  y: number;
  z?: number;
  w?: number;
  h?: number;
  font_style?: FontStyle;
  font_style_focused?: FontStyle;
  font?: Font;
  size?: number;
  align?: ALIGN;
  text?: Text;
  tooltip?: TooltipValue;
  style?: UIStyle;
};
export function label(param: LabelParam): number;

export function modalDialogClear(): void;

export interface ModalDialogButtonEx<CB> {
  cb?: CB | null;
  in_event_cb?: EventCallback | null;
  label?: Text;
}
export type ModalDialogButton<CB> = null | CB | ModalDialogButtonEx<CB> | Partial<ButtonTextParam | ButtonImageParam>;
export type ModalDialogTickCallbackParams = {
  readonly x0: number;
  readonly x: number;
  readonly y0: number;
  y: number;
  readonly modal_width: number;
  readonly avail_width: number;
  readonly font_height: number;
  readonly fullscreen_mode: boolean;
};
export type ModalDialogTickCallback = (param: ModalDialogTickCallbackParams) => string | void;
export interface ModalDialogParamBase<CB> {
  title?: Text;
  text?: Text;
  font_height?: number;
  click_anywhere?: boolean;
  width?: number;
  button_width?: number;
  y0?: number;
  tick?: ModalDialogTickCallback;
  buttons?: Partial<Record<string, ModalDialogButton<CB>>>;
  no_fullscreen_zoom?: boolean;
  style?: UIStyle;
}

export type ModalDialogParam = ModalDialogParamBase<() => void>;
export function modalDialog(param: ModalDialogParam): void;

export interface ModalTextEntryParam extends ModalDialogParamBase<(text: string) => void> {
  edit_text?: EditBoxOptsAll['text'];
  max_len?: number;
}
export function modalTextEntry(param: ModalTextEntryParam): void;

export function isMenuUp(): boolean;

export interface MenuFadeParams {
  blur?: [number, number];
  saturation?: [number, number];
  brightness?: [number, number];
  fallback_darken?: ROVec4;
  z?: number;
}
export function menuUp(param?: MenuFadeParams): void;
export function copyTextToClipboard(text: string): boolean;
export function provideUserString(title: Text, str: string): void;
export function drawRect(x0: number, y0: number, x1: number, y1: number, z?: number, color?: ROVec4): void;
export function drawRect2(param: UIBoxColored): void;
export function drawRect4Color(
  x0: number, y0: number,
  x1: number, y1: number,
  z: number,
  color_ul: ROVec4,
  color_ur: ROVec4,
  color_ll: ROVec4,
  color_lr: ROVec4,
): void;
// TODO: import from sprites.js's types after conversion
type BlendMode = 0 | 1 | 2; // BlendMode
export function drawElipse(
  x0: number, y0: number,
  x1: number, y1: number,
  z: number,
  spread: number,
  color?: ROVec4,
  blend?: BlendMode,
): void;
export function drawCircle(
  x: number, y: number, z: number,
  r: number,
  spread: number,
  color?: ROVec4,
  blend?: BlendMode,
): void;
export function drawHollowCircle(
  x: number, y: number, z: number,
  r: number,
  spread: number,
  color?: ROVec4,
  blend?: BlendMode,
): void;
export type LineMode = number; // TODO: convert to enum type?
export function drawLine(
  x0: number, y0: number,
  x1: number, y1: number,
  z: number,
  w: number,
  precise: number,
  color?: ROVec4,
  mode?: LineMode,
): void;
export function drawHollowRect(
  x0: number, y0: number,
  x1: number, y1: number,
  z: number,
  w: number,
  precise: number,
  color?: ROVec4,
  mode?: LineMode,
): void;
export interface DrawHollowRectParam extends UIBoxColored {
  line_width?: number;
  precise?: number;
  mode?: LineMode;
}
export function drawHollowRect2(param: DrawHollowRectParam): void;
export function drawCone(
  x0: number, y0: number,
  x1: number, y1: number,
  z: number,
  w0: number, w1: number,
  spread: number,
  color?: ROVec4,
): void;
export function setFontHeight(new_font_height: number): void;
export function scaleSizes(scale: number): void;
export function setPanelPixelScale(scale: number): void;
export function setModalSizes(
  modal_button_width: number,
  width: number,
  y0: number,
  title_scale: number,
  pad: number,
): void;
export function setTooltipWidth(tooltip_width: number, tooltip_panel_pixel_scale: number): void;
export function setFontStyles(
  normal?: FontStyle | null,
  focused?: FontStyle | null,
  modal?: FontStyle | null,
  disabled?: FontStyle | null
): void;
export function uiGetFontStyleFocused(): FontStyle;
export function uiSetFontStyleFocused(new_style: FontStyle): void;
export function uiSetPanelColor(color: ROVec4): void;
export function uiSetButtonColorSet(color_set: ColorSet): void;
export function uiGetButtonRolloverColor(): ROVec4;

type UISpriteSet = {
  color_set_shades?: [number, number, number];
  slider_params?: [number, number, number];

  button?: UISpriteDef;
  button_rollover?: UISpriteDef;
  button_down?: UISpriteDef;
  button_disabled?: UISpriteDef;
  panel?: UISpriteDef;
  menu_entry?: UISpriteDef;
  menu_selected?: UISpriteDef;
  menu_down?: UISpriteDef;
  menu_header?: UISpriteDef;
  slider?: UISpriteDef;
  slider_notch?: UISpriteDef;
  slider_handle?: UISpriteDef;

  scrollbar_bottom?: UISpriteDef;
  scrollbar_trough?: UISpriteDef;
  scrollbar_top?: UISpriteDef;
  scrollbar_handle_grabber?: UISpriteDef;
  scrollbar_handle?: UISpriteDef;
  progress_bar?: UISpriteDef;
  progress_bar_trough?: UISpriteDef;
};
export const internal : {
  checkHooks(param: { hook?: HookList }, click: boolean): void;
  cleanupDOMElems(): void;
  uiEndFrame(): void;
  uiSetFonts(new_font: Font, new_title_font?: Font): void;
  uiStartup(param: {
    font: Font;
    title_font?: Font;
    ui_sprites: UISpriteSet;
    line_mode?: LineMode;
  }): void;
  uiTick(dt: number): void;
  uiApplyStyle(style: UIStyle): void;
};
