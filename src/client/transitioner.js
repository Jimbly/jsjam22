// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { getFrameDt, getFrameIndex, postTick } = require('glov/client/engine.js');
const glov_font = require('glov/client/font.js');
const input = require('glov/client/input.js');
const { max, min } = Math;
const { clamp, easeIn, easeOut, easeInOut, identity } = require('glov/common/util.js');
const { unit_vec, v3copy, vec4 } = require('glov/common/vmath.js');

const MODE_NONE = null;
const MODE_FADE_IN = 'in';
const MODE_FADE_OUT = 'out';

const EASING = {
  in: (v) => easeIn(v, 2),
  out: (v) => easeOut(v, 2),
  inout: (v) => easeInOut(v, 2),
};

function Transitioner(params) {
  this.last_frame_idx = null;
  this.mode = MODE_FADE_IN;
  this.t = 0;
  let tracks = this.tracks = params.tracks;
  let per_mode_data = this.per_mode_data = {};
  ['in', 'out'].forEach((mode) => {
    let mode_data = per_mode_data[mode] = {
      max_t: 0,
    };
    for (let key in tracks) {
      let track = tracks[key];
      let track_mode = track[mode];
      assert(track_mode);
      mode_data.max_t = max(mode_data.max_t, track_mode.end);
      track_mode.dur = track_mode.end - track_mode.start;
      track_mode.easefn = track_mode.easefn || EASING[track_mode.ease] || identity;
    }
  });
  this.p = 0;
  this.interactable_at = params.interactable_at || this.per_mode_data.in.max_t;
  this.out_data = null; // { cb }
}

Transitioner.prototype.startFadeOut = function () {
  assert(this.out_data);
  this.mode = MODE_FADE_OUT;
  this.t = this.per_mode_data.out.max_t;
};

Transitioner.prototype.fadeOutQueued = function () {
  return Boolean(this.out_data);
};

Transitioner.prototype.update = function () {
  let dt = getFrameDt();
  let frame_index = getFrameIndex();
  let reset = frame_index !== this.last_frame_idx + 1;
  this.last_frame_idx = frame_index;
  if (reset) {
    if (this.out_data) {
      this.startFadeOut();
    } else {
      this.mode = MODE_FADE_IN;
      this.t = 0;
    }
  }
  if (this.mode === MODE_FADE_IN) {
    this.t += dt;
    this.p = this.t / this.per_mode_data.in.max_t;
    if (this.p >= 1) {
      this.mode = MODE_NONE;
      this.t = this.per_mode_data.in.max_t;
      this.p = 1;
    }
  }
  if (this.mode === MODE_NONE && this.out_data) {
    this.startFadeOut();
  }
  if (this.mode === MODE_FADE_OUT) {
    assert(this.out_data);
    this.t -= dt;
    this.p = this.t / this.per_mode_data.out.max_t;
    if (this.p <= 0) {
      this.t = 0;
      this.p = 0;
      if (!this.out_data.cb) {
        // just delay, waiting for a cb
      } else {
        postTick({
          fn: () => {
            let cb = this.out_data.cb;
            this.out_data = null;
            this.last_frame_idx = null; // force reset upon next update
            cb();
          },
        });
      }
    }
  }
  if (this.fadeOutQueued()) {
    // fading out, or still fading in before immediate fading out
    input.eatAllInput();
  } else if (this.mode === MODE_FADE_IN && this.t < this.interactable_at) {
    input.eatAllInput();
  }
};

Transitioner.prototype.getTrack = function (track_id) {
  let { mode } = this;
  let track = this.tracks[track_id];
  if (mode === MODE_NONE) {
    return 1;
  }
  let p = (this.t - track[mode].start) / track[mode].dur;
  if (track[mode].extrapolate) {
    p = min(p, 1);
  } else {
    p = clamp(p, 0, 1);
  }
  p = track[mode].easefn(p);
  return p;
};

Transitioner.prototype.getFadeColor = function (track_id, base_color) {
  let alpha = this.getTrack(track_id);
  if (!alpha) {
    return null;
  }
  if (alpha === 1) {
    return base_color || unit_vec;
  }
  let track = this.tracks[track_id];
  let color = track.temp_color;
  if (!color) {
    color = track.temp_color = vec4(1,1,1,1);
  }
  if (base_color) {
    v3copy(color, base_color);
    color[3] = base_color[3] * alpha;
  } else {
    color[3] = alpha;
  }
  return color;
};

// returns null (use default) when not fading, invisible when faded
const color_invis = vec4(1,1,1,0);
Transitioner.prototype.getFadeButtonColor = function (track_id) {
  let alpha = this.getTrack(track_id);
  if (!alpha) {
    return color_invis;
  }
  if (alpha === 1) {
    return null;
  }
  let track = this.tracks[track_id];
  let color = track.temp_color;
  if (!color) {
    color = track.temp_color = vec4(1,1,1,1);
  }
  color[3] = alpha;
  return color;
};

Transitioner.prototype.getFadeFont = function (track_id, style) {
  let alpha = this.getTrack(track_id);
  if (!alpha) {
    return null;
  }
  if (alpha === 1) {
    return style;
  }
  return glov_font.styleAlpha(style, alpha);
};

Transitioner.prototype.out = function (cb) {
  assert(!this.out_data);
  this.out_data = { cb };
};

// Returns a function to be called later, which can be provided what to run after
// the out transition has finished (or will be run immediately if the transition has
// already finished
Transitioner.prototype.out2 = function () {
  assert(!this.out_data);
  this.out_data = { cb: null };
  return (cb) => {
    assert(this.out_data);
    assert(!this.out_data.cb);
    this.out_data.cb = cb;
  };
};

Transitioner.prototype.outbind = function (cb) {
  return this.out.bind(this, cb);
};

export function createTransitioner(params) {
  return new Transitioner(params);
}
