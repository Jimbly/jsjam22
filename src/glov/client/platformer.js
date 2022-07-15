// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-bitwise:off */

const { vec2, v2copy, vec4, v4mulAdd } = require('glov/common/vmath.js');
const glov_input = require('./input.js');
const glov_ui = require('./ui.js');

const JUMP_THRESHOLD = 0.5;
const JUMP_TIME = 0.125;
const CLIMB_UP_SPEED = 3;
const CLIMB_UP_SPEED_FAST = 4;
const PLATFORM_HEIGHT = 0.5;
const HOLD_DOWN_TO_DROP_TIME = 0.100;
const RUN_SPEED = 6;
const JUMP_SPEED = 9.2;
const CLIMB_SPEED_SCALE = 0.25;
const GRAVITY = 9.8*2.5;
const CLIMB_DOWN_SPEED = 4;
const HORIZ_ACCEL = 60;
const HORIZ_DECEL = 30;
const DEAD_ACCEL = 2;
const RUN_LOOP_SCALE = 0.35;
const RUN_LOOP_REST_SPEED = 1;
const BOTTOM = 1;
const TOP = 2;
const LEFT = 4;
const RIGHT = 8;
const CHAR_H = 1.8;
const CHAR_W_2 = 0.45;
const epsilon = 0.001;

const MASK_HORIZ = LEFT | RIGHT;
const MASK_VERT = TOP | BOTTOM;

function collide(pos, height, rect, mask) {
  let ret = 0;
  let x0 = pos[0] - CHAR_W_2;
  let x1 = pos[0] + CHAR_W_2;
  let y0 = pos[1] - CHAR_H * height;
  let y1 = pos[1];
  if ((mask & TOP) && x1 > rect[0] && x0 < rect[2]) {
    if (y0 > rect[1] && y0 < rect[3]) {
      ret |= TOP; // of character
    }
  }
  if ((mask & BOTTOM) && x1 > rect[0] && x0 < rect[2]) {
    if (y1 > rect[1] && y1 < rect[3]) {
      ret |= BOTTOM;
    }
  }
  if ((mask & MASK_HORIZ) && y1 > rect[1] && y0 < rect[3]) {
    if (x0 > rect[0] && x0 < rect[2]) {
      ret |= LEFT;
    }
    if (x1 > rect[0] && x1 < rect[2]) {
      ret |= RIGHT;
    }
  }
  return ret;
}

function playSound() {
  // Not yet implemented
}


class PlatCharacter {
  constructor(pos) {
    this.pos = v2copy(vec2(), pos);
    this.v = [0,0];
    this.dead = false;
    this.on_ground = true;
    this.climbing = false;
    this.jumping = 0;
    this.jumping_released = true;
    this.runloop = 0.5;
    this.facing = 1;
  }

  setPos(pos) {
    this.pos[0] = pos[0];
    this.pos[1] = pos[1];
  }
}

class Platformer {
  constructor(def) {
    this.solids = [];
    this.platforms = [];
    this.characters = [];

    if (def && def.solids) {
      for (let ii = 0; ii < def.solids.length; ++ii) {
        this.addSolid(def.solids[ii]);
      }
    }
    if (def && def.platforms) {
      for (let ii = 0; ii < def.platforms.length; ++ii) {
        this.addPlatform(def.platforms[ii]);
      }
    }
  }

  addSolid(solid) { // [x, y, w, h]
    this.solids.push([solid[0], solid[1], solid[0] + solid[2], solid[1] + solid[3]]);
  }
  addPlatform(platform) { // [x, y, w]
    if (!platform[3]) {
      platform = platform.slice(0);
      // height mostly irrelevant, as long as you can't move that far in one tick; but used for
      // keeping consistent speed going up/down ladders
      platform[3] = PLATFORM_HEIGHT;
    }
    this.platforms.push([platform[0], platform[1], platform[0] + platform[2], platform[1] + platform[3]]);
  }

  addCharacter(pos) { // [x, y]
    let char = new PlatCharacter(pos);
    this.characters.push(char);
    return char;
  }

  clearCharacters() {
    this.characters = [];
  }

  drawDebug(pos, scale) {
    let p = vec4();
    scale = vec4(scale[0], scale[1], scale[0], scale[1]);
    pos = vec4(pos[0], pos[1], pos[0], pos[1]);
    [this.solids, this.platforms].forEach(function (arr, idx) {
      for (let ii = 0; ii < arr.length; ++ii) {
        let s = arr[ii];
        v4mulAdd(p, s, scale, pos);
        glov_ui.drawRect(p[0], p[1], p[2], p[3], Z.DEBUG, idx ? [0,1,1,0.5] : [1,0,1,0.5]);
        if (glov_input.mouseOver({
          x: p[0], y: p[1], w: p[2] - p[0], h: p[3] - p[1],
        })) {
          glov_ui.font.drawSizedAligned(null, p[0], p[1], Z.UI,
            12, 0, 0, 0, `idx=${ii} def=${s[0]},${s[1]},${s[2]-s[0]},${s[3]-s[1]}`);
        }
      }
    });
  }

  // eslint-disable-next-line complexity
  doCharacterMotion(character, dt, dx, dy) {
    if (dt > 30) {
      // timeslice
      while (dt) {
        let t = Math.min(dt, 16);
        this.doCharacterMotion(character, t, dx, dy);
        dt -= t;
      }
      return;
    }

    dt *= 0.001; // seconds

    let movement_scale = 1;
    let jump_scale = 1;

    let jump = dy < -JUMP_THRESHOLD;
    let up = dy < 0;
    let down = dy > JUMP_THRESHOLD;

    if (down) {
      character.time_holding_down += dt;
    } else {
      character.time_holding_down = 0;
    }
    if (!jump || character.on_ground) {
      character.was_jumping = false;
    }

    let on_ladder = false;
    let feet_in_ladder = false;
    // should we climb?  Is there a platform overlapping us
    for (let ii = 0; ii < this.platforms.length; ++ii) {
      let s = this.platforms[ii];
      let c = collide(character.pos, 0.67, s, MASK_HORIZ | BOTTOM);
      if (c & MASK_HORIZ) {
        on_ladder = true;
      }
      if (c & BOTTOM) {
        feet_in_ladder = true;
      }
    }

    let was_on_ground = character.on_ground;
    if (!was_on_ground) {
      movement_scale = jump_scale;
    }
    let desired_horiz_vel = dx * RUN_SPEED * (character.climbing ? CLIMB_SPEED_SCALE : 1);
    let accel = dt * (character.dead ? DEAD_ACCEL : dx ? HORIZ_ACCEL : HORIZ_DECEL);
    let delta = desired_horiz_vel - character.v[0];
    if (Math.abs(delta) <= accel) {
      character.v[0] = desired_horiz_vel;
    } else {
      character.v[0] += ((delta < 0) ? -1 : 1) * accel;
    }
    if (!jump) {
      character.jumping_released = true;
    }
    if (jump && was_on_ground && character.jumping_released && !on_ladder && !character.climbing) {
      // jump!
      character.v[1] = ((dy > 0) ? 1 : -1) * JUMP_SPEED * jump_scale;
      character.jumping = JUMP_TIME;
      character.jumping_released = false;
      playSound('jump');
    } else if (character.jumping && jump) {
      // mid-jump and still holding "up"
      if (dt >= character.jumping) {
        // out of time, stop
        let leftover = dt - character.jumping;
        character.v[1] += GRAVITY * leftover;
        character.jumping = 0;
        character.was_jumping = true;
      } else {
        character.jumping -= dt;
        // velocity stays unchanged (jumping)
      }
    } else if (up && on_ladder && !character.was_jumping) {
      // start or continue climbing
      character.v[1] = (feet_in_ladder ? CLIMB_UP_SPEED_FAST : CLIMB_UP_SPEED) * dy;
      character.climbing = true;
      character.jumping_released = false;
    } else if (down && feet_in_ladder) {
      character.jumping = 0;
      character.climbing = false;
      character.v[1] = Math.min(character.v[1] + GRAVITY * dt, CLIMB_DOWN_SPEED);
    } else {
      // Not holding "up" in any meaningful way, cancel outstanding jumps
      character.jumping = 0;
      character.climbing = false;
      character.v[1] += GRAVITY * dt;
    }
    let do_platforms = character.v[1] >= 0 && character.time_holding_down < HOLD_DOWN_TO_DROP_TIME;
    let horiz_movement = character.v[0] * dt;

    // Update runloop and facing
    let new_facing = (dx > 0) ? 1 : (dx < 0) ? -1 : character.facing;
    if (character.facing !== new_facing) {
      character.facing = new_facing;
      //character.runloop = 0;
    }
    if (was_on_ground && !character.dead) {
      let last_runloop = character.runloop;
      character.runloop += character.facing * horiz_movement * RUN_LOOP_SCALE * movement_scale;
      while (character.runloop < 0) {
        character.runloop += 1;
      }
      while (character.runloop >= 1) {
        character.runloop -= 1;
      }
      if (Math.abs(character.v[0]) < 0.1) {
        if (character.runloop < 0.25) {
          character.runloop = Math.max(0, character.runloop - RUN_LOOP_REST_SPEED * dt);
        } else if (character.runloop < 0.5) {
          character.runloop = Math.min(0.5, character.runloop + RUN_LOOP_REST_SPEED * dt);
        } else if (character.runloop < 0.75) {
          character.runloop = Math.max(0.5, character.runloop - RUN_LOOP_REST_SPEED * dt);
        } else {
          character.runloop = Math.min(1, character.runloop + RUN_LOOP_REST_SPEED * dt);
        }
      }
      if (last_runloop < 0.25 && character.runloop >= 0.25 && character.runloop < 0.5) {
        playSound('footstep');
      } else if (last_runloop > 0.5 && last_runloop < 0.75 && character.runloop >= 0.75) {
        playSound('footstep');
      }
    }

    let last_pos = [...character.pos];
    // horizontal
    character.pos[0] += horiz_movement * movement_scale;
    // check vs solids
    character.on_ground = (Math.abs(character.v[1]) < 0.001) ? was_on_ground : false;
    for (let ii = 0; ii < this.solids.length; ++ii) {
      let s = this.solids[ii];
      let c = collide(character.pos, 1, s, MASK_HORIZ);
      if (c & LEFT) {
        character.v[0] = 0;
        character.pos[0] = s[2] + CHAR_W_2 + epsilon;
      } else if (c & RIGHT) {
        character.v[0] = 0;
        character.pos[0] = s[0] - CHAR_W_2 - epsilon;
      }
    }
    // vertical
    character.pos[1] += character.v[1] * dt;
    for (let ii = 0; ii < this.solids.length; ++ii) {
      let s = this.solids[ii];
      let c = collide(character.pos, 1, s, MASK_VERT);
      if (c & TOP) {
        character.v[1] = 0;
        character.pos[1] = s[3] + CHAR_H + epsilon;
        character.jumping = 0;
        character.climbing = false;
      } else if (c & BOTTOM) {
        character.v[1] = 0;
        character.pos[1] = s[1];
      }
      if (c & BOTTOM) {
        character.on_ground = true;
      }
    }
    if (do_platforms) { // not holding down
      for (let ii = 0; ii < this.platforms.length; ++ii) {
        let s = this.platforms[ii];
        let c = collide(character.pos, 1, s, BOTTOM);
        if (c & BOTTOM) {
          if (!collide(last_pos, 1, s, BOTTOM)) {
            character.v[1] = 0;
            character.pos[1] = s[1];
            character.on_ground = true;
          }
        }
      }
    }
    if (character.on_ground && !was_on_ground) {
      playSound(character.dead ? 'dead_land' :'jump_land');
    }
  }
}


export function create(def) {
  return new Platformer(def);
}
