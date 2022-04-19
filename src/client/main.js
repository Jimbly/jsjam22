/*eslint global-require:off*/
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('jsjam22'); // Before requiring anything else that might load from this

const camera2d = require('glov/client/camera2d.js');
const engine = require('glov/client/engine.js');
const input = require('glov/client/input.js');
const { floor, max, sin, PI } = Math;
const net = require('glov/client/net.js');
const pico8 = require('glov/client/pico8.js');
const { mashString, randCreate } = require('glov/common/rand_alea.js');
const { createSprite } = require('glov/client/sprites.js');
const { createSpriteAnimation } = require('glov/client/sprite_animation.js');
const ui = require('glov/client/ui.js');
const { lerp, easeInOut } = require('glov/common/util.js');
const { vec2, vec4 } = require('glov/common/vmath.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.BOARD = 10;
Z.WORKERS = 20;
Z.UI = 100;

// Virtual viewport for our game logic
const game_width = 640;
const game_height = 384;

let sprites = {};

const TILE_SIZE = 16;

const TICK_TIME = 1000;

const TYPE_EMPTY = 0;
const TYPE_DETAIL = 1;
const TYPE_SOURCE = 2;
const TYPE_SINK = 3;
const TYPE_ROAD = 4;
const TYPE_CRAFT = 5;

const TYPE_PICKUPABLE = {
  [TYPE_SOURCE]: true,
  [TYPE_SINK]: true,
};
const TYPE_OVERWRITABLE = {
  [TYPE_EMPTY]: true,
  [TYPE_DETAIL]: true,
};
const TYPE_SIZE = {
  [TYPE_CRAFT]: 2,
};
const TYPE_ROAD_ADJACENT = {
  [TYPE_SOURCE]: true,
  [TYPE_SINK]: true,
  [TYPE_CRAFT]: true,
};

let rand;
let game_state;

const color_ghost = vec4(1, 1, 1, 0.8);
const color_invalid = vec4(1, 0, 0, 0.5);

const DIR_EAST = 0; // +X
// const DIR_SOUTH = 1; // +Y
// const DIR_WEST = 2; // -X
// const DIR_NORTH = 3; // -Y
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

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
  }
  // 4x6 road at 2,4
  for (let ii = 0; ii < 4; ++ii) {
    board[4][2+ii].type = TYPE_ROAD;
    board[9][2+ii].type = TYPE_ROAD;
    board[5+ii][2].type = TYPE_ROAD;
    board[5+ii][5].type = TYPE_ROAD;
  }
  let workers = [];
  workers.push({
    x: 2, y: 4, dir: DIR_EAST,
  });
  return {
    w, h,
    board,
    workers,
    tick_countdown: TICK_TIME,
    num_ticks: 0,
  };
}

function init() {
  sprites.tiles = createSprite({
    name: 'tiles',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE, TILE_SIZE),
  });
  sprites.tiles_2x = createSprite({
    name: 'tiles',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE * 2, TILE_SIZE * 2),
  });
  sprites.tiles_ui = createSprite({
    name: 'tiles_ui',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE, TILE_SIZE),
  });

  game_state = gameStateCreate();
}

function getCellFrame(cell) {
  let sprite = TYPE_SIZE[cell.type] === 2 ? sprites.tiles_2x : sprites.tiles;
  let frame = null;
  switch (cell.type) { // eslint-disable-line default-case
    case TYPE_ROAD:
      frame = 0;
      break;
    case TYPE_DETAIL:
      if (!cell.anim) {
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
      frame = cell.anim.getFrame(engine.frame_dt);
      break;
    case TYPE_SOURCE:
      frame = 1;
      break;
    case TYPE_SINK:
      frame = 4;
      break;
    case TYPE_CRAFT:
      frame = 4; // note: 2x tile space
      break;
  }
  return { sprite, frame };
}

function drawCell(cell, x, y, z, color) {
  let { sprite, frame } = getCellFrame(cell);
  if (frame !== null) {
    sprite.draw({
      x, y, z: z || Z.BOARD, frame,
      color,
    });
  }
}

const SHOP = [
  {
    name: 'Tree',
    cell: {
      type: TYPE_SOURCE,
    },
  },
  {
    name: 'Output',
    cell: {
      type: TYPE_SINK,
    },
  },
  {
    name: 'Craft',
    cell: {
      type: TYPE_CRAFT,
    },
  },

  {
    name: 'Debug',
    cell: {
      type: TYPE_ROAD,
    },
    debug: true,
  },
];
function refundCursor() {
  if (game_state.cursor) {
    // TODO: refund
    game_state.cursor = null;
  }
}
function drawShop(x0, y0, w, h) {
  const PAD = 4;
  const BUTTON_H = 22;
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
    let { sprite, frame } = getCellFrame(elem.cell);
    let scale = TYPE_SIZE[elem.cell.type] || 1;
    let button_h = BUTTON_H + (scale - 1) * 16;
    if (ui.button({
      x, y, img: sprite, frame,
      h: button_h,
      w: BUTTON_W,
    })) {
      refundCursor();
      game_state.cursor = elem;
    }
    y += button_h + PAD;
  }
}

function typeAt(x, y) {
  let cell = game_state.board[y]?.[x];
  return cell && cell.type || TYPE_EMPTY;
}

function canPlace(cell, x, y) {
  let size = TYPE_SIZE[cell.type] || 1;
  let { board } = game_state;
  for (let yy = 0; yy < size; ++yy) {
    for (let xx = 0; xx < size; ++xx) {
      let target_cell = board[y + yy]?.[x + xx];
      if (!target_cell) {
        return false;
      }
      if (!TYPE_OVERWRITABLE[target_cell.type]) {
        return false;
      }
    }
  }
  // check for neighboring 2x2s
  for (let yy = -1; yy <= 0; ++yy) {
    for (let xx = -1; xx <= 0; ++xx) {
      let target_cell = board[y + yy]?.[x + xx];
      if (target_cell && TYPE_SIZE[target_cell.type] === 2) {
        return false;
      }
    }
  }
  if (TYPE_ROAD_ADJACENT[cell.type]) {
    let ok = false;
    for (let ii = 0; ii < DX.length; ++ii) {
      for (let jj = 0; jj < size; ++jj) {
        let dx = DX[ii];
        if (dx > 0) {
          dx += size-1;
        }
        let dy = DY[ii];
        if (dy > 0) {
          dy += size-1;
        }
        if (typeAt(x + dx, y + dy) === TYPE_ROAD) {
          ok = true;
        }
        if (size === 2) {
          if (dx) {
            dy++;
          } else {
            dx++;
          }
          if (typeAt(x + dx, y + dy) === TYPE_ROAD) {
            ok = true;
          }
        }
      }
    }
    if (!ok) {
      return false;
    }
  }
  return true;
}

function drawBoard(x0, y0, w, h) {
  ui.drawRect2({ x: x0, y: y0, w, h, color: pico8.colors[11], z: Z.BACKGROUND });

  camera2d.push();
  let cammap = camera2d.calcMap([], [x0, y0, x0 + w, y0 + h], [0,0,w,h]);
  camera2d.set(cammap[0], cammap[1], cammap[2], cammap[3]);
  // now working in [0,0]...[w,h] space

  let { board, workers } = game_state;
  let tick_progress = 1 - game_state.tick_countdown / TICK_TIME;

  // draw tiles
  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      let x = xx * TILE_SIZE;
      let y = yy * TILE_SIZE;
      drawCell(cell, x, y);
      if (input.click({
        x, y, w: TILE_SIZE, h: TILE_SIZE,
      })) {
        if (game_state.cursor && canPlace(game_state.cursor.cell, xx, yy)) {
          cell.type = game_state.cursor.cell.type;
          if (!input.keyDown(input.KEYS.SHIFT)) {
            game_state.cursor = null;
          }
        } else if (TYPE_PICKUPABLE[cell.type]) {
          refundCursor();
          game_state.cursor = {
            cell: {
              type: cell.type,
            }
          };
          cell.type = TYPE_EMPTY;
        }
      }
    }
  }

  // draw workers
  for (let ii = 0; ii < workers.length; ++ii) {
    let worker = workers[ii];
    let { x, y, lastx, lasty } = worker;
    if (lastx !== undefined && tick_progress < 0.5) {
      let a = easeInOut(tick_progress * 2, 2);
      x = lerp(a, lastx, x);
      y = lerp(a, lasty, y) + sin(a * PI) * -0.5;
    }
    x *= TILE_SIZE;
    y *= TILE_SIZE;
    sprites.tiles.draw({
      x, y, z: Z.WORKERS,
      frame: 5,
    });
  }


  let mouse_over = input.mouseOver({ x: 0, y: 0, w, h });
  let drew_cursor = false;
  if (mouse_over) {
    let mouse_pos = input.mousePos();

    let x = floor(mouse_pos[0] / TILE_SIZE);
    let y = floor(mouse_pos[1] / TILE_SIZE);
    let cell = board[y]?.[x];
    if (cell) {
      if (game_state.cursor) {
        drew_cursor = true;
        if (canPlace(game_state.cursor.cell, x, y)) {
          drawCell(game_state.cursor.cell, x * TILE_SIZE, y * TILE_SIZE, Z.UI, color_ghost);
        } else {
          drawCell(game_state.cursor.cell, x * TILE_SIZE, y * TILE_SIZE, Z.UI, color_invalid);
        }
      } else if (cell && TYPE_PICKUPABLE[cell.type]) {
        sprites.tiles_ui.draw({
          x: x * TILE_SIZE,
          y: y * TILE_SIZE,
          z: Z.UI,
          frame: 0,
        });
      }
    }
  }

  camera2d.pop();

  if (game_state.cursor && !drew_cursor) {
    let mouse_pos = input.mousePos();
    drawCell(game_state.cursor.cell, mouse_pos[0] - TILE_SIZE/2, mouse_pos[1] - TILE_SIZE/2, Z.UI + 10, color_ghost);
  }
}

const BOUNCE_ORDER = [0, 1, 3, 2];
function tickState() {
  let { workers } = game_state;
  for (let ii = 0; ii < workers.length; ++ii) {
    let worker = workers[ii];
    let { x, y, dir } = worker;
    for (let jj = 0; jj < BOUNCE_ORDER.length; ++jj) {
      let dd = (dir + BOUNCE_ORDER[jj]) % 4;
      let destx = x + DX[dd];
      let desty = y + DY[dd];
      if (typeAt(destx, desty) === TYPE_ROAD) {
        worker.lastx = x;
        worker.lasty = y;
        worker.x = destx;
        worker.y = desty;
        worker.dir = dd;
        break;
      }
    }
  }
}

function statePlay(dt) {

  if (dt >= game_state.tick_countdown) {
    game_state.tick_countdown = max(TICK_TIME/2, TICK_TIME - (dt - game_state.tick_countdown));
    game_state.num_ticks++;
    tickState();
  } else {
    game_state.tick_countdown -= dt;
  }

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
    show_fps: false,
    ui_sprites: {
      button: ['ui/button', [4,14,4], [22]],
      button_down: ['ui/button_down', [4,14,4], [22]],
      button_disabled: ['ui/button_disabled', [4,14,4], [22]],
    },
  })) {
    return;
  }
  font = engine.font;

  ui.scaleSizes(22 / 32);
  ui.setFontHeight(16);

  init();

  engine.setState(statePlay);
}
