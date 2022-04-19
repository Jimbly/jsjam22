/*eslint global-require:off*/
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('jsjam22'); // Before requiring anything else that might load from this

const camera2d = require('glov/client/camera2d.js');
const engine = require('glov/client/engine.js');
const input = require('glov/client/input.js');
const { floor } = Math;
const net = require('glov/client/net.js');
const pico8 = require('glov/client/pico8.js');
const { mashString, randCreate } = require('glov/common/rand_alea.js');
const { createSprite } = require('glov/client/sprites.js');
const { createSpriteAnimation } = require('glov/client/sprite_animation.js');
const ui = require('glov/client/ui.js');
const { vec2, vec4 } = require('glov/common/vmath.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.BOARD = 10;
Z.UI = 100;

// Virtual viewport for our game logic
const game_width = 640;
const game_height = 384;

let sprites = {};

const TILE_SIZE = 16;

const TYPE_EMPTY = 0;
const TYPE_DETAIL = 1;
const TYPE_SOURCE = 2;
const TYPE_SINK = 3;
const TYPE_ROAD = 4;

let rand;
let game_state;

const color_ghost = vec4(1, 1, 1, 0.5);

function gameStateCreate() {
  rand = randCreate(mashString('test'));
  let board = [];
  let w = 24;
  let h = 24;
  for (let yy = 0; yy < h; ++yy) {
    let row = [];
    for (let xx = 0; xx < w; ++xx) {
      row.push({
        type: TYPE_EMPTY,
      });
    }
    board.push(row);
  }
  for (let ii = 0; ii < 20; ++ii) {
    let x = rand.range(w);
    let y = rand.range(h);
    let cell = board[y][x];
    cell.type = TYPE_DETAIL;
    cell.anim = createSpriteAnimation({
      idle: {
        frames: [2,3],
        times: [500, 500],
        times_random: [100, 100],
      },
    });
    cell.anim.setState('idle');
    cell.anim.update(rand.range(1000));
  }
  // 4x6 road at 2,4
  for (let ii = 0; ii < 4; ++ii) {
    board[4][2+ii].type = TYPE_ROAD;
    board[9][2+ii].type = TYPE_ROAD;
    board[5+ii][2].type = TYPE_ROAD;
    board[5+ii][5].type = TYPE_ROAD;
  }
  return {
    w, h,
    board,
  };
}

function init() {
  sprites.tiles = createSprite({
    name: 'tiles',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE, TILE_SIZE),
  });

  game_state = gameStateCreate();
}

const SHOP = [
  {
    name: 'Tree',
    cell: {
      type: TYPE_SOURCE,
      frame: 1,
    },
  },
  {
    name: 'Output',
    cell: {
      type: TYPE_SINK,
      frame: 4,
    },
  },

  {
    name: 'Debug',
    cell: {
      type: TYPE_ROAD,
      frame: 0,
    },
    debug: true,
  },
];
function drawShop(x0, y0, w, h) {
  const PAD = 4;
  const BUTTON_H = 26;
  const BUTTON_W = 48;
  let x = x0;
  let y = y0;
  ui.drawRect2({ x, y, w, h, color: pico8.colors[15], z: Z.UI - 1 });
  x += PAD;
  y += PAD;
  w -= PAD*2;
  h -= PAD*2;
  for (let ii = 0; ii < SHOP.length; ++ii) {
    let elem = SHOP[ii];
    if (elem.debug && !engine.DEBUG) {
      continue;
    }
    if (ui.button({
      x, y, img: sprites.tiles, frame: elem.cell.frame,
      h: BUTTON_H,
      w: BUTTON_W,
    })) {
      if (game_state.cursor) {
        // return funds
      }
      game_state.cursor = elem;
    }
    y += BUTTON_H + PAD;
  }
}

function drawBoard(x0, y0, w, h) {
  const dt = engine.getFrameDt();
  ui.drawRect2({ x: x0, y: y0, w, h, color: pico8.colors[11], z: Z.BACKGROUND });

  camera2d.push();
  let cammap = camera2d.calcMap([], [x0, y0, x0 + w, y0 + h], [0,0,w,h]);
  camera2d.set(cammap[0], cammap[1], cammap[2], cammap[3]);
  // now working in [0,0]...[w,h] space
  let { board } = game_state;
  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      let x = xx * TILE_SIZE;
      let y = yy * TILE_SIZE;
      let frame = null;
      switch (cell.type) { // eslint-disable-line default-case
        case TYPE_ROAD:
          frame = 0;
          break;
        case TYPE_DETAIL:
          frame = cell.anim.getFrame(dt);
          break;
      }
      if (frame !== null) {
        sprites.tiles.draw({
          x, y, z: Z.BOARD, frame,
        });
      }
      if (input.click({
        x, y, w: TILE_SIZE, h: TILE_SIZE,
      })) {
        if (game_state.cursor) {
          cell.type = game_state.cursor.cell.type;
          if (!input.keyDown(input.KEYS.SHIFT)) {
            game_state.cursor = null;
          }
        }
      }
    }
  }
  let mouse_over = input.mouseOver({ x: 0, y: 0, w, h });
  if (game_state.cursor) {
    if (mouse_over) {
      let mouse_pos = input.mousePos();

      let x = floor(mouse_pos[0] / TILE_SIZE);
      let y = floor(mouse_pos[1] / TILE_SIZE);
      sprites.tiles.draw({
        x: x * TILE_SIZE,
        y: y * TILE_SIZE,
        z: Z.UI,
        color: color_ghost,
        frame: game_state.cursor.cell.frame,
      });
    }
  }

  camera2d.pop();
}

function statePlay(dt) {

  const SHOP_W = game_width/4;
  drawShop(0, 0, SHOP_W, game_height);
  drawBoard(SHOP_W, 0, game_width - SHOP_W, game_height);
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
    do_borders: true,
  })) {
    return;
  }
  font = engine.font;

  ui.scaleSizes(26 / 32);
  ui.setFontHeight(16);

  init();

  engine.setState(statePlay);
}
