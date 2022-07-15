const engine = require('./engine.js');
const input = require('./input.js');
const { KEYS } = require('./input.js');
const { ansi, padRight, terminalCreate } = require('./terminal.js');

let settings_terminal;
let base_terminal;
let settings_up = false;

const MODEMS = [
  { baud: 2400, label: 'Hayes Smartmodem 2400bps' },
  { baud: 9600, label: 'Motorola V.3225 9600bps' },
  { baud: 28800, label: 'USR Sportster V.34 28.8kbps' },
  { baud: Infinity, label: 'NULL' },
];

export function terminalSettingsShow() {
  settings_up = true;
}

function settingsOverlay(dt) {
  if (input.keyDownEdge(KEYS.O)) {
    settings_up = !settings_up;
  }
  if (settings_up) {
    settings_terminal.print({
      fg: 6+8,
      x: 10, y: 0,
      text: 'TERMINAL OPTIONS'
    });
    let modem_idx = 0;
    for (let ii = 0; ii < MODEMS.length; ++ii) {
      if (MODEMS[ii].baud === base_terminal.baud) {
        modem_idx = ii;
      }
    }
    let sel = settings_terminal.menu({
      x: 0, y: 1,
      color_sel: { fg: 7, bg: 0 },
      color_unsel: { fg: 7+8, bg: 1 },
      color_execute: { fg: 1, bg: 6+8 },
      pre_sel: ' ■ ',
      pre_unsel: '   ',
      key: 'terminal_settings',
      items: [
        padRight(`Modem: ${MODEMS[modem_idx].label}`, 34),
        padRight(`Display: ${engine.getViewportPostprocess() ? 'CRT' : 'LCD'}`, 34),
        padRight(`Exit ${ansi.yellow.bright('[O]')}ptions`, 34),
      ],
    });
    if (sel === 0) {
      modem_idx = (modem_idx + settings_terminal.menu_select_delta + MODEMS.length) % MODEMS.length;
      base_terminal.baud = MODEMS[modem_idx].baud;
    } else if (sel === 1) {
      engine.setViewportPostprocess(!engine.getViewportPostprocess());
    } else if (sel === 2 || input.keyDownEdge(KEYS.ESCAPE)) {
      settings_up = false;
    }

    settings_terminal.render();
  }
}

export function terminalSettingsInit(terminal) {
  base_terminal = terminal;
  settings_terminal = terminalCreate({
    auto_scroll: false,
    baud: 0,
    x: 10 * terminal.char_width,
    y: 2 * terminal.char_height,
    z: Z.DEBUG,
    w: 38,
    h: 6,
    draw_cursor: false,
  });
  settings_terminal.color(7+8, 1);
  settings_terminal.clear();
  settings_terminal.color(null, 0);
  settings_terminal.fill({
    x: 0, y: settings_terminal.h-1, w: 1, h: 1,
  });
  settings_terminal.fill({
    x: settings_terminal.w-1, y: 0, w: 1, h: 1,
  });
  settings_terminal.color(8, 0);
  settings_terminal.fill({
    x: 1, y: settings_terminal.h-1, w: settings_terminal.w-1, h: 1,
    ch: '▓',
  });
  settings_terminal.fill({
    x: settings_terminal.w-1, y: 1, w: 1, h: settings_terminal.h-2,
    ch: '▓',
  });

  engine.addTickFunc(settingsOverlay);
}
