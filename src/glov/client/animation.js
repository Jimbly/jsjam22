// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/*
  example usage:

  // trigger
  let alpha = 0;
  let anim = createAnimationSequencer();
  let t = anim.add(0, 300, (progress) => alpha = progress);
  t = anim.add(t + 1000, 300, (progress) => alpha = 1 - progress);

  // tick
  if (anim) {
    if (!anim.update(dt))
      anim = null;
    else
      glov_input.eatAllInput();
    drawSomething(alpha);
  }
*/

// eslint-disable-next-line no-use-before-define
exports.createAnimationSequencer = create;

class GlovAnimationSequencer {
  constructor() {
    this.time = 0;
    this.fns = [];
  }

  // Calls fn(progress) with progress >0 and <= 1; guaranteed call with === 1
  add(start, duration, fn) {
    let end = start + duration;
    this.fns.push({
      done: false,
      fn,
      start,
      end,
      duration,
    });
    return end;
  }

  update(dt) {
    this.time += dt;
    let any_left = false;
    for (let ii = 0; ii < this.fns.length; ++ii) {
      let e = this.fns[ii];
      if (e.start < this.time && this.time < e.end) {
        any_left = true;
        e.fn((this.time - e.start) / e.duration);
      } else if (this.time >= e.end && !e.done) {
        e.fn(1);
        e.done = true;
      } else if (e.start >= this.time) {
        any_left = true;
      }
    }
    return any_left;
  }
}

export function create() {
  return new GlovAnimationSequencer();
}
