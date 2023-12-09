/* eslint-disable import/order */
const camera2d = require('./camera2d.js');
const engine = require('./engine.js');
const { renderNeeded } = engine;
const glov_font = require('./font.js');
const { min } = Math;
const { scrollAreaCreate } = require('./scroll_area.js');
const ui = require('./ui.js');
const { uiButtonHeight } = require('./ui.js');
const net = require('./net.js');
const {
  dataErrorEx,
  dataErrorQueueClear,
  dataErrorQueueGet,
} = require('glov/common/data_error.js');
const { plural } = require('glov/common/util.js');
const { vec4 } = require('glov/common/vmath.js');

let gbstate;
let server_error;

Z.BUILD_ERRORS = Z.BUILD_ERRORS || 9900;

function onGBState(state) {
  gbstate = state;
  renderNeeded();
}

function onServerError(err) {
  server_error = err;
  renderNeeded();
}

function onDataErrors(err_list) {
  for (let ii = 0; ii < err_list.length; ++ii) {
    dataErrorEx(err_list[ii]);
  }
  renderNeeded();
}

const PAD = 4;
const color_panel = vec4(0,0,0,1);
const style_title = glov_font.styleColored(null, 0xFF2020ff);
const style = glov_font.styleColored(null, 0xDDDDDDff);
const style_task = glov_font.styleColored(null, 0x00DDDDff);
const style_job = glov_font.styleColored(null, 0x2020FFff);
const color_line = vec4(1,1,1,1);
// eslint-disable-next-line no-control-regex
const strip_ansi = /\u001b\[(?:[0-9;]*)[0-9A-ORZcf-nqry=><]/g;
let scroll_area;
function buildUITick() {
  let data_errors = dataErrorQueueGet();
  if (!gbstate && !server_error && !data_errors.length) {
    return;
  }
  const x0 = camera2d.x0() + PAD;
  const y0 = camera2d.y0() + PAD;
  let z = Z.BUILD_ERRORS;
  const w = camera2d.w() * 0.75;
  const { font, title_font, font_height } = ui;
  let x = x0;
  let y = y0;

  let error_count = (gbstate?.error_count || 0) + (server_error ? 1 : 0) + data_errors.length;
  let warning_count = gbstate?.warning_count || 0;
  title_font.drawSizedAligned(style_title, x, y, z, font_height, font.ALIGN.HCENTERFIT, w, 0,
    `${error_count} ${plural(error_count, 'error')}, ` +
    `${warning_count} ${plural(warning_count, 'warning')}`);
  y += font_height + 1;
  ui.drawLine(x0 + w * 0.3, y, x0 + w * 0.7, y, z, 0.5, true, color_line);
  y += PAD;

  if (!scroll_area) {
    scroll_area = scrollAreaCreate({
      z,
      background_color: null,
      auto_hide: true,
    });
  }

  const max_h = camera2d.y1() - PAD - y;
  let scroll_y_start = y;
  scroll_area.begin({
    x, y, w, h: max_h,
  });
  const sub_w = w - PAD - scroll_area.barWidth();
  y = 0;
  z = Z.UI;

  function printLine(type, str) {
    str = str.replace(strip_ansi, '');
    y += font.drawSizedWrapped(style, x, y, z, sub_w, 0, font_height,
      `${type}: ${str}`);
  }

  if (gbstate) {
    for (let task_name in gbstate.tasks) {
      let task = gbstate.tasks[task_name];
      x = 0;
      font.drawSizedAligned(style_task, x, y, z, font_height, font.ALIGN.HLEFT, sub_w, 0,
        `${task_name}:`);
      y += font_height;
      x += font_height;
      let printed_any = false;
      for (let job_name in task.jobs) {
        let job = task.jobs[job_name];
        let { warnings, errors } = job;
        if (job_name !== 'all') {
          if (job_name.startsWith('source:')) {
            job_name = job_name.slice(7);
          }
          y += font.drawSizedWrapped(style_job, x, y, z, sub_w, 0, font_height,
            job_name);
        }
        if (warnings) {
          for (let ii = 0; ii < warnings.length; ++ii) {
            printLine('Warning', warnings[ii]);
            printed_any = true;
          }
        }
        if (errors) {
          for (let ii = 0; ii < errors.length; ++ii) {
            printLine('Error', errors[ii]);
            printed_any = true;
          }
        }
      }
      if (!printed_any && task.err) {
        printLine('Error', task.err);
      }
      y += PAD;
    }
  }

  if (server_error) {
    x = 0;
    font.drawSizedAligned(style_task, x, y, z, font_height, font.ALIGN.HLEFT, sub_w, 0,
      'Server Error:');
    y += font_height;
    x += font_height;
    printLine('Server error', server_error);
  }

  for (let ii = 0; ii < data_errors.length; ++ii) {
    let { msg } = data_errors[ii];
    x = 0;
    printLine('Data error', msg);
  }

  scroll_area.end(y);
  y = scroll_y_start + min(max_h, y);

  if (ui.buttonText({
    x: x0 + w - uiButtonHeight(),
    y: y0, z: Z.BUILD_ERRORS + 1,
    w: uiButtonHeight(),
    text: 'X',
  })) {
    gbstate = null;
    server_error = null;
    dataErrorQueueClear();
  }

  ui.panel({
    x: x0 - PAD, y: y0 - PAD, z: Z.BUILD_ERRORS - 1,
    w: w + PAD * 2, h: y - y0 + PAD * 2,
    color: color_panel,
  });

}

export function buildUIStartup() {
  if (net.client && engine.DEBUG) {
    net.client.onMsg('gbstate', onGBState);
    net.client.onMsg('server_error', onServerError);
    net.client.onMsg('data_errors', onDataErrors);
    net.subs.on('connect', function () {
      let pak = net.client.pak('gbstate_enable');
      pak.writeBool(true);
      pak.send();
    });
    engine.addTickFunc(buildUITick);
  }
}
