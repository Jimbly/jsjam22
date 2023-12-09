import {
  ALIGN,
  fontStyleColored,
} from 'glov/client/font';
import * as pico8 from 'glov/client/pico8';
import {
  ScoreSystem,
  scoreAlloc,
} from 'glov/client/score';
import {
  ColumnDef,
  DrawCellParam,
  drawCellDefault,
  scoresDraw,
} from 'glov/client/score_ui';
import { Sprite } from 'glov/client/sprites';
import { drawLine, uiGetTitleFont } from 'glov/client/ui';
import * as main from './main';
import {
  MENU_BUTTON_H,
  RESOURCE_FRAMES,
  TICK_TIME,
  TILE_SIZE,
  game_height,
  game_width,
} from './main';

const { floor, max } = Math;

function pad2(v: string | number): string {
  return `0${v}`.slice(-2);
}
export function timeFormat(ticks: number): string {
  let ms = ticks * TICK_TIME;
  let s = floor(ms/1000);
  let m = floor(s/60);
  s %= 60;
  return `${m}:${pad2(s)}`;
}

type Score = {
  ticks: number;
  tech: number;
};

function encodeScore(score: Score): number {
  let ticks = max(999999 - score.ticks, 0);
  return (score.tech || 0) * 1000000 + ticks;
}

function parseScore(value: number): Score {
  let tech = floor(value / 1000000);
  value -= tech * 1000000;
  let ticks = 999999 - value;
  return {
    ticks,
    tech,
  };
}

let level_list = [{
  name: 'the',
}];

let score_system: ScoreSystem<Score>;

export function setScore(score: Score): void {
  score_system.setScore(0,
    score
  );
}

export function updateHighScores(): void {
  score_system.getHighScores(0);
}

function drawCellTech(param: DrawCellParam): void {
  let { value, x, y, z, w, h } = param;
  if (typeof value === 'number') {
    (main.sprites as Record<'tiles', Sprite>).tiles.draw({
      x: x + floor((w - TILE_SIZE)/2), y: y + floor((h - TILE_SIZE)/2), z,
      frame: (RESOURCE_FRAMES as Record<number, number>)[value],
    });
  } else {
    drawCellDefault(param);
  }
}
const SCORE_COLUMNS: ColumnDef[] = [
  // widths are just proportional, scaled relative to `width` passed in
  { name: '', width: 16, align: ALIGN.HFIT | ALIGN.HRIGHT | ALIGN.VCENTER },
  { name: 'Name', width: 60, align: ALIGN.HFIT | ALIGN.VCENTER },
  { name: 'Tech', width: 12, draw: drawCellTech },
  { name: 'Time', width: 18 },
];
const style_score = fontStyleColored(null, pico8.font_colors[1]);
const style_me = fontStyleColored(null, pico8.font_colors[8]);
const style_header = fontStyleColored(null, pico8.font_colors[5]);
function myScoreToRow(row: unknown[], score: Score): void {
  row.push(score.tech, timeFormat(score.ticks));
}

export function stateHighScoresInternal(): void {
  let width = 280;
  let x = (game_width - width) / 2;
  let y = 0;
  let z = Z.UI + 10;
  let size = 8;
  let pad = size;
  let title_font = uiGetTitleFont();

  title_font.drawSizedAligned(fontStyleColored(null, pico8.font_colors[0]),
    x, y, z, size * 2, ALIGN.HCENTERFIT, width, 0, 'HIGH SCORES');
  y += size * 2 + 2;
  drawLine(x + 130, y, x+width - 130, y, z, 1, 1, pico8.colors[5]);
  y += 4;

  const scores_list_max_y = game_height - (MENU_BUTTON_H + pad);
  const height = scores_list_max_y - y;
  y = scoresDraw<Score>({
    score_system,
    size, line_height: TILE_SIZE + 1,
    x, y, z,
    width, height,
    level_index: 0,
    columns: SCORE_COLUMNS,
    scoreToRow: myScoreToRow,
    style_score,
    style_me,
    style_header,
    color_line: pico8.colors[0],
    color_me_background: pico8.colors[1],
    allow_rename: true,
  });

}

export function main2init(): void {
  score_system = scoreAlloc<Score>({
    score_to_value: encodeScore,
    value_to_score: parseScore,
    level_defs: level_list,
    score_key: 'JS22',
    asc: false,
    rel: 20,
  });
  updateHighScores();
}
