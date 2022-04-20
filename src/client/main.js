/*eslint global-require:off*/
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('jsjam22'); // Before requiring anything else that might load from this

const assert = require('assert');
const camera2d = require('glov/client/camera2d.js');
const engine = require('glov/client/engine.js');
const input = require('glov/client/input.js');
const { KEYS } = input;
const { floor, max, sin, PI } = Math;
const net = require('glov/client/net.js');
const particle_data = require('./particle_data.js');
const { preloadParticleData } = require('glov/client/particles.js');
const pico8 = require('glov/client/pico8.js');
const { mashString, randCreate } = require('glov/common/rand_alea.js');
const { createSprite } = require('glov/client/sprites.js');
const { createSpriteAnimation } = require('glov/client/sprite_animation.js');
const ui = require('glov/client/ui.js');
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { clamp, clone, lerp, easeInOut, easeIn, easeOut, ridx } = require('glov/common/util.js');
const { vec2, vec4 } = require('glov/common/vmath.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.BOARD = 10;
Z.WORKERS = 20;
Z.UI = 100;
Z.PARTICLES = 150;
Z.FLOATERS = 200;

// Virtual viewport for our game logic
const game_width = 640;
const game_height = 384;

let auto_load = true;

let sprites = {};
let particles;

const TILE_SIZE = 16;
const CARRY_OFFSET_SOURCE_SINK = 1;
const CARRY_OFFSET_WORKER = 8;

const TICK_TIME = 1000;

const TYPE_EMPTY = 0;
const TYPE_DETAIL = 1;
const TYPE_SOURCE = 2;
const TYPE_SINK = 3;
const TYPE_ROAD = 4;
const TYPE_CRAFT = 5;
const TYPE_DEBUG_WORKER = 6;

const RESOURCE_WOOD = 1;
const RESOURCE_BERRY = 2;
const RESOURCE_METAL = 3;
const RESOURCE_FRAMES = {
  [RESOURCE_WOOD]: 9,
  [RESOURCE_BERRY]: 11,
  [RESOURCE_METAL]: 27,
};

const ANIMDATA_DETAIL = {
  idle: {
    frames: [2,10],
    times: [500, 500],
    times_random: [100, 100],
  },
};

const ANIMDATA_WORKER = {
  idle: {
    frames: [5,6],
    times: [1000, 200],
    times_random: [5000, 100],
  },
};

const TYPE_ROTATABLE = {
  [TYPE_CRAFT]: true,
};
const TYPE_PICKUPABLE = {
  [TYPE_SOURCE]: true,
  [TYPE_SINK]: true,
  [TYPE_CRAFT]: true,
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
const color_craft_input = vec4(1, 1, 1, 0.4);
const color_invalid = vec4(1, 0, 0, 0.5);
const colors_debug = ui.makeColorSet([1, 0.5, 1, 1]);

// const DIR_EAST = 0; // +X
// const DIR_SOUTH = 1; // +Y
// const DIR_WEST = 2; // -X
// const DIR_NORTH = 3; // -Y
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
// const DXY = [[1,0], [0,1], [-1,0], [0,-1]];
const DXY3 = [[3,0], [0,3], [-3,0], [0,-3]];

const QUAD_X = [0, 0, 1, 1];
const QUAD_Y = [0, 1, 1, 0];

function patternLoop() {
  let w = 4 + rand.range(3);
  let h = 4 + rand.range(3);
  if (w > 4 && h > 4) {
    if (rand.range(2)) {
      w = 4;
    } else {
      h = 4;
    }
  }
  let ret = [];
  for (let yy = 0; yy < h; ++yy) {
    let row = [];
    for (let xx = 0; xx < w; ++xx) {
      if (!xx || !yy || xx === w - 1 || yy === h - 1) {
        row.push(1);
      } else {
        row.push(0);
      }
    }
    ret.push(row);
  }
  ret.w = w;
  ret.h = h;
  return ret;
}

function patternBend() {
  let w = 4 + rand.range(3);
  let h = 4 + rand.range(3);
  if (w > 4 && h > 4) {
    if (rand.range(2)) {
      w = 4;
    } else {
      h = 4;
    }
  }
  let x = rand.range(2) * (w - 1);
  let y = rand.range(2) * (h - 1);
  let ret = [];
  for (let yy = 0; yy < h; ++yy) {
    let row = [];
    for (let xx = 0; xx < w; ++xx) {
      if (xx === x || yy === y) {
        row.push(1);
      } else {
        row.push(0);
      }
    }
    ret.push(row);
  }
  ret.w = w;
  ret.h = h;
  return ret;
}

const ROAD_ADD_FADE_TIME = 300;
const ROAD_ADD_FADE_DELTA = 66;
const WORKER_FADE = 750;
function gameStateAddPattern(state, pattern, x, y) {
  let { board, workers, w } = state;
  let locations = [];
  let fill_start;
  for (let yy = 0; yy < pattern.length; ++yy) {
    let row = pattern[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      if (row[xx]) {
        let loc = [x+xx, y+yy];
        if (!fill_start) {
          fill_start = loc;
        }
        let cell = board[y + yy][x + xx];
        assert(cell.type === TYPE_EMPTY || cell.type === TYPE_DETAIL);
        cell.type = TYPE_ROAD;
        locations.push(loc);
      }
    }
  }

  // Flood-fill road
  let countdown = ROAD_ADD_FADE_TIME;
  let seen = {};
  let to_search = [];
  function fillRoad(xx, yy) {
    let idx = xx + yy * w;
    if (seen[idx]) {
      return;
    }
    seen[idx] = true;
    let pair = [xx, yy];
    to_search.push(pair);
  }
  fillRoad(fill_start[0], fill_start[1]);
  while (to_search.length) {
    let pos = to_search.pop();
    ([x, y] = pos);
    board[y][x].road_fade = countdown;
    countdown += ROAD_ADD_FADE_DELTA;
    for (let ii = 0; ii < DX.length; ++ii) {
      let x2 = x + DX[ii];
      let y2 = y + DY[ii];
      let cell = board[y2]?.[x2];
      if (!cell) {
        continue;
      }
      if (cell.type === TYPE_ROAD) {
        fillRoad(x2, y2);
      }
    }
  }

  let worker_pos = locations[rand.range(locations.length)];
  workers.push({
    x: worker_pos[0], y: worker_pos[1],
    dir: rand.range(4),
    worker_fade: WORKER_FADE,
  });
}

function gameStateAddFirstLoop(state) {
  // loop road in center
  let { w, h, board } = state;
  let pattern = patternLoop();
  gameStateAddPattern(state, pattern, floor((w - pattern.w) / 2), floor((h - pattern.h) / 2));
  // Add an initial output sink
  let output_spots = {};
  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      if (cell.type === TYPE_ROAD) {
        for (let ii = 0; ii < DX.length; ++ii) {
          let x2 = xx + DX[ii];
          let y2 = yy + DY[ii];
          if (board[y2][x2].type === TYPE_EMPTY || board[y2][x2].type === TYPE_DETAIL) {
            output_spots[`${x2}_${y2}`] = [x2, y2];
          }
        }
      }
    }
  }
  let keys = Object.keys(output_spots);
  let output_pos = output_spots[keys[rand.range(keys.length)]];
  board[output_pos[1]][output_pos[0]].type = TYPE_SINK;
}

const GAME_STATE_VER = 2;
function gameStateCreate(seed) {
  rand = randCreate(mashString(seed));
  let board = [];
  let w = 30;
  let h = 24;
  for (let yy = 0; yy < h; ++yy) {
    let row = [];
    for (let xx = 0; xx < w; ++xx) {
      row.push({
        x: xx,
        y: yy,
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
  let workers = [];
  let state = {
    w, h,
    board,
    workers,
    tick_countdown: TICK_TIME,
    num_ticks: 0,
    resources: {},
    ever_output: {},
    ver: GAME_STATE_VER,
  };
  gameStateAddFirstLoop(state);
  return state;
}

function randomRoadPattern() {
  let value = rand.random();
  if (value < 0.333) {
    return patternLoop();
  } else {
    return patternBend();
  }
}

function boardIsRoadDelta(board, x, y, delta) {
  x += delta[0];
  y += delta[1];
  if (x < 0 || x >= board[0].length || y < 0 || y >= board.length) {
    return false;
  }
  return board[y][x].type === TYPE_ROAD;
}

const PATTERN_OUTSIDE_PAD = 1; // space required between pattern and outer edge of map
const PATTERN_MASK_NO = [
  [-2, -1], [-2, 0], [-2, 1],
  [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2],
  [0, -2], [0, -1], [0, 0], [0, 1], [0, 2],
  [1, -2], [1, -1], [1, 0], [1, 1], [1, 2],
  [2, -1], [2, 0], [2, 1],
];
function patternFits(state, pattern, pat_x, pat_y) {
  let { w, h, board } = state;
  let { w: pat_w, h: pat_h } = pattern;
  if (pat_x < PATTERN_OUTSIDE_PAD || pat_y < PATTERN_OUTSIDE_PAD ||
    pat_x + pat_w > w - PATTERN_OUTSIDE_PAD || pat_y + pat_h > h - PATTERN_OUTSIDE_PAD
  ) {
    return false;
  }
  let neighbor_matches = 0;
  for (let yy = 0; yy < pat_h; ++yy) {
    let row = pattern[yy];
    let test_y = pat_y + yy;
    for (let xx = 0; xx < pat_w; ++xx) {
      if (row[xx]) {
        let test_x = pat_x + xx;
        // ensure nothing within the mask
        for (let ii = 0; ii < PATTERN_MASK_NO.length; ++ii) {
          if (boardIsRoadDelta(board, test_x, test_y, PATTERN_MASK_NO[ii])) {
            return false;
          }
        }
        // check if we have a 2-away other road
        for (let ii = 0; ii < DX.length; ++ii) {
          if (boardIsRoadDelta(board, test_x, test_y, DXY3[ii])) {
            neighbor_matches++;
            break;
          }
        }
      }
    }
  }
  if (neighbor_matches < 2) {
    return false;
  }
  return true;
}

function gameStateAddRoad(state) {
  let { w, h } = state;
  for (let iter = 0; iter < 1000; ++iter) {
    let pattern = randomRoadPattern();

    let edge = rand.range(4);
    let x = edge === 0 ? 1 : edge === 2 ? w - pattern.w - 1 :
      1 + rand.range(w - pattern.w - 2);
    let y = edge === 1 ? 1 : edge === 3 ? h - pattern.h - 1 :
      1 + rand.range(h - pattern.h - 2);
    let max_iter = max(w, h) / 2;
    for (let ii = 0; ii < max_iter; ++ii) {
      if (patternFits(state, pattern, x, y)) {
        gameStateAddPattern(state, pattern, x, y);
        return;
      }
      x += DX[edge];
      y += DY[edge];
    }
  }
  ui.modalDialog({
    title: 'Error',
    text: 'Could not find any valid road placement',
    buttons: { OK: null },
  });
}

const BOUNCE_ORDER = [0, 1, 3, 2];

function gameStateAddProgress(state) {
  let seen = {}; // index -> road
  let roads = [];
  let { board, w, workers } = state;
  function findRoad(x, y) {
    let ret = [];
    let to_search = [];
    function push(xx, yy) {
      let idx = xx + yy * w;
      if (seen[idx]) {
        return;
      }
      seen[idx] = ret;
      let pair = [xx, yy];
      ret.push(pair);
      to_search.push(pair);
    }
    push(x, y);
    while (to_search.length) {
      let pos = to_search.pop();
      ([x, y] = pos);
      for (let ii = 0; ii < DX.length; ++ii) {
        let x2 = x + DX[ii];
        let y2 = y + DY[ii];
        let cell = board[y2]?.[x2];
        if (!cell) {
          continue;
        }
        if (cell.type === TYPE_ROAD) {
          push(x2, y2);
        }
      }
    }
    return ret;
  }
  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      let idx = xx + yy * w;
      if (seen[idx]) {
        continue;
      }
      if (cell.type === TYPE_ROAD) {
        let road = findRoad(xx, yy);
        roads.push(road);
      }
    }
  }
  for (let ii = 0; ii < workers.length; ++ii) {
    let worker = workers[ii];
    let { x, y } = worker;
    let idx = x + y * w;
    let road = seen[idx];
    road.num_workers = (road.num_workers || 0) + 1;
    road.last_worker = worker;
  }
  let non_full_roads = roads.filter((r) => !(r.num_workers > 1));
  if (non_full_roads.length) {
    // can add a new worker
    let road = non_full_roads[rand.range(non_full_roads.length)];
    let { last_worker } = road;
    let { x, y, dir } = last_worker;
    // want adjacent to this worker, going away from the worker
    for (let ii = 0; ii < DX.length; ++ii) {
      let x2 = x + DX[ii];
      let y2 = y + DY[ii];
      let idx = x2 + y2 * w;
      if (seen[idx]) { // it's a road there
        // Find out what direction the old worker is heading
        for (let jj = 0; jj < BOUNCE_ORDER.length; ++jj) {
          let dd = (dir + BOUNCE_ORDER[jj]) % 4;
          let destx = x + DX[dd];
          let desty = y + DY[dd];
          if (board[desty][destx].type === TYPE_ROAD) {
            if (destx === x2 && desty === y2) {
              // he's moving onto us, move the opposite of his movement
              workers.push({
                x: x2, y: y2, dir: (dd + 2) % 4,
                worker_fade: WORKER_FADE,
              });
            } else {
              // he's moving away from us, move away from him
              workers.push({
                x: x2, y: y2, dir: ii,
                worker_fade: WORKER_FADE,
              });
            }
            break;
          }
        }
        break;
      }
    }
  } else {
    // must add a new road
    gameStateAddRoad(state);
  }
}

function gameToJson(state) {
  let ret = clone(state);
  let { board, workers } = ret;
  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      delete cell.anim;
    }
  }
  for (let ii = 0; ii < workers.length; ++ii) {
    delete workers[ii].anim;
  }
  ret.seed = rand.exportState();
  return ret;
}

function init() {
  sprites.tiles = createSprite({
    name: 'tiles',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE, TILE_SIZE),
  });
  sprites.tiles_centered = createSprite({
    name: 'tiles',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE, TILE_SIZE),
    origin: vec2(0.5, 0.5),
  });
  sprites.tiles_2x = createSprite({
    name: 'tiles',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE * 2, TILE_SIZE * 2),
  });
  sprites.tiles_ui = createSprite({
    name: 'tiles_ui',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE, TILE_SIZE),
  });
  sprites.tiles_ui_centered = createSprite({
    name: 'tiles_ui',
    ws: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    hs: [TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE],
    size: vec2(TILE_SIZE, TILE_SIZE),
    origin: vec2(0.5, 0.5),
  });

  preloadParticleData(particle_data);

  game_state = gameStateCreate('test');
}

// Also draws details not included in base sprite
function getCellFrame(cell, x, y, z) {
  let sprite = TYPE_SIZE[cell.type] === 2 ? sprites.tiles_2x : sprites.tiles;
  let frame = null;
  switch (cell.type) { // eslint-disable-line default-case
    case TYPE_DEBUG_WORKER:
      frame = 5;
      break;
    case TYPE_ROAD:
      frame = 0;
      break;
    case TYPE_DETAIL:
      if (!cell.anim) {
        cell.anim = createSpriteAnimation(ANIMDATA_DETAIL);
        cell.anim.setState('idle');
        cell.anim.update(rand.range(1000));
      }
      frame = cell.anim.getFrame(engine.frame_dt);
      break;
    case TYPE_SOURCE:
      switch (cell.resource) {
        case RESOURCE_WOOD:
          frame = 1;
          break;
        case RESOURCE_BERRY:
          frame = 3;
          break;
        case RESOURCE_METAL:
          frame = 26;
          break;
        default:
          assert(0);
      }
      break;
    case TYPE_SINK:
      frame = 4;
      break;
    case TYPE_CRAFT: {
      frame = 4; // note: in namespace of double-sized tiles
      let { input0, input1, output, rot } = cell;
      rot = rot || 0;
      let resources = [input0, input1, null, output];
      for (let ii = 0; ii < 4; ++ii) {
        let r = resources[(ii + 4 - rot) % 4];
        if (r !== null) {
          sprites.tiles.draw({
            x: x + QUAD_X[ii] * TILE_SIZE,
            y: y + QUAD_Y[ii] * TILE_SIZE,
            z: z + 0.5,
            frame: RESOURCE_FRAMES[r],
            color: color_craft_input,
          });
        }
      }
    } break;
  }
  return { sprite, frame };
}

const ROT_OFFS_X = [0, 0, TILE_SIZE*2, TILE_SIZE*2];
const ROT_OFFS_Y = [0, TILE_SIZE*2, TILE_SIZE*2, 0];
function drawCell(cell, x, y, z, color) {
  z = z || Z.BOARD;
  let { sprite, frame } = getCellFrame(cell, x, y, z);
  if (frame !== null) {
    let rot = cell.rot || 0;
    sprite.draw({
      x: x + ROT_OFFS_X[rot],
      y: y + ROT_OFFS_Y[rot],
      z,
      frame,
      color,
      rot: rot * -PI/2, // rotates counter-clockwise
    });
  }
}

const SHOP = [
  {
    name: 'Tree',
    cell: {
      type: TYPE_SOURCE,
      resource: RESOURCE_WOOD,
    },
  },
  {
    name: 'Berry Bush',
    cell: {
      type: TYPE_SOURCE,
      resource: RESOURCE_BERRY,
    },
  },
  {
    name: 'Metal mine',
    cell: {
      type: TYPE_SOURCE,
      resource: RESOURCE_METAL,
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
      input0: RESOURCE_WOOD,
      input1: RESOURCE_BERRY,
      output: RESOURCE_METAL,
    },
  },

  {
    name: 'Debug',
    cell: {
      type: TYPE_ROAD,
    },
    debug: true,
  },
  {
    name: 'Debug',
    cell: {
      type: TYPE_DEBUG_WORKER,
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

let floaters = [];
function addFloater(x, y, f) {
  floaters.push({
    x, y,
    start: engine.frame_timestamp,
    f,
  });
}

const FLOATER_TIME = 1000;
const FLOATER_YOFFS = 16;
let floater_color = vec4(1,1,1,1);
function updateFloaters() {
  for (let ii = floaters.length - 1; ii >= 0; --ii) {
    let floater = floaters[ii];
    let { x, y, start, f } = floater;
    let p = (engine.frame_timestamp - start) / FLOATER_TIME;
    if (p >= 1) {
      ridx(floaters, ii);
      continue;
    }
    p = easeOut(p, 2);
    floater_color[3] = 1 - p;
    f(x, y - p * FLOATER_YOFFS, floater_color);
  }
}

// Assume x/y are in board camera space
function outputResource(resource, x0, y0, offs) {
  game_state.resources[resource] = (game_state.resources[resource] || 0) + 1;
  addFloater(x0, y0, function (x, y, color) {
    sprites.tiles.draw({
      x, y: y - offs, frame: RESOURCE_FRAMES[resource],
      color,
    });
  });
  if (!game_state.ever_output[resource]) {
    game_state.ever_output[resource] = true;
    gameStateAddProgress(game_state);
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
    let { sprite, frame } = getCellFrame(elem.cell, x + BUTTON_W/2 - TILE_SIZE, y + 3, Z.UI);
    let scale = TYPE_SIZE[elem.cell.type] || 1;
    let button_h = BUTTON_H + (scale - 1) * 16;
    if (ui.button({
      x, y, img: sprite, frame,
      h: button_h,
      w: BUTTON_W,
      colors: elem.debug ? colors_debug : undefined,
    })) {
      let same = game_state.cursor && game_state.cursor.cell.type === elem.cell.type &&
        game_state.cursor.cell.resource === elem.cell.resource;
      refundCursor();
      if (!same) {
        game_state.cursor = clone(elem);
      }
    }
    y += button_h + PAD;
  }


  if (engine.DEBUG) {
    if (ui.buttonText({ x, y: y0 + h - ui.button_height * 2 - PAD, w: w/3, text: '+Prog', colors: colors_debug })) {
      gameStateAddProgress(game_state);
    }
    if (ui.buttonText({ x, y: y0 + h - ui.button_height, w: w/3, text: 'New', colors: colors_debug })) {
      game_state = gameStateCreate(String(Math.random()));
    }
    if (ui.buttonText({ x: x + w/3, y: y0 + h - ui.button_height, w: w/3, text: 'Save', colors: colors_debug })) {
      local_storage.setJSON('state', gameToJson(game_state));
    }
  }
  if (auto_load ||
    engine.DEBUG &&
    ui.buttonText({ x: x + w*2/3, y: y0 + h - ui.button_height, w: w/3, text: 'Load', colors: colors_debug })
  ) {
    auto_load = false;
    let state = local_storage.getJSON('state');
    if (state && state.ver === GAME_STATE_VER) {
      game_state = state;
      if (game_state.seed) {
        rand.importState(game_state.seed);
      }
    }
  }
}

function typeAt(x, y) {
  let cell = game_state.board[y]?.[x];
  return cell && cell.type || TYPE_EMPTY;
}

function resourceMatches(cell, key, resource) {
  if (!cell || cell.type !== TYPE_CRAFT) {
    return false;
  }
  if (cell[key] === resource) {
    return true;
  }
  return false;
}

function craftingInputAt(x, y, resource) {
  let { board } = game_state;
  let cell = board[y][x];
  if (resourceMatches(cell, 'input0', resource) && cell.rot === 0) {
    return true;
  }
  if (resourceMatches(cell, 'input1', resource) && cell.rot === 3) {
    return true;
  }
  cell = board[y][x-1];
  if (resourceMatches(cell, 'input0', resource) && cell.rot === 3) {
    return true;
  }
  if (resourceMatches(cell, 'input1', resource) && cell.rot === 2) {
    return true;
  }
  cell = board[y-1]?.[x-1];
  if (resourceMatches(cell, 'input0', resource) && cell.rot === 2) {
    return true;
  }
  if (resourceMatches(cell, 'input1', resource) && cell.rot === 1) {
    return true;
  }
  cell = board[y-1]?.[x];
  if (resourceMatches(cell, 'input0', resource) && cell.rot === 1) {
    return true;
  }
  if (resourceMatches(cell, 'input1', resource) && cell.rot === 0) {
    return true;
  }
  return false;
}

function isCrafter(cell, rot) {
  if (!cell || cell.type !== TYPE_CRAFT) {
    return false;
  }
  return cell.rot === rot;
}

function craftingOutputAt(x, y) {
  let { board } = game_state;
  let cell = board[y][x];
  let resource = cell.resource;
  if (!resource) {
    return 0;
  }
  if (isCrafter(cell, 1)) {
    return resource;
  }
  cell = board[y][x-1];
  if (isCrafter(cell, 0)) {
    return resource;
  }
  cell = board[y-1]?.[x-1];
  if (isCrafter(cell, 3)) {
    return resource;
  }
  cell = board[y-1]?.[x];
  if (isCrafter(cell, 2)) {
    return resource;
  }
  return 0;
}

function canPlace(cell, x, y) {
  let size = TYPE_SIZE[cell.type] || 1;
  let { board } = game_state;
  if (cell.type === TYPE_DEBUG_WORKER) {
    return board[y][x].type === TYPE_ROAD;
  }
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

function clearCell(x, y, just_sell) {
  let { board } = game_state;
  let cell = board[y][x];
  if (cell.resource && cell.type !== TYPE_SOURCE) {
    // outputResource(cell.resource, x * TILE_SIZE, y * TILE_SIZE, CARRY_OFFSET_SOURCE_SINK);
    delete cell.resource;
  }
  let size = TYPE_SIZE[cell.type] || 1;
  for (let xx = 0; xx < size; ++xx) {
    for (let yy = 0; yy < size; ++yy) {
      if (xx || yy) {
        clearCell(x + xx, y + yy, just_sell);
      }
    }
  }
  if (just_sell) {
    return;
  }
  for (let key in cell) {
    delete cell[key];
  }
  cell.type = TYPE_EMPTY;
}

let fade_color = vec4(1,1,1,1);
function drawBoard(x0, y0, w, h) {
  let dt = engine.frame_dt;
  ui.drawRect2({ x: x0, y: y0, w, h, color: pico8.colors[11], z: Z.BACKGROUND });

  camera2d.push();
  let cammap = camera2d.calcMap([], [x0, y0, x0 + w, y0 + h], [0,0,w,h]);
  camera2d.set(cammap[0], cammap[1], cammap[2], cammap[3]);
  // now working in [0,0]...[w,h] space

  let { board, workers } = game_state;
  let tick_progress = 1 - game_state.tick_countdown / TICK_TIME;
  let a = 1;
  let ainout;
  let aout;
  if (tick_progress < 0.5) {
    a = tick_progress * 2;
    ainout = easeInOut(a, 2);
    aout = easeOut(a, 2);
  }

  function drawCarried(cell_or_worker, x, y, source_offset, target_offset) {
    let { resource } = cell_or_worker;
    if (!resource) {
      return;
    }
    let cell_param = { x, y, w: TILE_SIZE, h: TILE_SIZE };
    if (input.click(cell_param)) {
      // outputResource(resource, x, y, target_offset);
      delete cell_or_worker.resource;
      return;
    }
    if (input.mouseOver(cell_param)) {
      sprites.tiles_ui.draw({
        x, y: y - target_offset,
        z: Z.UI,
        frame: 0,
      });
    }
    let { resource_from } = cell_or_worker;
    let offs = target_offset;
    if (resource_from !== undefined && a < 1) {
      x += lerp(aout, DX[resource_from] * TILE_SIZE, 0);
      y += lerp(aout, DY[resource_from] * TILE_SIZE, 0);
      offs = lerp(aout, source_offset, target_offset);
    }
    sprites.tiles.draw({
      x, y: y - offs, z: Z.WORKERS + 1,
      frame: RESOURCE_FRAMES[resource],
    });
  }

  // draw tiles, check sell resources, check sell structures
  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      let x = xx * TILE_SIZE;
      let y = yy * TILE_SIZE;
      fade_color[3] = 1;
      if (cell.road_fade) {
        if (dt >= cell.road_fade) {
          delete cell.road_fade;
        } else {
          cell.road_fade -= dt;
          let alpha = easeInOut(clamp(1 - cell.road_fade / ROAD_ADD_FADE_TIME, 0, 1), 2);
          fade_color[3] = alpha;
        }
      }
      drawCell(cell, x, y, Z.BOARD, fade_color);
      let size = TYPE_SIZE[cell.type] || 1;
      let click_param = {
        x, y, w: TILE_SIZE * size, h: TILE_SIZE * size,
      };
      if (cell.type !== TYPE_SOURCE) {
        drawCarried(cell, x, y, CARRY_OFFSET_WORKER, CARRY_OFFSET_SOURCE_SINK);
      }
      if (game_state.cursor && canPlace(game_state.cursor.cell, xx, yy) && input.click(click_param)) {
        if (game_state.cursor.cell.type === TYPE_DEBUG_WORKER) {
          game_state.workers.push({
            x: xx, y: yy,
            dir: rand.range(4),
            worker_fade: WORKER_FADE,
          });
        } else {
          clearCell(xx, yy);
          for (let key in game_state.cursor.cell) {
            cell[key] = game_state.cursor.cell[key];
          }
          cell.rot = cell.rot || 0;
        }
        if (!input.keyDown(KEYS.SHIFT)) {
          game_state.cursor = null;
        }
      } else if (TYPE_PICKUPABLE[cell.type] && input.click({ ...click_param, button: 2 })) {
        refundCursor();
        game_state.cursor = {
          cell: clone(cell),
        };
        if (game_state.cursor.cell.type !== TYPE_SOURCE) {
          delete game_state.cursor.cell.resource;
        }
        delete game_state.cursor.cell.resource_from;
        clearCell(xx, yy);
        cell.type = TYPE_EMPTY;
      }
    }
  }

  // Check rotate after checking selling resources
  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      if (TYPE_ROTATABLE[cell.type]) {
        let x = xx * TILE_SIZE;
        let y = yy * TILE_SIZE;
        let size = TYPE_SIZE[cell.type] || 1;
        if (input.click({
          x, y, w: TILE_SIZE * size, h: TILE_SIZE * size,
          button: 0, // left button only, right will sell structure
        })) {
          cell.rot = (cell.rot + 1) % 4;
          // sell all resources
          clearCell(xx, yy, true);
          // // rotate resources too, if any
          // let t = board[yy][xx].resource;
          // board[yy][xx].resource = board[yy][xx+1].resource;
          // board[yy][xx+1].resource = board[yy+1][xx+1].resource;
          // board[yy+1][xx+1].resource = board[yy+1][xx].resource;
          // board[yy+1][xx].resource = t;
        }
      }
    }
  }

  // draw workers
  for (let ii = 0; ii < workers.length; ++ii) {
    let worker = workers[ii];
    if (worker.worker_fade) {
      if (dt >= worker.worker_fade) {
        delete worker.worker_fade;
      } else {
        worker.worker_fade -= dt;
      }
    }
    let { x, y, lastx, lasty, worker_fade } = worker;
    if (lastx !== undefined && a < 1) {
      x = lerp(ainout, lastx, x);
      y = lerp(ainout, lasty, y) + sin(ainout * PI) * -0.5;
    }
    x *= TILE_SIZE;
    y *= TILE_SIZE;
    if (!worker.anim) {
      worker.anim = createSpriteAnimation(ANIMDATA_WORKER);
      worker.anim.setState('idle');
    }
    fade_color[3] = 1;
    let scale = 1;
    if (worker_fade) {
      let alpha = 1 - worker_fade / WORKER_FADE;
      fade_color[3] = easeInOut(alpha, 2);
      scale = 1 + (1 - easeOut(alpha, 3)) * 4;
    }
    sprites.tiles_centered.draw({
      x: x + TILE_SIZE/2, y: y + TILE_SIZE/2, z: Z.WORKERS,
      w: scale, h: scale,
      frame: worker.anim.getFrame(dt),
      color: fade_color,
    });
    drawCarried(worker, x, y, CARRY_OFFSET_SOURCE_SINK, CARRY_OFFSET_WORKER);
    let click_param = {
      x, y, w: TILE_SIZE, h: TILE_SIZE,
    };
    if (!worker.stunned && input.click(click_param)) {
      worker.stunned = 2;
    }
    if (worker.stunned) {
      sprites.tiles_ui_centered.draw({
        x: x + TILE_SIZE/2, y: y + TILE_SIZE/2, z: Z.WORKERS + 5,
        frame: 2,
        rot: engine.frame_timestamp * 0.005,
      });
    }
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
      }
      // No: only on right click currently
      // else if (TYPE_PICKUPABLE[cell.type]) {
      //   sprites.tiles_ui.draw({
      //     x: x * TILE_SIZE,
      //     y: y * TILE_SIZE,
      //     z: Z.UI,
      //     frame: 0,
      //   });
      // }
    }
  }

  updateFloaters();

  particles.tick(dt);

  camera2d.pop();

  if (game_state.cursor && !drew_cursor) {
    let mouse_pos = input.mousePos();
    drawCell(game_state.cursor.cell, mouse_pos[0] - TILE_SIZE/2, mouse_pos[1] - TILE_SIZE/2, Z.UI + 10, color_ghost);
  }

  if (game_state.cursor) {
    let cell = game_state.cursor.cell;
    if (TYPE_ROTATABLE[cell.type]) {
      let wheel = input.mouseWheel();
      if (wheel < 0) {
        cell.rot = ((cell.rot || 0) + 1) % 4;
      } else if (wheel > 0) {
        cell.rot = ((cell.rot || 0) + 3) % 4;
      }
    }
  }
}

function getQuadCell(x, y, quad) {
  x += QUAD_X[quad % 4];
  y += QUAD_Y[quad % 4];
  return game_state.board[y][x];
}

function tickState() {
  let { board, workers } = game_state;

  for (let yy = 0; yy < board.length; ++yy) {
    let row = board[yy];
    for (let xx = 0; xx < row.length; ++xx) {
      let cell = row[xx];
      delete cell.resource_from;
      if (cell.type === TYPE_SINK) {
        if (cell.resource) {
          outputResource(cell.resource, xx * TILE_SIZE, yy * TILE_SIZE, CARRY_OFFSET_SOURCE_SINK);
          delete cell.resource;
        }
      }
      if (cell.type === TYPE_CRAFT) {
        let output = getQuadCell(xx, yy, 3 + cell.rot);
        let input0 = getQuadCell(xx, yy, 0 + cell.rot);
        let input1 = getQuadCell(xx, yy, 1 + cell.rot);
        if (!output.resource && input0.resource && input1.resource) {
          // do it
          output.resource = cell.output;
          output.resource_from =
          delete input0.resource;
          delete input1.resource;
          particles.createSystem(particle_data.defs.explosion, [(xx + 1)*TILE_SIZE, (yy + 1)*TILE_SIZE, Z.PARTICLES]);
        }
      }
    }
  }

  for (let ii = 0; ii < workers.length; ++ii) {
    let worker = workers[ii];
    let { x, y, dir } = worker;
    delete worker.lastx;
    delete worker.resource_from;
    let did_anything = false;
    if (worker.stunned) {
      --worker.stunned;
      continue;
    }
    if (!worker.resource) {
      // check for pickup
      for (let jj = 0; !did_anything && jj < DX.length; ++jj) {
        let nx = x + DX[jj];
        let ny = y + DY[jj];
        if (typeAt(nx, ny) === TYPE_SOURCE) {
          worker.resource = board[ny][nx].resource;
          worker.resource_from = jj;
          did_anything = true;
        } else if (craftingOutputAt(nx, ny)) {
          worker.resource = craftingOutputAt(nx, ny);
          delete board[ny][nx].resource;
          worker.resource_from = jj;
          did_anything = true;
        }
      }
    }
    if (worker.resource) {
      // check for drop off
      for (let jj = 0; !did_anything && jj < DX.length; ++jj) {
        let nx = x + DX[jj];
        let ny = y + DY[jj];
        if (typeAt(nx, ny) === TYPE_SINK) {
          let target_cell = board[ny][nx];
          if (!target_cell.resource) {
            target_cell.resource = worker.resource;
            delete worker.resource;
            target_cell.resource_from = (jj + 2) % 4;
            did_anything = true;
            break;
          }
        }
        if (craftingInputAt(nx, ny, worker.resource)) {
          let target_cell = board[ny][nx];
          if (!target_cell.resource) {
            target_cell.resource = worker.resource;
            delete worker.resource;
            target_cell.resource_from = (jj + 2) % 4;
            did_anything = true;
            break;
          }
        }
      }
    }
    for (let jj = 0; jj < BOUNCE_ORDER.length; ++jj) {
      let dd = (dir + BOUNCE_ORDER[jj]) % 4;
      let destx = x + DX[dd];
      let desty = y + DY[dd];
      if (typeAt(destx, desty) === TYPE_ROAD) {
        worker.lastx = x;
        worker.lasty = y;
        x = worker.x = destx;
        y = worker.y = desty;
        worker.dir = dd;
        break;
      }
    }
  }
}

function statePlay(dt) {

  if (input.keyDown(KEYS.SHIFT)) {
    dt *= 5;
  }
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

  particles = engine.glov_particles;
  init();

  engine.setState(statePlay);
}
