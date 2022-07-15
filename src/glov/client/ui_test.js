// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { vec4 } = require('glov/common/vmath.js');
const { colorPicker } = require('./color_picker.js');
const engine = require('./engine.js');
const glov_font = require('./font.js');
const input = require('./input.js');
const { linkText } = require('./link.js');
const { scrollAreaCreate } = require('./scroll_area.js');
const { dropDownCreate, selectionBoxCreate } = require('./selection_box.js');
const simple_menu = require('./simple_menu.js');
const { slider } = require('./slider.js');
const ui = require('./ui.js');
const { getURLBase } = require('./urlhash.js');

const { ceil, max, random } = Math;

let demo_menu;
let demo_menu_up = false;
let demo_result;
let font_style;

let inited;
let edit_box1;
let edit_box2;
let test_select1;
let test_dropdown;
let test_dropdown_large;
let test_scroll_area;
let slider_value = 0.75;
let test_lines = 10;
let test_color = vec4(1,0,1,1);
function init(x, y, column_width) {
  edit_box1 = ui.createEditBox({
    x: x + column_width,
    y: y,
    w: column_width - 8,
  });
  edit_box2 = ui.createEditBox({
    x: x + column_width + column_width,
    y: y,
    w: column_width - 8,
  });
  demo_menu = simple_menu.create({
    items: [
      'Option 1',
      {
        name: 'Option 2',
        tag: 'opt2',
      }, {
        name: 'Option C',
        cb: () => {
          demo_result = 'Callback the third';
        },
      },
    ]
  });
  font_style = glov_font.style(null, {
    outline_width: 1.0,
    outline_color: 0x800000ff,
    glow_xoffs: 3.25,
    glow_yoffs: 3.25,
    glow_inner: -2.5,
    glow_outer: 5,
    glow_color: 0x000000ff,
  });

  test_select1 = selectionBoxCreate({
    items: ['Apples', 'Bananas', 'Chameleon'],
    z: Z.UI,
    width: column_width - 8,
  });
  test_dropdown = dropDownCreate({
    items: ['Apples', 'Bananas', 'Chameleon', { name: 'Disabled', disabled: true }],
    z: Z.UI,
    width: column_width - 8,
  });

  let large_param = {
    items: [],
    z: Z.UI,
    width: column_width - 8,
  };
  for (let ii = 0; ii < 100; ++ii) {
    large_param.items.push(`item${ii}`);
  }
  test_dropdown_large = dropDownCreate(large_param);

  test_scroll_area = scrollAreaCreate();
}

export function run(x, y, z) {
  z = z || Z.UI;
  let line_height = ui.button_height + 2;
  let column_width = ui.button_width + 8;
  if (inited !== `${x}_${y}_${column_width}`) {
    init(x, y, column_width);
    inited = `${x}_${y}_${column_width}`;
  }

  if (demo_menu_up) {
    demo_result = '';
    demo_menu.run({ x: x + ui.button_width, y: y + line_height, z: Z.MODAL });
    if (demo_menu.isSelected()) {
      if (demo_menu.isSelected('opt2')) {
        demo_result = 'Selected the second option';
      }
      if (!demo_result) {
        demo_result = `Menu selected: ${demo_menu.getSelectedItem().name}`;
      }
      demo_menu_up = false;
    }
    ui.menuUp();
    input.eatAllInput();
  }

  let pad = 4;

  if (ui.buttonText({ x, y, z, text: 'Modal Dialog', tooltip: 'Shows a modal dialog' })) {
    demo_result = '';
    ui.modalDialog({
      title: 'Modal Dialog',
      text: 'This is a modal dialog!',
      buttons: {
        'OK': function () {
          demo_result = 'OK pushed!';
        },
        'Cancel': null, // no callback
      },
    });
  }

  if (edit_box1.run() === edit_box1.SUBMIT) {
    ui.modalDialog({
      title: 'Modal Dialog',
      text: `Edit box submitted with text ${edit_box1.text}`,
      buttons: {
        'OK': null,
      },
    });
  }
  if (edit_box2.run() === edit_box2.SUBMIT) {
    edit_box2.setText('');
  }

  if (ui.buttonText({ x: edit_box2.x + edit_box2.w + pad, y, z, text: '...', w: ui.button_height })) {
    ui.modalTextEntry({
      title: 'Type something',
      edit_text: edit_box2.getText(),
      buttons: {
        ok: function (text) {
          edit_box2.setText(text);
        },
        cancel: null,
      }
    });
  }

  y += line_height;

  if (ui.buttonText({ x, y, z, text: 'Menu', tooltip: 'Shows a menu' })) {
    demo_menu_up = true;
  }

  colorPicker({
    x: x + column_width, y, z,
    color: test_color,
  });

  test_scroll_area.begin({
    x: x + column_width + 4 + line_height,
    y: y + 4,
    z,
    w: 100,
    h: ui.font_height * 8 + pad,
  });
  let internal_y = 2;
  internal_y += ui.font.drawSizedAligned(font_style, 2, internal_y, z + 1,
    ui.font_height, ui.font.ALIGN.HWRAP|ui.font.ALIGN.HFIT, 100 - test_scroll_area.barWidth() - 2, 0,
    `Edit Box Text: ${edit_box1.text}+${edit_box2.text}`) + pad;
  ui.print(font_style, 2, internal_y, z + 1, `Result: ${demo_result}`);
  internal_y += ui.font_height + pad;
  ui.print(font_style, 2, internal_y, z + 1, `Dropdown: ${test_dropdown.getSelected().name}`);
  internal_y += ui.font_height + pad;
  linkText({ x: 2, y: internal_y, text: 'Ext URL', url: 'https://github.com/jimbly/glovjs' });
  if (linkText({ x: column_width/2, y: internal_y, text: 'Int URL',
    internal: true,
    url: engine.defines.SPOT_DEBUG ? getURLBase() : `${getURLBase()}?D=SPOT_DEBUG` })
  ) {
    engine.defines.SPOT_DEBUG = !engine.defines.SPOT_DEBUG;
  }
  internal_y += ui.font_height + pad;
  internal_y += test_dropdown_large.run({ x: 2, y: internal_y, z: z + 1 }) + pad;
  if (ui.buttonText({ x: 2, y: internal_y, z, text: 'Disabled', tooltip: 'A disabled button', disabled: true })) {
    assert(false);
  }
  internal_y += ui.button_height + pad;
  for (let ii = 0; ii < test_lines; ++ii) {
    ui.print(font_style, 2, internal_y, z + 1, `Line #${ii}`);
    internal_y += ui.font_height + pad;
  }
  if (ui.buttonText({ x: 2, y: internal_y, z: z + 1, text: 'Add Line', key: 'add_line' })) {
    ++test_lines;
  }
  internal_y += ui.button_height + pad;
  if (ui.buttonText({ x: 2, y: internal_y, z: z + 1, text: 'Remove Line', key: 'remove_line' })) {
    --test_lines;
  }
  internal_y += ui.button_height + pad;
  test_scroll_area.end(internal_y);
  ui.panel({ x: test_scroll_area.x - pad, y: test_scroll_area.y - pad, z: z - 1,
    w: test_scroll_area.w + pad * 2, h: test_scroll_area.h + pad * 2 });

  y += line_height;

  y += test_select1.run({ x, y, z });
  y += test_dropdown.run({ x, y, z });

  y = max(y, test_scroll_area.y + test_scroll_area.h + pad);
  slider_value = slider(slider_value, {
    x, y, z,
    min: 0,
    max: 2,
  });
  ui.print(null, x + ui.button_width + pad, y, z, `${slider_value.toFixed(2)}`);
  ui.progressBar({
    x: x + ui.button_width + pad * 2 + ui.font_height * 2,
    y, z,
    w: 60, h: ui.button_height,
    progress: slider_value,
  });
  y += ui.button_height;
}

export function runFontTest(x, y) {
  const COLOR_RED = 0xFF0000ff;
  const COLOR_GREEN = 0x00FF00ff;
  const COLOR_WHITE = 0xFFFFFFff;
  const COLOR_INVISIBLE = 0x00000000;
  let z = Z.UI;
  let font = engine.font;

  let font_size = ui.font_height * 2;
  font.drawSized(null, x, y, z, font_size, `Default ${font_size} ${random().toFixed(7)}`);
  y += font_size;
  font.drawSized(null, x, y, z, font_size / 2, `Default ${font_size / 2} Lorem ipsum dolor sit amet <[A|B]>`);
  y += ceil(font_size / 2);
  font.drawSized(null, x, y, z, font_size / 4,
    `Default ${font_size / 4} The quick brown fox jumped over the lazy dog rutabaga Alfalfa`);
  y += ceil(font_size / 4);

  const font_style_outline = glov_font.style(null, {
    outline_width: 1, outline_color: COLOR_RED,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: COLOR_INVISIBLE,
    color: COLOR_WHITE
  });
  const font_style_outline_dim = glov_font.style(null, {
    outline_width: 1, outline_color: 0x0000007f,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: COLOR_INVISIBLE,
    color: COLOR_WHITE
  });
  const font_style_outline_dim2 = glov_font.style(null, {
    outline_width: 1, outline_color: 0xFF00007f,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: COLOR_INVISIBLE,
    color: COLOR_WHITE
  });
  let xx = x;
  xx += font.drawSized(font_style_outline, xx, y, z, font_size, 'Outline ');
  xx += font.drawSized(font_style_outline_dim, xx, y, z, font_size, 'Dim ');
  xx += font.drawSized(font_style_outline_dim2, xx, y, z, font_size, 'Out');
  xx += font.drawSized(font.styleAlpha(font_style_outline_dim2, 0.5), xx, y, z, font_size, 'line');
  y += font_size;

  const font_style_glow = glov_font.style(null, {
    outline_width: 0, outline_color: COLOR_INVISIBLE,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: -1, glow_outer: 4, glow_color: COLOR_GREEN,
    color: COLOR_WHITE
  });
  const font_style_glow_dim = glov_font.style(null, {
    outline_width: 0, outline_color: COLOR_INVISIBLE,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: -1, glow_outer: 4, glow_color: 0x00FF0020,
    color: COLOR_WHITE
  });
  const font_style_glow_dim_on_dim = glov_font.style(null, {
    outline_width: 0, outline_color: COLOR_INVISIBLE,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: -1, glow_outer: 4, glow_color: 0x00FF0020,
    color: 0xFFFFFF80,
  });
  xx = x;
  xx += font.drawSized(font_style_glow, xx, y, z, font_size, 'Glow ');
  xx += font.drawSized(font_style_glow_dim, xx, y, z, font_size, 'Dim ');
  font.drawSized(font_style_glow_dim_on_dim, xx, y, z, font_size, 'Glow ');
  y += font_size;

  const font_style_shadow = glov_font.style(null, {
    outline_width: 0, outline_color: COLOR_INVISIBLE,
    glow_xoffs: 4, glow_yoffs: 4, glow_inner: -2.5, glow_outer: 5, glow_color: COLOR_GREEN,
    color: COLOR_WHITE
  });
  font.drawSized(font_style_shadow, x, y, z, font_size, 'Glow (Shadow) O0O1Il');
  y += font_size;

  const font_style_both = glov_font.style(null, {
    outline_width: 1, outline_color: COLOR_RED,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 6, glow_color: COLOR_GREEN,
    color: COLOR_WHITE
  });
  const font_style_both_soft_on_hard = glov_font.style(null, {
    outline_width: 1, outline_color: 0xFF00007f,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 6, glow_color: COLOR_GREEN,
    color: COLOR_WHITE
  });
  const font_style_both_hard_on_soft = glov_font.style(null, {
    outline_width: 1, outline_color: COLOR_RED,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 6, glow_color: 0x00FF0040,
    color: COLOR_WHITE
  });
  const font_style_both_soft_on_soft = glov_font.style(null, {
    outline_width: 1, outline_color: 0xFF00007f,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 6, glow_color: 0x00FF0040,
    color: COLOR_WHITE
  });
  xx = x;
  xx += font.drawSized(font_style_both, xx, y, z, font_size, 'B');
  xx += font.drawSized(font.styleAlpha(font_style_both, 0.75), xx, y, z, font_size, 'o');
  xx += font.drawSized(font.styleAlpha(font_style_both, 0.5), xx, y, z, font_size, 't');
  xx += font.drawSized(font.styleAlpha(font_style_both, 0.25), xx, y, z, font_size, 'h ');
  xx += font.drawSized(font_style_both_soft_on_hard, xx, y, z, font_size, 'SoH ');
  xx += font.drawSized(font_style_both_hard_on_soft, xx, y, z, font_size, 'HoH ');
  font.drawSized(font_style_both_soft_on_soft, xx, y, z, font_size, 'SoS 0O0');
  y += font_size;

  let font_size2 = 32;
  const font_style_both2 = glov_font.style(null, {
    outline_width: 1.75,outline_color: COLOR_RED,
    glow_xoffs: 0.25, glow_yoffs: 0.25, glow_inner: 0, glow_outer: 5, glow_color: 0x7F7F7Fff,
    color: COLOR_WHITE
  });
  font.drawSizedAligned(font_style_both2, x, y, z, font_size2, glov_font.ALIGN.HFIT, ui.button_width * 2, 0,
    'ALIGN.HFIT The quick brown fox jumps over the lazy dog');
  y += font_size2;

  let test = 'glow';

  if (test === 'outline') {
    const font_style_outline2 = glov_font.style(null, {
      outline_width: 1, outline_color: COLOR_RED,
      glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: COLOR_INVISIBLE,
      color: COLOR_WHITE
    });
    for (let ii = 1; ii <= 4; ii++) {
      font_style_outline2.outline_width = ii * 2;
      font.drawSizedAligned(font_style_outline2, x, y, z, font_size2, glov_font.ALIGN.HLEFT, 400, 0,
        `Outline thickness ${ii * 2}`);
      y += font_size2;
    }

    // Not allowing non-uniform scaling here, simulate with camera?
    // font.drawSizedAligned(font_style_outline2, x, y, z, font_size2 * 2, font_size2, glov_font.ALIGN.HLEFT, 400, 0,
    //   'Wide thick outline');
    // y += font_size2;
    // font.drawSizedAligned(font_style_outline2, x, y, z, font_size2, font_size2 * 2, glov_font.ALIGN.HLEFT, 400, 0,
    //   'Tall thick outline');
    // y += font_size2 * 2;
  } else if (test === 'glow') {
    const font_style_glow2 = glov_font.style(null, {
      outline_width: 0, outline_color: COLOR_INVISIBLE,
      glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 8, glow_color: COLOR_RED,
      color: COLOR_WHITE
    });
    for (let ii = 1; ii <= 4; ii++) {
      //font_style_glow2.glow_inner = ii * 2 - 1;
      font_style_glow2.glow_outer = ii * 2;
      font.drawSizedAligned(font_style_glow2, x, y, z, font_size2, glov_font.ALIGN.HLEFT, 400, 0,
        `Glow outer ${ii * 2}`);
      y += font_size2;
    }

    // Not allowing non-uniform scaling here, simulate with camera?
    // font.drawSizedAligned(font_style_glow2, x, y, z, font_size2 * 2, font_size2, glov_font.ALIGN.HLEFT, 400, 0,
    //   'Wide thick glow \x01\x02\xe5\xae\xb4\xe8\xaf\xb7');
    // y += font_size2;
    // font.drawSizedAligned(font_style_glow2, x, y, z, font_size2, font_size2 * 2, glov_font.ALIGN.HLEFT, 400, 0,
    //   'Tall thick glow');
    // y += font_size2 * 2;
  } else if (test === 'wrap') {
    y += font.drawSizedWrapped(null, x, y, z, 400, 24, font_size2, 0xFFFFFFff,
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor' +
      ' incididunt utlaboreetdoloremagnaaliqua.');
  }


  // Gradient not supported
  // y = y0;
  // x += font_size * 8;
  // const font_style_gradient = glov_font.style(null, {
  //   outline_width: 1, outline_color: 0x777777ff,
  //   glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: COLOR_BLUE,
  //   gradient: [COLOR_WHITE, COLOR_WHITE, COLOR_BLACK, COLOR_BLACK],
  // });
  // font.drawSized(font_style_gradient, x, y + Math.sin(engine.getFrameTimestamp() * 0.005) * 20, z,
  //   font_size*2, 'Gradient');
  // y += font_size*2;
}
