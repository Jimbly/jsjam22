import assert from 'assert';
import { clamp, plural } from 'glov/common/util';
import { ROVec4 } from 'glov/common/vmath';
import { autoResetEachFrame } from './auto_reset';
import { clipTestRect } from './camera2d';
import { EditBox, editBoxCreate } from './edit_box';
import { getFrameTimestamp } from './engine';
import {
  ALIGN,
  Font,
  FontStyle,
} from './font';
import {
  HighScoreListEntry,
  ScoreSystem,
  scoreFormatName,
  scoreGetPlayerName,
  scoreUpdatePlayerName,
} from './score';
import {
  ScrollArea,
  scrollAreaCreate,
} from './scroll_area';
import { spriteClipPop, spriteClipPush } from './sprites';
import * as ui from './ui';
import {
  ButtonTextParam,
  uiButtonHeight,
} from './ui';

const { max, min, round } = Math;

export type ColumnDef = {
  name: string;
  width: number;
  align?: number;
  draw?: (param: DrawCellParam) => void;
};

let font: Font;

let scores_edit_box: EditBox;
let scores_scroll: ScrollArea;
function getName(a: ColumnDef): string {
  return a.name;
}

export type DrawCellParam = {
  value: unknown;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  size: number;
  column: ColumnDef;
  use_style: FontStyle;
  header: boolean;
};

export function drawCellDefault({
  value,
  x, y, z, w, h,
  size, column,
  use_style, header,
}: DrawCellParam): void {
  let { align } = column;
  if (align === undefined) {
    align = ALIGN.HVCENTERFIT;
  }

  let str = String(value);
  font.drawSizedAligned(use_style, x, y, z, size, align, w, h, str);
}

let scroll_origin = 0;
const SCROLL_PAUSE = 1500;
const SCROLL_TIME = 1000;
const SCROLL_TIME_TOTAL = SCROLL_PAUSE * 2 + SCROLL_TIME;
function drawCellScrolling({
  value,
  x, y, z, w, h,
  size, column,
  use_style, header,
}: DrawCellParam): void {
  let { align } = column;
  if (align === undefined) {
    align = ALIGN.VCENTER;
  }
  // ignore HFIT
  align &= ~ALIGN.HFIT;

  let str = String(value);

  let str_w = font.getStringWidth(use_style, size, str);
  if (str_w <= w) {
    font.drawSizedAligned(use_style, x, y, z, size, align, w, h, str);
  } else {
    let scroll_dt = getFrameTimestamp() - scroll_origin;
    let scroll_t = clamp((scroll_dt - SCROLL_PAUSE) / SCROLL_TIME, 0, 1);
    let over_width = str_w - w;
    let xoffs = scroll_t * over_width;
    let rect = { x, y, w, h };
    if (clipTestRect(rect)) {
      spriteClipPush(z, rect.x, rect.y, rect.w, rect.h);
      if (font.integral) {
        xoffs = round(xoffs);
      }
      let xx = x - xoffs;
      font.drawSizedAligned(use_style, xx, y, z, size, align, w, h, str);
      spriteClipPop();
    }
  }
}

export type ScoreToRowFunc<ScoreType> = (row: unknown[], score: ScoreType) => void;

export type ScoresDrawParam<ScoreType> = {
  score_system: ScoreSystem<ScoreType>;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  level_index: number;
  size: number;
  line_height: number;
  columns: ColumnDef[];
  scoreToRow: ScoreToRowFunc<ScoreType>;
  style_score: FontStyle;
  style_me: FontStyle;
  style_header: FontStyle;
  color_me_background: ROVec4;
  color_line: ROVec4;
  allow_rename: boolean;
};

const skipped_rank_column_def: ColumnDef = {
  name: '',
  width: 1,
  align: ALIGN.HVCENTER,
};

let last_level_idx: number = -1;
let scroll_h_last_frame = 0;
let scroll_h_this_frame = 0;
let force_show_rename = false;
export function scoresDraw<ScoreType>({
  score_system,
  x, y, z,
  width, height,
  level_index,
  size, line_height,
  columns,
  scoreToRow,
  style_score,
  style_me,
  style_header,
  color_me_background,
  color_line,
  allow_rename,
}: ScoresDrawParam<ScoreType>): number {
  assert(color_me_background[3] === 1);
  if (!font) {
    ({ font } = ui);
  }
  let now = getFrameTimestamp();
  if (last_level_idx !== level_index) {
    scroll_origin = getFrameTimestamp();
    last_level_idx = level_index;
  }
  if (now - scroll_origin > SCROLL_TIME_TOTAL) {
    scroll_origin = now;
  }

  if (autoResetEachFrame('score_ui')) {
    scroll_h_last_frame = scroll_h_this_frame;
    scroll_h_this_frame = 0;
  }

  const pad = size;
  const hpad = pad/2;
  const button_height = uiButtonHeight();
  const scroll_max_y = y + height - (button_height + pad);
  let scores = score_system.getHighScores(level_index);
  if (!scores) {
    font.drawSizedAligned(style_score, x, y, z, size, ALIGN.HVCENTERFIT, width, height,
      'Loading...');
    return y + height;
  }
  if (!scores_scroll) {
    scores_scroll = scrollAreaCreate({
      w: width,
      rate_scroll_click: line_height,
      background_color: null,
      auto_hide: true,
    });
  }
  let vis_width = width - scores_scroll.barWidth();
  let widths_total = 0;
  for (let ii = 0; ii < columns.length; ++ii) {
    widths_total += columns[ii].width;
  }
  let use_widths: number[] = [];
  for (let ii = 0; ii < columns.length; ++ii) {
    let column_width = columns[ii].width;
    use_widths[ii] = column_width * (vis_width - hpad * (columns.length - 1)) / widths_total;
  }
  function drawSet(arr: unknown[], use_style: FontStyle, header: boolean): void {
    let xx = x;
    for (let ii = 0; ii < arr.length; ++ii) {
      let column = columns[ii];
      let fn = column.draw || (ii === 1 ? drawCellScrolling : drawCellDefault);
      fn({
        value: arr[ii],
        x: xx, y, z, w: use_widths[ii], h: line_height,
        size, column,
        use_style, header,
      });
      xx += use_widths[ii] + hpad;
    }
    y += line_height;
  }
  drawSet(columns.map(getName), style_header, true);
  y += 2;
  ui.drawLine(x, y, x+width, y, z, 1, 1, color_line);
  y += 1;
  const scores_scroll_h = scroll_max_y - y;
  scores_scroll.begin({
    x, y,
    h: scores_scroll_h,
  });
  let scroll_pos = round(scores_scroll.getScrollPos());
  let scroll_y0 = scroll_pos - line_height * 2;
  let scroll_y1 = scroll_pos + scores_scroll_h + line_height;
  let scroll_min_visible_y = scroll_pos;
  let scroll_max_visible_y = scroll_pos + scores_scroll_h - line_height + 1;
  let y_save = y;
  let x_save = x;
  x = 0;
  y = 0;
  function drawScoreEntry(ii: number | null, s: HighScoreListEntry<ScoreType>, use_style: FontStyle): void {
    let row = [
      ii === null ? '--' : `#${s.rank}`,
      scoreFormatName(s),
    ];
    scoreToRow(row, s.score);
    drawSet(row, use_style, false);
  }
  // draw scores
  let my_name = scoreGetPlayerName();
  let found_me = false;
  let scores_list = scores.list;
  let next_rank = 1;
  for (let ii = 0; ii < scores_list.length; ++ii) {
    let s = scores_list[ii % scores_list.length];
    let skipped = s.rank - next_rank;
    if (skipped) {
      if (y >= scroll_y0 && y <= scroll_y1) {
        drawCellScrolling({
          value: `... ${skipped} ${plural(skipped, 'other')} ...`,
          x, y, z, w: vis_width, h: line_height,
          size, column: skipped_rank_column_def,
          use_style: style_score, header: false,
        });
      }
      y += line_height;
    }
    let use_style = style_score;
    let drawme = false;
    if (s.rank === scores.my_rank && !found_me) {
      use_style = style_me;
      found_me = true;
      drawme = true;
    }
    if (drawme) {
      let y_save2 = y;
      if (y < scroll_min_visible_y) {
        y = scroll_min_visible_y;
      } else if (y > scroll_max_visible_y) {
        y = scroll_max_visible_y;
      }
      z += 20;
      ui.drawRect(x, y, x + width + 1, y + line_height - 1, z - 1, color_me_background);
      drawScoreEntry(ii, s, use_style);
      z -= 20;
      y = y_save2 + line_height;
    } else if (y >= scroll_y0 && y <= scroll_y1) {
      drawScoreEntry(ii, s, use_style);
    } else {
      y += line_height;
    }
    next_rank = s.rank + s.count;
  }
  let extra_at_end = scores.total + 1 - next_rank;
  if (extra_at_end) {
    if (y >= scroll_y0 && y <= scroll_y1) {
      drawCellScrolling({
        value: `... ${extra_at_end} ${plural(extra_at_end, 'other')} ...`,
        x, y, z, w: vis_width, h: line_height,
        size, column: skipped_rank_column_def,
        use_style: style_score, header: false,
      });
    }
    y += line_height;
  }

  if (!found_me && score_system.getScore(level_index)) {
    let my_score = score_system.getScore(level_index)!;
    let y_save2 = y;
    if (y < scroll_min_visible_y) {
      y = scroll_min_visible_y;
    } else if (y > scroll_max_visible_y) {
      y = scroll_max_visible_y;
    }
    z += 20;
    ui.drawRect(x, y, x + width + 1, y + line_height - 1, z - 1, color_me_background);
    drawScoreEntry(null, { names_str: my_name, names: [my_name], score: my_score, rank: -1, count: 1 }, style_me);
    z -= 20;
    y = y_save2 + line_height;
  }
  let set_pad = size / 2;
  y += set_pad/2;
  scroll_h_this_frame = max(scroll_h_this_frame, y);
  scores_scroll.end(max(scroll_h_last_frame, scroll_h_this_frame));
  x = x_save;
  y = y_save + min(scores_scroll_h, y);
  y += set_pad/2;
  if (found_me && allow_rename) {
    if (!scores_edit_box) {
      scores_edit_box = editBoxCreate({
        z,
        w: width / 2,
        placeholder: 'Anonymous',
      });
      scores_edit_box.setText(my_name);
    }

    let show_rename = my_name.startsWith('Anonymous') || !my_name || force_show_rename;
    let button_param: ButtonTextParam = {
      x,
      y: y - size * 0.25,
      z,
      w: size * 10,
      h: button_height,
      text: force_show_rename && my_name === scores_edit_box.text ? 'Cancel' : my_name ? 'Update Name' : 'Set Name',
    };
    if (show_rename) {
      button_param.x += scores_edit_box.w + size;

      let submit = scores_edit_box.run({
        x,
        y,
      }) === scores_edit_box.SUBMIT;
      button_param.disabled = !scores_edit_box.text;
      if (ui.buttonText(button_param) || submit) {
        if (scores_edit_box.text) {
          assert(typeof scores_edit_box.text === 'string');
          scoreUpdatePlayerName(scores_edit_box.text);
          force_show_rename = false;
        }
      }
    } else {
      button_param.text += '...';
      if (ui.buttonText(button_param)) {
        force_show_rename = true;
      }
    }
    y += size;
  }

  y += pad;
  return y;
}
