// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const { floor, random } = Math;

function GlovSpriteAnimation(params) {
  this.frame = 0;
  this.time = 0;
  this.frame_time = 0;
  this.state = null;
  this.anim = null;
  this.anim_idx = 0;

  if (params instanceof GlovSpriteAnimation) {
    this.data = params.data; // already initialized
    this.setState(params.state);
  } else {
    this.data = params;
    for (let key in this.data) {
      let anim = this.data[key];
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
      if (anim.loop === undefined) {
        anim.loop = true;
      }
    }
  }
}

export function create(params) {
  return new GlovSpriteAnimation(params);
}
exports.createSpriteAnimation = create;

GlovSpriteAnimation.prototype.clone = function () {
  return new GlovSpriteAnimation(this);
};

GlovSpriteAnimation.prototype.setFrameIndex = function (anim_idx) {
  this.anim_idx = anim_idx;
  this.frame = this.anim.frames[anim_idx];
  this.frame_time = this.anim.times[anim_idx];
  if (this.anim.times_random) {
    this.frame_time += floor(random() * this.anim.times_random[anim_idx]);
  }
};

GlovSpriteAnimation.prototype.setState = function (state, force) {
  if (state === this.state && !force) {
    return this;
  }
  if (!this.data[state]) {
    console.error(`Tried to set anim state ${state} which does not exist`);
    return this;
  }
  this.state = state;
  this.anim = this.data[state];
  if (this.anim.init_time) {
    this.time = floor(random() * this.anim.init_time);
  } else {
    this.time = 0;
  }
  this.setFrameIndex(0);
  return this;
};

GlovSpriteAnimation.prototype.progress = function () {
  if (!this.anim) {
    return 1;
  }
  let time = this.time;
  for (let ii = 0; ii < this.anim_idx; ++ii) {
    time += this.anim.times[ii];
  }
  return time / this.anim.total_time;
};

GlovSpriteAnimation.prototype.update = function (dt) {
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
};

GlovSpriteAnimation.prototype.getFrame = function (dt) {
  if (dt !== undefined) {
    this.update(dt);
  }
  return this.frame;
};
