// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import {
  EntityID,
  EntityManager,
  EntityManagerEvent,
} from 'glov/common/entity_base_common';
import { EventEmitter } from 'glov/common/tiny-events';
import { DataObject, NetErrorCallback } from 'glov/common/types';
import { callEach, ridx } from 'glov/common/util';
import * as engine from './engine';
import {
  ClientActionMessageParam,
  EntityBaseClient,
} from './entity_base_client';
import { ClientEntityManagerInterface } from './entity_manager_client';
const walltime: () => number = require('./walltime.js');

const { max, min, round } = Math;

export type EntCreateFunc<
  Entity extends EntityBaseClient,
> = (data: DataObject) => Entity;

export interface OfflineEntityManagerOpts<Entity extends EntityBaseClient> {
  on_broadcast?: (data: EntityManagerEvent) => void;
  create_func: EntCreateFunc<Entity>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OfflineEntityManagerInterface = OfflineEntityManager<any>;

interface FadingEnt {
  is_out: boolean; // fading out? otherwise, is fading in
  ent_id: EntityID;
  countdown: number;
  countdown_max: number;
}

export type OfflineEntityManager<Entity extends EntityBaseClient> =
  Readonly<OfflineEntityManagerImpl<Entity>>; // Really want all non-functions private, not readonly...
class OfflineEntityManagerImpl<
  Entity extends EntityBaseClient
> extends EventEmitter implements EntityManager<Entity>,
    OfflineEntityManagerOpts<Entity>,
    ClientEntityManagerInterface<Entity> {
  my_ent_id!: EntityID;

  on_broadcast?: (data: EntityManagerEvent) => void;
  create_func!: EntCreateFunc<Entity>;

  entities!: Partial<Record<EntityID, Entity>>;
  fading_ents!: FadingEnt[];

  received_ent_start!: boolean;

  frame_wall_time: number;

  constructor(options: OfflineEntityManagerOpts<Entity>) {
    super();

    this.reinit(options);

    this.frame_wall_time = walltime();
  }

  reinit(options: Partial<OfflineEntityManagerOpts<Entity>>): void {
    this.deinit();

    this.create_func = options.create_func || this.create_func;
    this.on_broadcast = options.on_broadcast || this.on_broadcast;

    this.reinitInternal();
  }

  private reinitInternal(): void {
    this.entities = {};
    this.fading_ents = [];
    this.my_ent_id = 0;
    this.received_ent_start = false;
  }

  deinit(): void {
    // Maybe this function is not needed anymore
    this.received_ent_start = false;
  }

  private finalizeDelete(ent_id: EntityID): void {
    this.emit('ent_delete', ent_id);
    delete this.entities[ent_id];
  }

  tick(): void {
    this.frame_wall_time = max(this.frame_wall_time, walltime()); // strictly increasing

    if (this.fading_ents) {
      for (let ii = this.fading_ents.length - 1; ii >= 0; --ii) {
        let elem = this.fading_ents[ii];
        elem.countdown -= engine.frame_dt;
        let { ent_id } = elem;
        if (elem.countdown <= 0) {
          if (elem.is_out) {
            this.finalizeDelete(ent_id);
          } else {
            let ent = this.entities[ent_id];
            assert(ent);
            assert(ent.fading_in);
            ent.fading_in = false;
            ent.fade = null;
          }
          ridx(this.fading_ents, ii);
        } else {
          let ent = this.entities[ent_id];
          assert(ent);
          if (elem.is_out) {
            // if playing death animations, dividing by this was better (adds a
            //    delay before starting fading): min(elem.countdown_max, 500));
            ent.fade = min(1, elem.countdown / elem.countdown_max);
          } else {
            ent.fade = 1 - elem.countdown / elem.countdown_max;
          }
        }
      }
    }
  }

  getFrameWallTime(): number {
    return this.frame_wall_time;
  }

  // Has own entity ID assigned, will be receiving updates
  receivedEntStart(): boolean {
    return this.received_ent_start;
  }

  // Has received all initial visible entities
  isReady(): boolean {
    return true;
  }

  getSubscriptionId(): string {
    return 'OFFLINE';
  }
  getSubscriptionIdPrefix(): string {
    return 'OFFLINE:';
  }
  // TODO: something like this upon loading world state
  // private onChannelSubscribe(data: unknown): void {
  //   // initial connection or reconnect
  //   this.reinitInternal();
  //   this.emit('subscribe', data);
  // }

  // TODO: broadcast events?
  // private onBroadcast(data: EntityManagerEvent): void {
  //   if (!this.received_ent_start) {
  //     return;
  //   }
  //   assert(this.on_broadcast);
  //   this.on_broadcast(data);
  // }

  private fadeInEnt(ent: Entity, time: number): void {
    assert(!ent.fading_out);
    assert(!ent.fading_in);
    ent.fading_in = true;
    this.fading_ents.push({
      is_out: false,
      ent_id: ent.id,
      countdown: time,
      countdown_max: time,
    });
  }

  private deleteEntityInternal(ent_id: EntityID, reason: string): void {
    let ent = this.entities[ent_id];
    assert(ent); // Previously might happen from a queued delete from before we joined, but no longer?
    assert(!ent.fading_out);
    ent.fading_out = true;
    let countdown_max = ent.onDelete(reason);

    if (ent.fading_in) {
      ent.fading_in = false;
      for (let ii = 0; ii < this.fading_ents.length; ++ii) {
        let fade = this.fading_ents[ii];
        if (fade.ent_id === ent_id) {
          if (countdown_max) {
            fade.is_out = true;
            fade.countdown = round((ent.fade || 0) * countdown_max);
            fade.countdown_max = countdown_max;
          } else {
            ridx(this.fading_ents, ii);
            this.finalizeDelete(ent_id);
          }
          return;
        }
      }
      assert(false);
    }

    if (countdown_max) {
      this.fading_ents.push({
        is_out: true,
        ent_id,
        countdown: countdown_max,
        countdown_max: countdown_max,
      });
    } else {
      this.finalizeDelete(ent_id);
    }
  }

  deleteEntity(ent_id: EntityID, reason: string) : void {
    this.deleteEntityInternal(ent_id, reason);
  }

  // private onEntReady(): void {
  //   if (this.received_ent_start) {
  //     this.received_ent_ready = true;
  //     this.emit('ent_ready');
  //   } // else may have been from a previous connection?
  // }

  // isReady(): boolean {
  //   return this.received_ent_ready;
  // }

  setMyEntID(id: EntityID): void {
    this.my_ent_id = id;
    this.received_ent_start = true;
    this.emit('ent_start');
  }

  checkNet(): boolean {
    return false;
  }

  getEnt(ent_id: EntityID): Entity | undefined {
    return this.entities[ent_id];
  }

  hasMyEnt(): boolean {
    return Boolean(this.my_ent_id && this.getEnt(this.my_ent_id));
  }

  isEntless(): boolean {
    return !this.my_ent_id;
  }

  getMyEntID(): EntityID {
    return this.my_ent_id;
  }

  getMyEnt(): Entity {
    assert(this.my_ent_id);
    let ent = this.getEnt(this.my_ent_id);
    assert(ent);
    return ent;
  }

  entitiesFind(
    predicate: (ent: Entity) => boolean,
    skip_fading_out?: boolean
  ): Entity[] {
    let { entities } = this;
    let ret = [];
    for (let ent_id_string in entities) {
      let ent = entities[ent_id_string]!;
      if (ent.fading_out && skip_fading_out) {
        continue;
      }
      if (!predicate(ent)) {
        continue;
      }
      ret.push(ent);
    }
    return ret;
  }

  entitiesReload(predicate?: (ent: Entity) => boolean): Entity[] {
    let { entities } = this;
    let ret = [];
    for (let ent_id_string in entities) {
      let ent = entities[ent_id_string]!;
      if (predicate && !predicate(ent)) {
        continue;
      }
      let new_ent = this.create_func(ent.data);
      new_ent.id = ent.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new_ent.entity_manager = this as any; // HACK
      // Invalidate old ent
      ent.id = 0;
      ent.entity_manager = null!;
      entities[ent_id_string] = new_ent;
      ret.push(new_ent);
    }
    return ret;
  }

  channelSend(): void {
    assert(!'Online only');
  }
  action_queue: (()=>void)[] = [];
  actionSendQueued(
    action: ClientActionMessageParam<Entity>,
    resp_func?: NetErrorCallback<unknown>,
  ): void {
    assert(action.data_assignments); // Otherwise, definitely won't do anything
    this.action_queue.push(() => {
      let ent = action.ent;
      let data = (ent.data as DataObject);
      for (let key in action.data_assignments) {
        let value = action.data_assignments[key];
        if (value === null) {
          delete data[key];
        } else {
          data[key] = value;
        }
      }
      this.emit('ent_update', ent.id);
      if (resp_func) {
        resp_func(null);
      }
    });
  }
  actionListFlush(): void {
    callEach(this.action_queue, this.action_queue = []);
  }
  isOnline(): boolean {
    return false;
  }

  last_ent_id: number = 0;
  createEntity(data: DataObject): Entity {
    let ent = this.create_func(data);
    ent.id = ++this.last_ent_id;
    ent.entity_manager = this;
    // ent.finishCreation();
    return ent;
  }

  addEntityFromSerialized(data: DataObject): Entity {
    let ent = this.createEntity(data);
    // assert(!ent.is_player);
    // ent.fixupPostLoad();
    this.entities[ent.id] = ent;
    this.emit('ent_update', ent.id);
    return ent;
  }
}

export function offlineEntityManagerCreate<Entity extends EntityBaseClient>(
  options: OfflineEntityManagerOpts<Entity>
): ClientEntityManagerInterface<Entity> {
  return new OfflineEntityManagerImpl(options);
}
