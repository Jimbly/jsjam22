/*eslint global-require:off*/
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('jsjam22'); // Before requiring anything else that might load from this

const camera2d = require('glov/client/camera2d.js');
const engine = require('glov/client/engine.js');
const net = require('glov/client/net.js');
const pico8 = require('glov/client/pico8.js');
const { mashString, randCreate } = require('glov/common/rand_alea.js');
const { createSprite } = require('glov/client/sprites.js');
const { createSpriteAnimation } = require('glov/client/sprite_animation.js');
const ui = require('glov/client/ui.js');
const { vec2 } = require('glov/common/vmath.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.BOARD = 10;
Z.UI = 100;

// Virtual viewport for our game logic
const game_width = 640;
const game_height = 384;

let sprites = {};

const TILE_SIZE = 16;

const TILE_EMPTY = 0;
const TILE_ROAD = 1;
// const TILE_SOURCE = 2;
const TILE_DETAIL = 3;

let rand;
let game_state;

function gameStateCreate() {
  rand = randCreate(mashString('test'));
  let board = [];
  let w = 24;
  let h = 24;
  for (let yy = 0; yy < h; ++yy) {
    let row = [];
    for (let xx = 0; xx < w; ++xx) {
      row.push({
        tile: TILE_EMPTY,
      });
    }
    board.push(row);
  }
  for (let ii = 0; ii < 20; ++ii) {
    let x = rand.range(w);
    let y = rand.range(h);
    let cell = board[y][x];
    cell.tile = TILE_DETAIL;
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
    board[4][2+ii].tile = TILE_ROAD;
    board[9][2+ii].tile = TILE_ROAD;
    board[5+ii][2].tile = TILE_ROAD;
    board[5+ii][5].tile = TILE_ROAD;
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

function drawShop(x0, y0, w, h) {
  ui.drawRect2({ x: x0, y: y0, w, h, color: pico8.colors[15], z: Z.UI - 1 });
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
      switch (cell.tile) { // eslint-disable-line default-case
        case TILE_ROAD:
          frame = 0;
          break;
        case TILE_DETAIL:
          frame = cell.anim.getFrame(dt);
          break;
      }
      if (frame !== null) {
        sprites.tiles.draw({
          x, y, z: Z.BOARD, frame,
        });
      }
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
  let pixely = 'strict';
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

  ui.scaleSizes(13 / 32);
  ui.setFontHeight(8);

  init();

  engine.setState(statePlay);
}
