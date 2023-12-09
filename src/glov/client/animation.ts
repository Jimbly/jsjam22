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

type AnimationFunc = (progress: number) => void;
export type AnimationSequencer = AnimationSequencerImpl;
class AnimationSequencerImpl {
  time = 0;
  fns: {
    done: boolean;
    fn: AnimationFunc;
    start: number;
    end: number;
    duration: number;
  }[];
  constructor() {
    this.fns = [];
  }

  // Calls fn(progress) with progress >0 and <= 1; guaranteed call with === 1
  add(start: number, duration: number, fn: AnimationFunc): number {
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

  update(dt: number): boolean {
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

export function animationSequencerCreate(): AnimationSequencer {
  return new AnimationSequencerImpl();
}

exports.createAnimationSequencer = animationSequencerCreate;
exports.create = animationSequencerCreate;
