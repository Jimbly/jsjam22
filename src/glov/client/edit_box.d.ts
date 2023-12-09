import type { FontStyle } from './font';
import type { ROVec4 } from 'glov/common/vmath';

export type EditBoxResult = null | 'submit' | 'cancel';

export interface EditBoxOptsAll {
  key: string;
  x: number;
  y: number;
  z: number;
  w: number;
  type: 'text' | 'number' | 'password' | 'email';
  font_height: number;
  text: string | number;
  placeholder: string;
  max_len: number;
  zindex: null | number;
  uppercase: boolean;
  initial_focus: boolean;
  // internal state: onetime_focus: boolean;
  focus_steal: boolean;
  auto_unfocus: boolean;
  initial_select: boolean;
  spellcheck: boolean;
  esc_clears: boolean;
  esc_unfocuses: boolean;
  multiline: number;
  enforce_multiline: boolean;
  autocomplete: boolean;
  suppress_up_down: boolean;
  // custom_nav: Partial<Record<number, null>>;
  canvas_render: null | {
    // if set, will do custom canvas rendering instead of DOM rendering
    // requires a fixed-width font and near-perfectly aligned font rendering (tweak setDOMFontPixelScale)
    char_width: number;
    char_height: number;
    color_selection: ROVec4;
    color_caret: ROVec4;
    style_text: FontStyle;
  };
}

export type EditBoxOpts = Partial<EditBoxOptsAll>;

export interface EditBox extends Readonly<EditBoxOptsAll> {
  run(params?: EditBoxOpts): EditBoxResult;
  getText(): string;
  setText(new_text: string | number): void;
  isFocused(): boolean;
  hadOverflow(): boolean;
  getSelection(): [[number, number], [number, number]]; // [column, row], [column, row]

  readonly SUBMIT: 'submit';
  readonly CANCEL: 'cancel';
}

export function editBoxCreate(params?: EditBoxOpts): EditBox;

// Pure immediate-mode API
export function editBox<T extends string|number=string|number>(params: EditBoxOpts, current: T): {
  result: EditBoxResult;
  text: T;
  edit_box: EditBox;
};
