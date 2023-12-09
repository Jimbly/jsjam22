
import assert from 'assert';
import * as engine from 'glov/client/engine';
import { getFrameTimestamp } from 'glov/client/engine';
import { EntityID } from 'glov/common/entity_base_common';
import { sign } from 'glov/common/util';
import { ClientEntityManagerInterface } from './entity_manager_client';
import { PingData, registerPingProvider } from './perf_net';

const { abs, max, PI, sqrt } = Math;

const TWO_PI = PI * 2;

type Vector = Float64Array;

interface EntityPositionManagerAnimStateDef {
  stopped?: <T=unknown>(value: T) => boolean;
  equal?: <T=unknown>(a: T, b: T) => boolean;
}

type AnimState = Partial<Record<string, unknown>>;

interface EntityPositionManagerOpts {
  // These are applied directly from incoming options onto the entity position manager itself

  dim_pos?: number; // number of components to be interpolated as-is
  dim_rot?: number; // number of components to be interpolated with 2PI wrapping
  tol_pos?: number; // tolerance for sending positional changes
  tol_rot?: number; // tolerance for sending rotational changes
  send_time?: number; // how often to send position updates
  entless_send_time?: number; // if applicable, if we are entityless, how often to send position updates
  window?: number; // maximum expected variation in time between updates; ms
  snap_factor?: number; // how many windows to snap in when we think we need to snap
  smooth_windows?: number; // how many windows behind we can be and only accelerate a little
  smooth_factor?: number; // how much faster to go in the smoothing window
  anim_state_defs?: Partial<Record<string, EntityPositionManagerAnimStateDef>>;
  error_handler?: (err: string) => void;

  entity_manager: ClientEntityManagerInterface;
}

function defaultErrorHandler(err: string): void {
  if (err !== 'ERR_FAILALL_DISCONNECT') {
    throw err;
  }
}

export class PerEntData {
  pos: Vector; // Current interpolated position
  net_speed: number; // Last network received speed
  net_pos: Vector; // Last network received position
  impulse: Vector; // Calculated impulse to interpolate with
  net_anim_state: AnimState; // Last received app-specific anim states
  anim_state: AnimState; // Current interpolated app-specific anim states

  constructor(ent_pos_manager: EntityPositionManager) {
    this.pos = ent_pos_manager.vec();
    this.net_speed = 1;
    this.net_pos = ent_pos_manager.vec();
    this.impulse = ent_pos_manager.vec();
    this.net_anim_state = {};
    this.anim_state = {};
  }
}

export type EntityPositionManager = EntityPositionManagerImpl;
class EntityPositionManagerImpl implements Required<EntityPositionManagerOpts> {
  per_ent_data!: Partial<Record<EntityID, PerEntData>>;
  entity_manager: ClientEntityManagerInterface;

  dim_pos: number;
  dim_rot: number;
  n: number;
  tol_pos: number;
  tol_rot: number;

  send_time: number;
  entless_send_time: number;
  window: number;
  snap_factor: number;
  smooth_windows: number;
  smooth_factor: number;
  anim_state_defs: Partial<Record<string, EntityPositionManagerAnimStateDef>>;
  error_handler: typeof defaultErrorHandler;
  ping_time: number = 0;
  ping_time_time: number = 0;

  temp_vec: Vector;
  temp_delta: Vector;
  sends_to_ignore!: number;

  last_send!: {
    pos: Vector;
    anim_state: AnimState;
    sending: boolean;
    send_time: number;
    time: number;
    hrtime: number;
  };

  constructor(options: EntityPositionManagerOpts) {
    this.dim_pos = options.dim_pos || 2;
    this.dim_rot = options.dim_rot || 0;
    this.n = this.dim_pos + this.dim_rot;
    this.tol_pos = options.tol_pos || 0.01;
    this.tol_rot = options.tol_rot || 0.1;
    this.send_time = options.send_time || 200;
    this.entless_send_time = options.entless_send_time || 1000;
    this.window = options.window || 200;
    this.snap_factor = options.snap_factor || 1.0;
    this.smooth_windows = options.smooth_windows || 6.5;
    this.smooth_factor = options.smooth_factor || 1.2;
    this.anim_state_defs = options.anim_state_defs || {};
    this.error_handler = options.error_handler || defaultErrorHandler;
    this.entity_manager = options.entity_manager;
    this.entity_manager.on('ent_delete', this.handleEntDelete.bind(this));
    this.entity_manager.on('subscribe', this.handleSubscribe.bind(this));
    this.entity_manager.on('ent_update', this.otherEntityChanged.bind(this));

    this.reinit();

    // After setting this.n
    this.temp_vec = this.vec();
    this.temp_delta = this.vec();
  }

  reinit(): void {
    this.per_ent_data = {};
    this.sends_to_ignore = 0;

    this.last_send = {
      pos: this.vec(-1),
      anim_state: {},
      sending: false,
      send_time: 0,
      time: 0,
      hrtime: 0,
    };
  }

  private handleEntDelete(ent_id: EntityID): void {
    delete this.per_ent_data[ent_id];
  }

  private handleSubscribe(): void {
    // initial connection or reconnect
    this.reinit();
  }

  getPos(ent_id: EntityID): Vector | null {
    let ped = this.per_ent_data[ent_id];
    if (!ped) {
      return null;
    }
    return ped.pos;
  }

  getPED(ent_id: EntityID): PerEntData | undefined {
    return this.per_ent_data[ent_id];
  }

  vec(fill?: number): Vector {
    let r = new Float64Array(this.n);
    if (fill) {
      for (let ii = 0; ii < this.n; ++ii) {
        r[ii] = fill;
      }
    }
    return r;
  }
  vcopy(dst: Vector, src: Readonly<Vector> | Readonly<number[]>): Vector {
    for (let ii = 0; ii < this.n; ++ii) {
      dst[ii] = src[ii];
    }
    return dst;
  }
  arr(vec: Readonly<Vector>): number[] {
    let arr = new Array(this.n);
    for (let ii = 0; ii < this.n; ++ii) {
      arr[ii] = vec[ii];
    }
    return arr;
  }
  arrPos(vec: Readonly<Vector>): number[] {
    let arr = new Array(this.dim_pos);
    for (let ii = 0; ii < this.dim_pos; ++ii) {
      arr[ii] = vec[ii];
    }
    return arr;
  }
  vsame(a: Readonly<Vector>, b: Readonly<Vector>): boolean {
    for (let ii = 0; ii < this.dim_pos; ++ii) {
      if (abs(a[ii] - b[ii]) > this.tol_pos) {
        return false;
      }
    }
    for (let ii = this.dim_pos; ii < this.n; ++ii) {
      if (abs(a[ii] - b[ii]) > this.tol_rot) {
        return false;
      }
    }
    return true;
  }
  vsamePos(a: Readonly<Vector> | Readonly<number[]>, b: Readonly<Vector> | Readonly<number[]>): boolean {
    for (let ii = 0; ii < this.dim_pos; ++ii) {
      if (abs(a[ii] - b[ii]) > this.tol_pos) {
        return false;
      }
    }
    return true;
  }
  vlength(a: Readonly<Vector>): number {
    let r = 0;
    for (let ii = 0; ii < this.n; ++ii) {
      let d = a[ii];
      r += d * d;
    }
    return sqrt(r);
  }
  vdist(a: Readonly<Vector>, b: Readonly<Vector>): number {
    this.vsub(this.temp_vec, a, b);
    for (let ii = 0; ii < this.dim_rot; ++ii) {
      let jj = this.dim_pos + ii;
      let delta = this.temp_vec[jj] % TWO_PI;
      this.temp_vec[jj] = 2 * delta % TWO_PI - delta;
    }
    return this.vlength(this.temp_vec);
  }
  vsub(dst: Vector, a: Readonly<Vector>, b: Readonly<Vector>): Vector {
    for (let ii = 0; ii < this.n; ++ii) {
      dst[ii] = a[ii] - b[ii];
    }
    return dst;
  }
  vscale(dst: Vector, a: Readonly<Vector>, scalar: number): Vector {
    for (let ii = 0; ii < this.n; ++ii) {
      dst[ii] = a[ii] * scalar;
    }
    return dst;
  }

  stateDiff(a: AnimState, b: AnimState): null | Partial<Record<string, true>> {
    let { anim_state_defs } = this;
    let diff: null | Partial<Record<string, true>> = null;
    for (let key in anim_state_defs) {
      let def = anim_state_defs[key]!;
      if (a[key] !== b[key] &&
        (!def.equal || !def.equal(a[key], b[key]))
      ) {
        diff = diff || {};
        diff[key] = true;
      }
    }
    return diff;
  }

  updateMyPos(character_pos: Vector, anim_state: AnimState, force?: boolean): void {
    let entless = this.entity_manager.isEntless();
    if (!entless && !this.entity_manager.hasMyEnt()) {
      // Probably waiting to receive our entity (or, our entity was just deleted, but should already be 'entless')
      return;
    }
    let pos_diff = entless ? !this.vsamePos(character_pos, this.last_send.pos) :
      !this.vsame(character_pos, this.last_send.pos);
    let state_diff = !entless && this.stateDiff(anim_state, this.last_send.anim_state);
    if (pos_diff || state_diff) {
      // pos or anim_state changed
      const now = getFrameTimestamp();
      let send_time = entless ? this.entless_send_time : this.send_time;
      if (!this.last_send.sending && (!this.last_send.time || now - this.last_send.time > send_time) || force) {
        // do send!
        if (this.last_send.sending) {
          ++this.sends_to_ignore;
        } else {
          this.last_send.sending = true;
        }
        this.last_send.time = now;
        this.last_send.hrtime = engine.hrnow();
        let speed = 0;
        if (this.last_send.send_time) {
          const time = now - this.last_send.send_time;
          speed = this.vdist(this.last_send.pos, character_pos) / time;
          if (speed < 0.001) {
            speed = 0;
          }
        }
        this.last_send.send_time = now;
        this.vcopy(this.last_send.pos, character_pos);
        let data_assignments: {
          pos?: number[];
          speed?: number;
        } & AnimState = {};
        if (pos_diff) {
          data_assignments.pos = entless ? this.arrPos(this.last_send.pos) : this.arr(this.last_send.pos);
          if (!entless) {
            data_assignments.speed = speed;
          }
        }
        if (state_diff) {
          for (let key in state_diff) {
            data_assignments[key] = anim_state[key];
            this.last_send.anim_state[key] = anim_state[key];
          }
        }
        let handle_resp = (err: string | null): void => {
          if (!this.sends_to_ignore) {
            this.last_send.sending = false;
            let end = getFrameTimestamp();
            let hrend = engine.hrnow();
            let round_trip = hrend - this.last_send.hrtime;
            this.ping_time = round_trip;
            this.ping_time_time = end;
            if (round_trip > send_time) {
              // hiccup, delay next send
              this.last_send.time = end;
            }
          } else {
            --this.sends_to_ignore;
          }
          if (err) {
            return this.error_handler(err);
          }
        };
        if (this.entity_manager.isEntless()) {
          this.entity_manager.channelSend('move', data_assignments, handle_resp);
        } else {
          // send via entity
          let my_ent = this.entity_manager.getMyEnt();
          my_ent.actionSend({
            action_id: 'move',
            data_assignments,
          }, handle_resp);
        }
      }
    } else {
      // Nothing has changed
      if (!this.last_send.sending) {
        // Flag send time so changes are batched, instead of immediately sending
        // a state change plus (miniscule) movement, followed by a delay, followed
        // by the actual movement.
        // This also resets `send_time` so that speed is calculated more accurately
        this.last_send.send_time = this.last_send.time = getFrameTimestamp();
      }
    }
  }

  private otherEntityChanged(ent_id: EntityID): void {
    let { anim_state_defs } = this;
    let ent = this.entity_manager.getEnt(ent_id);
    assert(ent);
    let ent_data = ent.data;
    // Relevant fields on ent_data: pos, anything referenced by anim_state_defs
    let ped = this.per_ent_data[ent_id];
    if (!ped) {
      ped = this.per_ent_data[ent_id] = new PerEntData(this);
      for (let key in anim_state_defs) {
        ped.anim_state[key] = ent_data[key];
      }
      this.vcopy(ped.pos, ent_data.pos as number[]);
    }
    for (let key in anim_state_defs) {
      ped.net_anim_state[key] = ent_data[key];
    }

    if (!this.vsame(ped.net_pos, ent_data.pos)) {
      this.vcopy(ped.net_pos, ent_data.pos as number[]);
      ped.net_speed = ent_data.speed;

      // Keep ped.pos[rot] within PI of ped.net_pos, so interpolation always goes the right way
      for (let ii = 0; ii < this.dim_rot; ++ii) {
        let jj = this.dim_pos + ii;
        while (ped.pos[jj] > ped.net_pos[jj] + PI) {
          ped.pos[jj] -= TWO_PI;
        }
        while (ped.pos[jj] < ped.net_pos[jj] - PI) {
          ped.pos[jj] += TWO_PI;
        }
      }

      // This interpolation logic taken from Splody
      // Doesn't do great with physics-based jumps though
      const delta = this.vsub(this.temp_delta, ped.net_pos, ped.pos);
      const dist = this.vlength(delta);

      if (dist > 0) {
        const time_to_dest = dist / ped.net_speed;
        if (time_to_dest < this.send_time + this.window) {
          // Would get there in the expected time, use this speed
          this.vscale(ped.impulse, delta, ped.net_speed / dist);
        } else if (time_to_dest < this.send_time + this.window * this.smooth_windows) { // 0.5s
          // We'll could be there in under half a second, try to catch up smoothly
          // Using provided speed is too slow, go faster, though no slower than we were going
          // (in case this is the last of multiple delayed updates and the last update was going a tiny distance slowly)
          const old_speed = this.vlength(ped.impulse);
          const specified_speed = ped.net_speed;
          const new_speed = max(specified_speed * this.smooth_factor, old_speed);
          this.vscale(ped.impulse, delta, new_speed / dist);
        } else {
          // We're way far behind using the provided speed, attempt to get all the way there by the next few
          // theoretical updates, this basically snaps if this is particularly small
          this.vscale(ped.impulse, delta, 1 / (this.send_time + this.window * this.snap_factor));
        }
      }
    }
  }

  updateOtherEntity(ent_id: EntityID, dt: number): PerEntData | null {
    const ped = this.per_ent_data[ent_id];
    if (!ped) {
      // Never got a position sent to us, ignore
      return null;
    }

    // Apply interpolation (logic from Splody)
    let stopped = true;
    for (let ii = 0; ii < this.n; ++ii) {
      if (ped.impulse[ii]) {
        const delta_old = ped.net_pos[ii] - ped.pos[ii];
        const delta_old_sign = sign(delta_old);
        ped.pos[ii] += ped.impulse[ii] * dt;
        const delta_new = ped.net_pos[ii] - ped.pos[ii];
        const delta_new_sign = sign(delta_new);
        if (delta_new_sign !== delta_old_sign) {
          // made it or passed it
          ped.pos[ii] = ped.net_pos[ii];
          ped.impulse[ii] = 0;
        } else if (ii < this.dim_pos && abs(ped.impulse[ii]) > 0.001) {
          // If positional (not rotation), we're not stopped
          stopped = false;
        }
      }
    }

    let { anim_state_defs } = this;
    for (let key in anim_state_defs) {
      if (ped.anim_state[key] !== ped.net_anim_state[key]) {
        let def = anim_state_defs[key]!;
        let apply_change = true;
        if (def.stopped && !stopped) {
          const cur_is_move = !def.stopped(ped.anim_state[key]);
          const new_is_idle = def.stopped(ped.net_anim_state[key]);
          if (cur_is_move && new_is_idle) {
            // entity is still moving, and this new state is not moving related,
            // don't apply yet
            apply_change = false;
          }
        } else {
          // Just apply - maybe should just do this in otherEntityChanged()?
        }
        if (apply_change) {
          ped.anim_state[key] = ped.net_anim_state[key];
          // if (this.on_state_update) {
          //   this.on_state_update(ent_id, ped.net_state);
          // }
        }
      }
    }
    return ped;
  }

  getPing(): PingData | null {
    const max_age = 2000;
    if (!this.ping_time_time) {
      return null;
    }
    let age = getFrameTimestamp() - this.ping_time_time;
    if (age > max_age) {
      return null;
    }
    return {
      ping: this.ping_time,
      fade: 1 - age / max_age,
    };
  }

}

export function entityPositionManagerCreate(options: EntityPositionManagerOpts): EntityPositionManager {
  let ret = new EntityPositionManagerImpl(options);
  registerPingProvider(ret.getPing.bind(ret));
  return ret;
}
