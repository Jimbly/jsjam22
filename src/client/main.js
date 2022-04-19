/*eslint global-require:off*/
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('jsjam22'); // Before requiring anything else that might load from this

const engine = require('glov/client/engine.js');
const { sin } = Math;
const net = require('glov/client/net.js');
const { createSprite } = require('glov/client/sprites.js');
const ui = require('glov/client/ui.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.UI_TEST = 200;

// Virtual viewport for our game logic
const game_width = 640;
const game_height = 384;

let sprites = {};
function init() {
  sprites.test = createSprite({
    name: 'test',
  });
}

function statePlay(dt) {
  ui.print(null,10,10,1, 'Test!');
  sprites.test.draw({
    x: 20 + sin(engine.frame_timestamp * 0.005) * 20,
    y: 20,
    w: 10,
    h: 10,
  });
}

export function main() {
  if (engine.DEBUG) {
    // Enable auto-reload, etc
    net.init({ engine });
  }

  const font_info_04b03x2 = require('./img/font/04b03_8x2.json');
  const font_info_04b03x1 = require('./img/font/04b03_8x1.json');
  const font_info_palanquin32 = require('./img/font/palanquin32.json');
  let pixely = 'on';
  let font;
  if (pixely === 'strict') {
    font = { info: font_info_04b03x1, texture: 'font/04b03_8x1' };
  } else if (pixely && pixely !== 'off') {
    font = { info: font_info_04b03x2, texture: 'font/04b03_8x2' };
  } else {
    font = { info: font_info_palanquin32, texture: 'font/palanquin32' };
  }

  if (!engine.startup({
    game_width,
    game_height,
    pixely,
    font,
    viewport_postprocess: false,
    antialias: false,
  })) {
    return;
  }
  font = engine.font;

  ui.scaleSizes(13 / 32);
  ui.setFontHeight(8);

  init();

  engine.setState(statePlay);
}
