/* eslint-disable import/order */
const camera2d = require('./camera2d.js');
const { cmd_parse } = require('./cmds.js');
const engine = require('./engine.js');
const { fetch } = require('./fetch.js');
const glov_font = require('./font.js');
const input = require('glov/client/input.js');
const { min } = Math;
const { scrollAreaCreate } = require('./scroll_area.js');
const { shadersGetDebug } = require('./shaders.js');
const settings = require('./settings.js');
const ui = require('./ui.js');
const { uiTextHeight } = require('./ui.js');
const { errorString } = require('glov/common/util.js');
const { vec4 } = require('glov/common/vmath.js');

Z.SHADER_DEBUG = Z.SHADER_DEBUG || 900;

const SHADER_STATS_SERVER = 'http://localhost:3000/api/shaderstats';

let shader_stats_cache = {};
function getShaderStats(text, stage, peek) {
  if (shader_stats_cache[text]) {
    return shader_stats_cache[text].data;
  }
  if (peek) {
    return null;
  }
  let cache = shader_stats_cache[text] = {
    data: null,
  };
  fetch({
    url: `${SHADER_STATS_SERVER}?stage=${stage}&text=${encodeURIComponent(text)}`,
    response_type: 'json',
  }, (err, obj) => {
    if (err) {
      cache.data = { err: `Fetch error: ${errorString(err)}` };
    } else {
      cache.data = obj;
    }
  });
  return cache.data;
}

const PAD = 4;
const style_title = glov_font.styleColored(null, 0x8090FFff);
const style = glov_font.styleColored(null, 0x222222ff);
const style_error = glov_font.styleColored(null, 0xDD2222ff);
const color_line = vec4(0.4,0.4,0.4,1);
const color_panel = vec4(1,1,1,1);
const color_invalid = vec4(0.8,0,0,1);
const color_selected = vec4(0.4, 0.6, 1, 1);
let scroll_area;
let scroll_area_source;
let selected_shader;
function shaderDebugUITick() {
  const PANEL_PAD = ui.tooltip_pad;
  let x0 = camera2d.x0() + PANEL_PAD;
  const y0 = camera2d.y0() + PANEL_PAD;
  let z = Z.SHADER_DEBUG;
  const { font, title_font } = ui;
  const font_height = uiTextHeight();
  let w = font_height * 20;
  let x = x0;
  let y = y0;

  let shaders = shadersGetDebug();

  title_font.drawSizedAligned(style_title, x, y, z, font_height, font.ALIGN.HCENTERFIT, w, 0,
    `Shaders (${shaders.length})`);

  if (!scroll_area) {
    scroll_area = scrollAreaCreate({
      z,
      background_color: null,
      auto_hide: true,
    });
    scroll_area_source = scrollAreaCreate({
      z,
      background_color: null,
      auto_hide: true,
    });
  }
  let sub_w = w - PAD - scroll_area.barWidth();
  let score_w = sub_w * 0.3;
  let subscore_w = score_w/2;
  let button_w = sub_w - score_w - PAD;

  font.draw({
    x: x + button_w + PAD, y: y + font_height * 0.5, z,
    w: subscore_w - 1,
    color: 0x404040ff,
    size: font_height * 0.5,
    text: 'Ops',
    align: font.ALIGN.HCENTERFIT,
  });
  font.draw({
    x: x + button_w + PAD + subscore_w + 1, y: y + font_height * 0.5, z,
    w: subscore_w - 1,
    color: 0x404040ff,
    size: font_height * 0.5,
    text: 'Bytes',
    align: font.ALIGN.HCENTERFIT,
  });

  y += font_height + 1;
  ui.drawLine(x0 + w * 0.3, y, x0 + w * 0.7, y, z, 0.5, true, color_line);
  y += PAD;

  const max_h = camera2d.y1() - PAD - y;
  let scroll_y_start = y;
  scroll_area.begin({
    x, y, w, h: max_h,
  });
  x = 0;
  y = 0;
  z = Z.UI;


  for (let ii = 0; ii < shaders.length; ++ii) {
    let shader = shaders[ii];
    let filename = shader.filename.replace('shaders/', '');
    if (shader.defines_arr.length) {
      filename += `(${shader.defines_arr.join(',')})`;
    }
    if (ui.buttonText({
      text: filename,
      x, y, z,
      w: button_w,
      h: font_height,
      color: selected_shader === shader ? color_selected : shader.valid ? undefined : color_invalid,
      align: glov_font.ALIGN.HFIT,
    })) {
      if (selected_shader === shader) {
        selected_shader = undefined;
      } else {
        selected_shader = shader;
      }
    }

    let stats = getShaderStats(shader.shader_source_text, shader.type === gl.FRAGMENT_SHADER ? 'frag' : 'vert', false);
    if (!stats || stats.err) {
      font.draw({
        x: x + button_w + PAD, y, z,
        w: score_w,
        color: stats?.err ? 0x800000ff : 0x808080ff,
        text: stats?.err ? 'ERR' : '...',
        align: font.ALIGN.HCENTERFIT,
      });
    } else {
      let color = 0x000000ff;
      font.draw({
        x: x + button_w + PAD, y, z,
        w: subscore_w - 1,
        color,
        text: `${stats.spirv?.count_total}`,
        align: font.ALIGN.HCENTERFIT,
      });
      font.draw({
        x: x + button_w + PAD + subscore_w + 1, y, z,
        w: subscore_w - 1,
        color,
        text: stats.bin_size.toLocaleString(),
        align: font.ALIGN.HCENTERFIT,
      });
    }

    y += font_height;
  }

  scroll_area.end(y);
  y = scroll_y_start + min(max_h, y);
  z = Z.SHADER_DEBUG;

  let close_button_size = font_height;
  if (ui.buttonText({
    x: x0 + w - close_button_size,
    y: y0, z: z + 1,
    w: close_button_size, h: close_button_size,
    text: 'X',
  })) {
    settings.set('shader_debug', 0);
  }

  ui.panel({
    x: x0 - PANEL_PAD, y: y0 - PANEL_PAD, z: z - 1,
    w: w + PANEL_PAD * 2, h: y - y0 + PANEL_PAD * 2,
    color: color_panel,
  });

  if (!selected_shader) {
    return;
  }
  let shader = selected_shader;
  x0 += w + PANEL_PAD * 2;
  w = camera2d.x1() - PAD - x0;
  x = x0;
  y = y0;

  font.draw({
    x, y, z,
    w,
    style, text: shader.filename,
    align: font.ALIGN.HCENTERFIT,
  });
  y += font_height + 1;
  ui.drawLine(x0 + w * 0.3, y, x0 + w * 0.7, y, z, 0.5, true, color_line);
  y += PAD;

  scroll_y_start = y;
  scroll_area_source.begin({
    x, y, w, h: max_h,
  });
  sub_w = w - PAD - scroll_area_source.barWidth();
  x = 0;
  y = 0;
  z = Z.UI;

  if (shader.error_text) {
    y += font.draw({
      x, y, z,
      w: sub_w,
      color: 0x800000ff,
      style, text: shader.error_text,
      align: font.ALIGN.HWRAP,
    });
  }

  function flatten(obj, path) {
    for (let key in obj) {
      if (key === 'text' || key === 'spirv_raw') {
        continue;
      }
      let value = obj[key];
      let subpath = path ? `${path}.${key}` : key;
      if (typeof value === 'object') {
        flatten(value, subpath);
      } else {
        font.draw({
          x, y, z,
          w: sub_w,
          style,
          text: `${subpath}: ${value}`,
          align: font.ALIGN.HFIT,
        });
        y += font_height;
      }
    }
  }
  let stats = getShaderStats(shader.shader_source_text, shader.type === gl.FRAGMENT_SHADER ? 'frag' : 'vert');
  if (!stats) {
    y += font.draw({
      x, y, z,
      w,
      style,
      text: 'Loading shader stats...',
      align: font.ALIGN.HWRAP,
    });
  } else if (stats.err) {
    y += font.draw({
      x, y, z,
      w: sub_w,
      style: style_error,
      text: String(stats.err),
      align: font.ALIGN.HWRAP,
    });
  } else {
    flatten(stats);
  }

  let source_height = font_height * 0.5;

  if (stats?.text) {
    y += PAD;
    ui.drawLine(x + w * 0.3, y, x + w * 0.7, y, z, 0.5, true, color_line);
    y += PAD/2;
    font.draw({
      x, y, z,
      w,
      style, text: 'Analyzed Shader Source',
      align: font.ALIGN.HCENTERFIT,
    });
    y += font_height + 1;

    let h = font.draw({
      x, y, z,
      w,
      size: source_height,
      style, text: stats.text,
      align: font.ALIGN.HWRAP,
    });
    if (input.click({ x, y, w, h })) {
      ui.provideUserString('Analyzed shader source', stats.text);
    }
    y += h;
  }

  if (stats?.spirv_raw) {
    y += PAD;
    ui.drawLine(x + w * 0.3, y, x + w * 0.7, y, z, 0.5, true, color_line);
    y += PAD/2;
    font.draw({
      x, y, z,
      w,
      style, text: 'SPIR-V Disassembly',
      align: font.ALIGN.HCENTERFIT,
    });
    y += font_height + 1;

    let h = font.draw({
      x, y, z,
      w,
      size: source_height,
      style, text: stats.spirv_raw,
      align: font.ALIGN.HWRAP,
    });
    if (input.click({ x, y, w, h })) {
      ui.provideUserString('SPIR-V Disassembly', stats.spirv_raw);
    }
    y += h;
  }

  y += PAD;
  ui.drawLine(x + w * 0.3, y, x + w * 0.7, y, z, 0.5, true, color_line);
  y += PAD/2;
  font.draw({
    x, y, z,
    w,
    style, text: 'Actual WebGL Shader Source',
    align: font.ALIGN.HCENTERFIT,
  });
  y += font_height + 1;

  let h = font.draw({
    x, y, z,
    w,
    size: source_height,
    style, text: shader.shader_source_text,
    align: font.ALIGN.HWRAP,
  });
  if (input.click({ x, y, w, h })) {
    ui.provideUserString('Used WebGL shader source', shader.shader_source_text);
  }
  y += h;

  scroll_area_source.end(y);
  y = scroll_y_start + min(max_h, y);
  z = Z.SHADER_DEBUG;

  ui.panel({
    x: x0 - PANEL_PAD, y: y0 - PANEL_PAD, z: z - 1,
    w: w + PANEL_PAD * 2, h: y - y0 + PANEL_PAD * 2,
    color: color_panel,
  });
}

export function shaderDebugUIStartup() {
  // Registering after startup because of needing to call engine.addTickFunc()
  settings.register({
    shader_debug: {
      label: 'Shader Debug',
      default_value: 0,
      type: cmd_parse.TYPE_INT,
      range: [0,1],
      access_show: ['sysadmin'],
      on_change: () => {
        engine.removeTickFunc(shaderDebugUITick);
        if (settings.shader_debug) {
          engine.addTickFunc(shaderDebugUITick);
        }
      },
    },
  });
}
