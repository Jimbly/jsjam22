// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';

const { floor, random } = Math;

export type SpriteAnimationParamEntry = {
  frames: number | number[];
  times: number | number[];
  times_random?: number | number[];
  init_time?: number; // random offset into animation to initialize to
  random_init_frame?: boolean;
  loop?: boolean; // default true
  transition_to?: string;
};

export type SpriteAnimationParam = Partial<Record<string, SpriteAnimationParamEntry>>;

type SpriteAnimationData = {
  frames: number[];
  times: number[];
  times_random?: number[];
  init_time?: number;
  total_time: number;
  random_init_frame: boolean;
  loop: boolean;
  transition_to?: string;
};

export type SpriteAnimation = SpriteAnimationImpl;
class SpriteAnimationImpl {
  frame = 0;
  time = 0;
  frame_time = 0;
  state: string | null = null;
  anim: SpriteAnimationData | null = null;
  anim_idx = 0;
  data: Partial<Record<string, SpriteAnimationData>>;

  constructor(params: SpriteAnimationParam | SpriteAnimationImpl) {

    if (params instanceof SpriteAnimationImpl) {
      this.data = params.data; // already initialized
      if (params.state) {
        this.setState(params.state);
      }
    } else {
      this.data = params as Partial<Record<string, SpriteAnimationData>>;
      for (let key in this.data) {
        let anim = this.data[key]!;
        if (typeof anim.frames === 'number') {
          anim.frames = [anim.frames];
        }
        if (typeof anim.times === 'number') {
          let arr = new Array(anim.frames.length);
          for (let ii = 0; ii < anim.frames.length; ++ii) {
            arr[ii] = anim.times;
          }
          anim.times = arr;
        }
        if (anim.times_random) {
          if (typeof anim.times_random === 'number') {
            let arr = new Array(anim.frames.length);
            for (let ii = 0; ii < anim.frames.length; ++ii) {
              arr[ii] = anim.times_random;
            }
            anim.times_random = arr;
          }
        }
        anim.total_time = 0;
        for (let ii = 0; ii < anim.times.length; ++ii) {
          anim.total_time += anim.times[ii];
        }
        anim.random_init_frame = anim.random_init_frame || false;
        if (anim.loop === undefined) {
          anim.loop = true;
        }
      }
    }
  }

  clone(): SpriteAnimationImpl {
    return new SpriteAnimationImpl(this);
  }

  setFrameIndex(anim_idx: number): void {
    this.anim_idx = anim_idx;
    assert(this.anim);
    this.frame = this.anim.frames[anim_idx];
    this.frame_time = this.anim.times[anim_idx];
    if (this.anim.times_random) {
      this.frame_time += floor(random() * this.anim.times_random[anim_idx]);
    }
  }

  setState(state: string, force?: boolean): SpriteAnimationImpl {
    if (state === this.state && !force) {
      return this;
    }
    if (!this.data[state]) {
      console.error(`Tried to set anim state ${state} which does not exist`);
      return this;
    }
    this.state = state;
    this.anim = this.data[state]!;
    if (this.anim.init_time) {
      this.time = floor(random() * this.anim.init_time);
    } else {
      this.time = 0;
    }
    let init_frame = 0;
    if (this.anim.random_init_frame) {
      init_frame = floor(random() * this.anim.frames.length);
    }
    this.setFrameIndex(init_frame);
    return this;
  }

  progress(): number {
    if (!this.anim) {
      return 1;
    }
    let time = this.time;
    for (let ii = 0; ii < this.anim_idx; ++ii) {
      time += this.anim.times[ii];
    }
    return time / this.anim.total_time;
  }

  update(dt: number): void {
    if (!this.anim) {
      return;
    }
    this.time += dt;
    if (this.time > this.frame_time) {
      this.time -= this.frame_time;
      this.anim_idx++;
      if (this.anim_idx === this.anim.frames.length) {
        if (this.anim.loop) {
          this.anim_idx %= this.anim.frames.length;
        } else if (this.anim.transition_to) {
          this.setState(this.anim.transition_to);
        } else {
          // keep final frame
          this.anim = null;
          return;
        }
      }
      this.setFrameIndex(this.anim_idx);
      if (this.time >= this.frame_time) {
        this.time = this.frame_time - 1;
      }
    }
  }

  getFrame(dt?: number): number {
    if (dt !== undefined) {
      this.update(dt);
    }
    return this.frame;
  }
}

export function spriteAnimationCreate(
  params: SpriteAnimationParam | SpriteAnimation
): SpriteAnimation {
  return new SpriteAnimationImpl(params);
}
exports.createSpriteAnimation = spriteAnimationCreate;
exports.create = spriteAnimationCreate;
