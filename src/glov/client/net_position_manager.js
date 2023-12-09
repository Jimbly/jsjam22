// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
import * as util from 'glov/common/util';
import * as glov_engine from './engine';
import * as net from './net';
import { netDisconnected } from './net';
import { registerPingProvider } from './perf_net';

const { abs, floor, max, min, PI, sqrt } = Math;

const TWO_PI = PI * 2;
const EPSILON = 0.01;

const valid_options = [
  // Numeric parameters
  'dim_pos', 'dim_rot', // dimensions
  'send_time', 'window', 'snap_factor', 'smooth_windows', 'smooth_factor', 'default_pos',
  // Callbacks
  'on_pos_update', 'on_state_update',
];

function NetPositionManager(options) {
  this.on_channel_data = this.onChannelData.bind(this);
  this.on_subscribe = this.onChannelSubscribe.bind(this);
  this.reinit(options);
}
NetPositionManager.prototype.deinit = function () {
  if (this.channel) {
    this.channel.removeListener('channel_data', this.on_channel_data);
    this.channel.removeListener('subscribe', this.on_subscribe);
  }
};

NetPositionManager.prototype.onChannelSubscribe = function (data) {
  // initial connection or reconnect
  this.last_send.sending = false; // ignore send on previous, disconnected link
  this.last_send.time = 0;
  this.client_id = net.client.id;
};

NetPositionManager.prototype.onChannelData = function (data, mod_key, mod_value) {
  if (mod_key) {
    let m = mod_key.match(/^public\.clients\.([^.]+)\.(.+)$/);
    if (m) {
      let client_id = m[1];
      let field = m[2];
      if (field === 'pos') {
        this.otherClientPosChanged(client_id);
      }
      if (this.on_client_change) {
        let pcd = this.per_client_data[client_id];
        if (pcd) {
          this.on_client_change(pcd, field);
        }
      }
    }
    if (!mod_value) {
      m = mod_key.match(/^public\.clients\.([^.]+)$/);
      if (m) {
        // other client disconnected
        delete this.per_client_data[m[1]];
      }
    }
  } else {
    if (data && data.public && data.public.clients) {
      for (const client_id in data.public.clients) {
        const client_data = data.public.clients[client_id];
        if (client_data.pos) {
          this.otherClientPosChanged(client_id);
        }
      }
    }
  }
};

NetPositionManager.prototype.vec = function (fill) {
  let r = new Float64Array(this.n);
  if (fill) {
    for (let ii = 0; ii < this.n; ++ii) {
      r[ii] = fill;
    }
  }
  return r;
};
NetPositionManager.prototype.vcopy = function (dst, src) {
  for (let ii = 0; ii < this.n; ++ii) {
    dst[ii] = src[ii];
  }
  return dst;
};
NetPositionManager.prototype.arr = function (vec) {
  let arr = new Array(this.n);
  for (let ii = 0; ii < this.n; ++ii) {
    arr[ii] = vec[ii];
  }
  return arr;
};
NetPositionManager.prototype.vsame = function (a, b) {
  for (let ii = 0; ii < this.n; ++ii) {
    if (abs(a[ii] - b[ii]) > EPSILON) {
      return false;
    }
  }
  return true;
};
NetPositionManager.prototype.vlength = function (a) {
  let r = 0;
  for (let ii = 0; ii < this.n; ++ii) {
    let d = a[ii];
    r += d * d;
  }
  return sqrt(r);
};
NetPositionManager.prototype.vdist = function (a, b) {
  this.vsub(this.temp_vec, a, b);
  for (let ii = 0; ii < this.dim_rot; ++ii) {
    let jj = this.dim_pos + ii;
    let d = abs(this.temp_vec[jj]);
    if (d > PI) {
      this.temp_vec[jj] = d - floor((d + PI) / TWO_PI) * TWO_PI;
    }
  }
  return this.vlength(this.temp_vec);
};
NetPositionManager.prototype.vsub = function (dst, a, b) {
  for (let ii = 0; ii < this.n; ++ii) {
    dst[ii] = a[ii] - b[ii];
  }
  return dst;
};
NetPositionManager.prototype.vscale = function (dst, a, scalar) {
  for (let ii = 0; ii < this.n; ++ii) {
    dst[ii] = a[ii] * scalar;
  }
};

NetPositionManager.prototype.reinit = function (options) {
  this.deinit();

  options = options || {};
  this.per_client_data = {};
  for (let ii = 0; ii < valid_options.length; ++ii) {
    let field = valid_options[ii];
    if (options[field]) {
      this[field] = options[field];
    }
  }

  this.n = this.dim_pos + this.dim_rot;

  if (!this.default_pos) {
    this.default_pos = this.vec();
  }
  if (!this.temp_vec) {
    this.temp_vec = this.vec();
  }
  if (!this.temp_delta) {
    this.temp_delta = this.vec();
  }

  this.channel = options.channel; // Never inheriting this over reinit()
  this.last_send = {
    pos: this.vec(-1),
    sending: false,
    send_time: 0,
  };
  this.sends_to_ignore = 0;
  this.ever_received_character = false;

  this.on_client_change = options.on_client_change;

  if (this.channel) {
    this.channel.on('channel_data', this.on_channel_data);
    this.channel.onSubscribe(this.on_subscribe);
  }
};

// cb(client_id, pos[2])
NetPositionManager.prototype.onPositionUpdate = function (cb) {
  this.on_pos_update = cb;
};

// cb(client_id, new_state)
NetPositionManager.prototype.onStateUpdate = function (cb) {
  this.on_state_update = cb;
};

function syncPosWithCaller(npm, on_pos_set_cb) {
  npm.vcopy(npm.last_send.pos, npm.default_pos);
  let new_pos = on_pos_set_cb(npm.last_send.pos);
  if (new_pos) {
    npm.vcopy(npm.last_send.pos, new_pos);
  }
}

NetPositionManager.prototype.checkNet = function (on_pos_set_cb) {
  if (netDisconnected() || !this.channel || !this.channel.data.public) {
    // Not yet in room, do nothing
    return true;
  }
  if (net.client.id !== this.client_id) {
    // Haven't yet subscribed to this room under the new client_id
    return true;
  }

  const me = this.channel.getChannelData(`public.clients.${this.client_id}`, {});
  if (!me.pos || !me.pos.cur || typeof me.pos.cur[0] !== 'number') {
    if (this.ever_received_character) {
      // we must be reconnecting, use last replicated position
    } else {
      // fresh connect, use default position, or ask for it from caller
      syncPosWithCaller(this, on_pos_set_cb);
    }
    this.channel.setChannelData(`public.clients.${this.client_id}.pos`, {
      cur: this.arr(this.last_send.pos), // Do not send as Float64Array
    });
    this.ever_received_character = true;
  } else if (!this.ever_received_character) {
    syncPosWithCaller(this, on_pos_set_cb);
    this.ever_received_character = true;
  }
  return false;
};

NetPositionManager.prototype.updateMyPos = function (character_pos, anim_state, force) {
  if (!this.vsame(character_pos, this.last_send.pos) || anim_state !== this.last_send.anim_state) {
    // pos or anim_state changed
    const now = glov_engine.getFrameTimestamp();
    if ((!this.last_send.sending && (!this.last_send.time || now - this.last_send.time > this.send_time)) || force) {
      // do send!
      if (this.last_send.sending) {
        ++this.sends_to_ignore;
      } else {
        this.last_send.sending = true;
      }
      this.last_send.time = now;
      this.last_send.hrtime = glov_engine.hrnow();
      this.last_send.speed = 0;
      if (this.last_send.send_time) {
        const time = now - this.last_send.send_time;
        this.last_send.speed = this.vdist(this.last_send.pos, character_pos) / time;
        if (this.last_send.speed < 0.001) {
          this.last_send.speed = 0;
        }
      }
      this.last_send.send_time = now;
      this.vcopy(this.last_send.pos, character_pos);
      this.last_send.anim_state = anim_state;
      this.channel.setChannelData(
        `public.clients.${this.client_id}.pos`, {
          cur: this.arr(this.last_send.pos), // Do not send as Float64Array
          state: this.last_send.anim_state, speed: this.last_send.speed,
          q: 1,
        }, false, () => {
          if (!this.sends_to_ignore) {
            // could avoid needing this response function (and ack packet) if we
            // instead just watch for the apply_channel_data message containing
            // (approximately) what we sent
            this.last_send.sending = false;
            let end = glov_engine.getFrameTimestamp();
            let hrend = glov_engine.hrnow();
            let round_trip = hrend - this.last_send.hrtime;
            this.ping_time = round_trip;
            this.ping_time_time = end;
            if (round_trip > this.send_time) {
              // hiccup, delay next send
              this.last_send.time = end;
            }
          } else {
            --this.sends_to_ignore;
          }
        }
      );
    }
  }
};

NetPositionManager.prototype.getPing = function () {
  const max_age = 2000;
  if (!this.ping_time_time) {
    return null;
  }
  let age = glov_engine.getFrameTimestamp() - this.ping_time_time;
  if (age > max_age) {
    return null;
  }
  return {
    ping: this.ping_time,
    fade: 1 - age / max_age,
  };
};

NetPositionManager.prototype.getPos = function (client_id) {
  let pcd = this.per_client_data[client_id];
  if (!pcd) {
    return null;
  }
  return pcd.pos;
};

NetPositionManager.prototype.getPCD = function (client_id) {
  return this.per_client_data[client_id];
};

NetPositionManager.prototype.otherClientPosChanged = function (client_id) {
  const client_pos = this.channel.getChannelData(`public.clients.${client_id}.pos`);
  if (!client_pos || !client_pos.cur || typeof client_pos.cur[0] !== 'number') {
    return;
  }
  // client_pos is { cur, state, speed }
  let pcd = this.per_client_data[client_id];
  if (!pcd) {
    pcd = this.per_client_data[client_id] = {};
    pcd.pos = this.vcopy(this.vec(), client_pos.cur);
    pcd.net_speed = 0;
    pcd.net_pos = this.vec();
    pcd.impulse = this.vec();
    pcd.net_state = 'idle_down';
    pcd.anim_state = 'idle_down';
  }
  if (client_pos.state) {
    pcd.net_state = client_pos.state;
  }
  this.vcopy(pcd.net_pos, client_pos.cur);
  pcd.net_speed = client_pos.speed;

  // Keep pcd.pos[rot] within PI of pcd.net_pos, so interpolation always goes the right way
  for (let ii = 0; ii < this.dim_rot; ++ii) {
    let jj = this.dim_pos + ii;
    while (pcd.pos[jj] > pcd.net_pos[jj] + PI) {
      pcd.pos[jj] -= TWO_PI;
    }
    while (pcd.pos[jj] < pcd.net_pos[jj] - PI) {
      pcd.pos[jj] += TWO_PI;
    }
  }

  // This interpolation logic taken from Splody
  // Doesn't do great with physics-based jumps though
  const delta = this.vsub(this.temp_delta, pcd.net_pos, pcd.pos);
  const dist = this.vlength(delta);

  if (dist > 0) {
    const time_to_dest = dist / pcd.net_speed;
    if (time_to_dest < this.send_time + this.window) {
      // Would get there in the expected time, use this speed
      this.vscale(pcd.impulse, delta, pcd.net_speed / dist);
    } else if (time_to_dest < this.send_time + this.window * this.smooth_windows) { // 0.5s
      // We'll could be there in under half a second, try to catch up smoothly
      // Using provided speed is too slow, go faster, though no slower than we were going
      // (in case this is the last of multiple delayed updates and the last update was going a tiny distance slowly)
      const old_speed = this.vlength(pcd.impulse);
      const specified_speed = pcd.net_speed;
      const new_speed = max(specified_speed * this.smooth_factor, old_speed);
      this.vscale(pcd.impulse, delta, new_speed / dist);
    } else {
      // We're way far behind using the provided speed, attempt to get all the way there by the next few
      // theoretical updates, this basically snaps if this is particularly small
      this.vscale(pcd.impulse, delta, 1 / (this.send_time + this.window * this.snap_factor));
    }
  }
};

NetPositionManager.prototype.updateOtherClient = function (client_id, dt) {
  const pcd = this.per_client_data[client_id];
  if (!pcd) {
    // Never got a position sent to us, ignore
    return null;
  }

  // Apply interpolation (logic from Splody)
  let stopped = true;
  for (let ii = 0; ii < this.n; ++ii) {
    if (pcd.impulse[ii]) {
      const delta_old = pcd.net_pos[ii] - pcd.pos[ii];
      const delta_old_sign = util.sign(delta_old);
      pcd.pos[ii] += pcd.impulse[ii] * dt;
      const delta_new = pcd.net_pos[ii] - pcd.pos[ii];
      const delta_new_sign = util.sign(delta_new);
      if (delta_new_sign !== delta_old_sign) {
        // made it or passed it
        pcd.pos[ii] = pcd.net_pos[ii];
        pcd.impulse[ii] = 0;
      } else if (ii < this.dim_pos && pcd.impulse[ii] > 0.01) {
        // If positional (not rotation), we're not stopped
        stopped = false;
      }
    }
  }
  if (this.on_pos_update) {
    this.on_pos_update(client_id, pcd.pos);
  }

  const cur_is_run = pcd.anim_state[0] === 'f' || pcd.anim_state[0] === 'w';
  const new_is_idle = pcd.net_state[0] === 'i';
  if (cur_is_run && new_is_idle && !stopped) {
    // don't apply yet
  } else {
    pcd.anim_state = pcd.net_state;
    if (this.on_state_update) {
      this.on_state_update(client_id, pcd.net_state);
    }
  }
  return pcd;
};

NetPositionManager.prototype.dim_pos = 2; // number of components to be interpolated as-is
NetPositionManager.prototype.dim_rot = 0; // number of components to be interpolated with 2PI wrapping
NetPositionManager.prototype.send_time = 200; // how often to send position updates
NetPositionManager.prototype.window = 200; // maximum expected variation in time between updates; ms
NetPositionManager.prototype.snap_factor = 1.0; // how many windows to snap in when we think we need to snap
NetPositionManager.prototype.smooth_windows = 6.5; // how many windows behind we can be and only accelerate a little
NetPositionManager.prototype.smooth_factor = 1.2; // how much faster to go in the smoothing window


export function create(options) {
  let ret = new NetPositionManager(options);
  registerPingProvider(ret.getPing.bind(ret));
  return ret;
}


function ScalarInterpolator(tick_time) {
  this.tick_time = tick_time * 1.25;
  this.reset();
}

ScalarInterpolator.prototype.reset = function () {
  this.value = undefined;
  this.target_value = undefined;
  this.vel = 0;
};

// Assume any change happened on the server at frequency tick_time
// Updates state.value and also returns it
ScalarInterpolator.prototype.update = function (dt, new_value) {
  if (this.value === undefined) {
    this.value = new_value;
    this.target_value = new_value;
    return;
  }
  // TODO: Could figure expected velocity and use logic like in updateOtherClient
  if (new_value !== this.target_value) {
    // try to get there in tick_time
    this.vel = (new_value - this.value) / this.tick_time;
    this.target_value = new_value;
  }
  if (this.value !== this.target_value) {
    if (this.vel > 0) {
      this.value = min(this.value + this.vel * dt, this.target_value);
    } else {
      this.value = max(this.value + this.vel * dt, this.target_value);
    }
  }
};

ScalarInterpolator.prototype.getValue = function () {
  return this.value;
};

export function createScalarInterpolator(tick_time) {
  return new ScalarInterpolator(tick_time);
}
