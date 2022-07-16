const { min, round } = Math;
const score_system = require('./score.js');
const { scrollAreaCreate } = require('./scroll_area.js');
const ui = require('./ui.js');

let font;

let scores_edit_box;
let scores_scroll;
function getName(a) {
  return a.name;
}
export function drawCellDefault({
  value,
  x, y, z, w, h,
  size, column,
  use_style, header,
}) {
  let { align } = column;
  if (align === undefined) {
    align = font.ALIGN.HVCENTERFIT;
  }

  let str = String(value);
  font.drawSizedAligned(use_style, x, y, z, size, align, w, h, str);
}
export function scoresDraw({
  x, y, z,
  width, height,
  level_id,
  size, line_height,
  columns,
  scoreToRow,
  style_score,
  style_me,
  style_header,
  color_me_background,
  color_line,
}) {
  if (!font) {
    ({ font } = ui);
  }
  const pad = size;
  const hpad = pad/2;
  const scroll_max_y = y + height - (ui.button_height + pad);
  let scores = score_system.high_scores[level_id];
  if (!scores) {
    font.drawSizedAligned(style_score, x, y, z, size, font.ALIGN.HVCENTERFIT, width, height,
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
  let use_widths = [];
  for (let ii = 0; ii < columns.length; ++ii) {
    let column_width = columns[ii].width;
    use_widths[ii] = column_width * (vis_width - hpad * (columns.length - 1)) / widths_total;
  }
  function drawSet(arr, use_style, header) {
    let xx = x;
    for (let ii = 0; ii < arr.length; ++ii) {
      let column = columns[ii];
      let fn = column.draw || drawCellDefault;
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
  let found_me = false;
  function drawScoreEntry(ii, s, use_style) {
    let row = [
      `#${ii+1}`,
      score_system.formatName(s),
    ];
    scoreToRow(row, s.score);
    drawSet(row, use_style);
  }
  for (let ii = 0; ii < scores.length; ++ii) {
    let s = scores[ii % scores.length];
    let use_style = style_score;
    let drawme = false;
    if (s.name === score_system.player_name && !found_me) {
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
  }
  let set_pad = size / 2;
  y += set_pad/2;
  scores_scroll.end(y);
  x = x_save;
  y = y_save + min(scores_scroll_h, y);
  y += set_pad/2;
  if (found_me && score_system.player_name.indexOf('Anonymous') === 0) {
    if (!scores_edit_box) {
      scores_edit_box = ui.createEditBox({
        z,
        w: width / 2,
      });
      scores_edit_box.setText(score_system.player_name);
    }

    if (scores_edit_box.run({
      x,
      y,
    }) === scores_edit_box.SUBMIT || ui.buttonText({
      x: x + scores_edit_box.w + size,
      y: y - size * 0.25,
      z,
      w: size * 13,
      h: ui.button_height,
      text: 'Update Player Name'
    })) {
      if (scores_edit_box.text) {
        score_system.updatePlayerName(scores_edit_box.text);
      }
    }
    y += size;
  }

  y += pad;
  return y;
}
