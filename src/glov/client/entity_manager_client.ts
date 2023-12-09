// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import {
  ActionListResponse,
  ActionMessageParam,
  ClientID,
  EALF_HAS_ASSIGNMENTS,
  EALF_HAS_ENT_ID,
  EALF_HAS_PAYLOAD,
  EALF_HAS_PREDICATE,
  EntityBaseDataCommon,
  EntityFieldDefCommon,
  EntityFieldEncoder,
  EntityFieldEncoding,
  EntityFieldSpecial,
  EntityFieldSub,
  EntityID,
  EntityManager,
  EntityManagerEvent,
  EntityManagerSchema,
  EntityUpdateCmd,
  entity_field_decoders,
  entity_field_encoders,
} from 'glov/common/entity_base_common';
import { Packet } from 'glov/common/packet';
import { EventEmitter } from 'glov/common/tiny-events';
import { ClientChannelWorker, DataObject, NetErrorCallback } from 'glov/common/types';
import { ridx } from 'glov/common/util';
import * as engine from './engine';
import {
  ClientActionMessageParam,
  EntityBaseClient,
} from './entity_base_client';
import { netClientId, netDisconnected, netSubs } from './net';
const walltime: () => number = require('./walltime.js');

const { max, min, round } = Math;

export type EntCreateFunc<
  Entity extends EntityBaseClient,
> = (data: DataObject) => Entity;

interface ClientEntityManagerBaseOpts<Entity extends EntityBaseClient> {
  on_broadcast?: (data: EntityManagerEvent) => void;
  create_func: EntCreateFunc<Entity>;

  channel?: ClientChannelWorker;
}

export interface ClientEntityManagerOpts<Entity extends EntityBaseClient> extends ClientEntityManagerBaseOpts<Entity> {
  channel_type: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ClientEntityManagerInterface<Entity extends EntityBaseClient=any> extends EntityManager<Entity> {
  reinit(options: Partial<ClientEntityManagerBaseOpts<Entity>>): void;
  getEnt(ent_id: EntityID): Entity | undefined;
  hasMyEnt(): boolean;
  getMyEntID(): EntityID;
  getMyEnt(): Entity;
  getSubscriptionId(): string;
  getSubscriptionIdPrefix(): string;
  isReady(): boolean;
  isEntless(): boolean;
  tick(): void;
  checkNet(): boolean;
  isOnline(): boolean;

  // Online only
  actionSendQueued(
    action: ClientActionMessageParam<Entity>,
    resp_func?: NetErrorCallback<unknown>,
  ): void;
  actionListFlush(): void;
  channelSend(msg: string, data?: unknown, resp_func?: NetErrorCallback): void;

  // Offline only
  addEntityFromSerialized(data: DataObject): Entity;
  setMyEntID(id: EntityID): void;
  deleteEntity(ent_id: EntityID, reason: string) : void;

  // EventEmitter:
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  on<T extends any[]>(type: string, fn: (...args: T) => void): void;
}

interface FadingEnt {
  is_out: boolean; // fading out? otherwise, is fading in
  ent_id: EntityID;
  countdown: number;
  countdown_max: number;
}

interface EntityFieldDefClient<Entity extends EntityBaseClient> extends EntityFieldDefCommon {
  field_name: string;
  field_id: number;
  encoder: EntityFieldEncoder<Entity>;
}

function entActionAppend<Entity extends EntityBaseClient>(
  entity_manager: ClientEntityManagerImpl<Entity>,
  ent: Entity,
  pak: Packet,
  action_data: ActionMessageParam
): void {
  let { action_id, ent_id, predicate, self, payload, data_assignments } = action_data;
  let flags = 0;
  if (predicate) {
    flags |= EALF_HAS_PREDICATE;
  }
  if (self) {
    // not sending ent ID
  } else {
    flags |= EALF_HAS_ENT_ID;
  }
  if (payload !== undefined) {
    flags |= EALF_HAS_PAYLOAD;
  }
  if (data_assignments) {
    flags |= EALF_HAS_ASSIGNMENTS;
  }
  pak.writeInt(flags);
  pak.writeAnsiString(action_id);
  if (flags & EALF_HAS_PREDICATE) {
    assert(predicate);
    pak.writeAnsiString(predicate.field);
    pak.writeAnsiString(predicate.expected_value || '');
  }
  if (flags & EALF_HAS_ENT_ID) {
    assert(ent_id);
    pak.writeInt(ent_id);
  }
  if (flags & EALF_HAS_PAYLOAD) {
    pak.writeJSON(payload);
  }
  if (flags & EALF_HAS_ASSIGNMENTS) {
    let { field_defs_by_name } = entity_manager;
    assert(field_defs_by_name);
    for (let key in data_assignments) {
      let field_def = field_defs_by_name[key];
      assert(field_def);
      let { field_id, sub, default_value, encoder } = field_def;
      assert(!sub); // TODO: support
      let value = data_assignments[key];
      if (value === default_value || value === null && default_value === undefined) {
        pak.writeInt(EntityFieldSpecial.Default);
        pak.writeInt(field_id);
      } else {
        pak.writeInt(field_id);
        encoder(ent, pak, value, false);
      }
    }
    pak.writeInt(EntityFieldSpecial.Terminate);
  }
}

class ClientEntityManagerImpl<
  Entity extends EntityBaseClient
> extends EventEmitter implements EntityManager<Entity>,
    ClientEntityManagerBaseOpts<Entity>,
    ClientEntityManagerInterface<Entity> {
  my_ent_id!: EntityID;

  on_broadcast?: (data: EntityManagerEvent) => void;
  create_func!: EntCreateFunc<Entity>;
  channel?: ClientChannelWorker;

  client_id?: ClientID;
  subscription_id?: string;
  sub_id_prefix!: string;

  entities!: Partial<Record<EntityID, Entity>>;
  fading_ents!: FadingEnt[];

  field_defs?: (EntityFieldDefClient<Entity>|null)[];
  field_defs_by_name?: Partial<Record<string, EntityFieldDefClient<Entity>>>;

  received_ent_ready!: boolean;
  received_ent_start!: boolean;

  frame_wall_time: number;

  dummy_ent_data?: EntityBaseDataCommon; // Used for a destination of applying diffs before getting a full update

  constructor(options: ClientEntityManagerOpts<Entity>) {
    super();
    assert(options.channel_type);
    netSubs().onChannelMsg(options.channel_type, 'ent_update', this.onEntUpdate.bind(this));
    netSubs().onChannelMsg(options.channel_type, 'ent_broadcast', this.onBroadcast.bind(this));
    netSubs().onChannelMsg(options.channel_type, 'ent_start', this.onEntStart.bind(this));
    netSubs().onChannelMsg(options.channel_type, 'ent_ready', this.onEntReady.bind(this));
    netSubs().onChannelMsg(options.channel_type, 'ent_id_change', this.onEntIdChange.bind(this));
    netSubs().onChannelEvent(options.channel_type, 'subscribe', this.onChannelSubscribe.bind(this));

    this.reinit(options);

    this.frame_wall_time = walltime();
  }

  reinit(options: Partial<ClientEntityManagerBaseOpts<Entity>>): void {
    this.deinit();

    this.create_func = options.create_func || this.create_func;
    this.on_broadcast = options.on_broadcast || this.on_broadcast;

    // Never inheriting this over reinit()
    this.channel = options.channel;

    this.reinitInternal();
  }

  private reinitInternal(): void {
    this.entities = {};
    this.fading_ents = [];
    this.my_ent_id = 0;
    this.received_ent_ready = false;
    this.received_ent_start = false;
    this.sub_id_prefix = '::'; // anything not valid
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

  getSubscriptionId(): string {
    return this.subscription_id || netClientId();
  }
  getSubscriptionIdPrefix(): string {
    return this.sub_id_prefix;
  }

  private onChannelSubscribe(data: unknown): void {
    // initial connection or reconnect
    this.reinitInternal();
    this.client_id = netClientId();
    this.subscription_id = (data as DataObject).sub_id as string || this.client_id;
    this.sub_id_prefix = `${this.subscription_id}:`;
    this.emit('subscribe', data);
  }

  private onBroadcast(data: EntityManagerEvent): void {
    if (!this.received_ent_start) {
      return;
    }
    assert(this.on_broadcast);
    this.on_broadcast(data);
  }

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
    assert(false, 'Offline only');
  }

  private getEntDataForDiff(ent_id: EntityID): [EntityBaseDataCommon, Entity | null] {
    let ent = this.entities[ent_id];
    if (ent) {
      return [ent.data, ent];
    }
    if (!this.dummy_ent_data) {
      this.dummy_ent_data = this.initializeNewFullEntData();
    }
    return [this.dummy_ent_data, null];
  }

  private readDiffFromPacket(ent_data: EntityBaseDataCommon, pak: Packet): void {
    let { field_defs } = this;
    assert(field_defs); // should have received this before receiving any diffs!
    let data = ent_data as DataObject;
    let field_id: number;
    while ((field_id = pak.readInt())) {
      let do_default = field_id === EntityFieldSpecial.Default;
      if (do_default) {
        field_id = pak.readInt();
      }
      let field_def = field_defs[field_id];
      if (!field_def) {
        assert(field_def, `Missing field_def in server-provided schema for field#"${field_id}"`); // catch coding bug
      }
      let { default_value, encoding, field_name, sub } = field_def;
      let decoder = entity_field_decoders[encoding];
      if (!decoder) {
        assert(decoder, `Missing decoder for type ${field_def.encoding}`); // catch server<->client unable to comm
      }
      if (sub) {
        assert(!do_default);
        let sub_value = data[field_name];
        if (sub === EntityFieldSub.Array) {
          if (!sub_value) {
            sub_value = data[field_name] = [];
          }
          assert(Array.isArray(sub_value));
          let index;
          while ((index = pak.readInt())) {
            if (index === -1) {
              sub_value.length = pak.readInt();
            } else {
              let old_value = sub_value[index-1];
              let new_value = decoder(pak, old_value);
              sub_value[index-1] = new_value;
            }
          }
        } else { // EntityFieldSub.Record
          if (!sub_value) {
            sub_value = data[field_name] = {};
          }
          assert(sub_value && typeof sub_value === 'object' && !Array.isArray(sub_value));
          let sub_obj: DataObject = sub_value;
          let key;
          while ((key = pak.readAnsiString())) {
            let old_value = sub_obj[key];
            let new_value = decoder(pak, old_value);
            if (new_value === undefined) {
              delete sub_obj[key];
            } else {
              sub_obj[key] = new_value;
            }
          }
        }
      } else {
        let old_value = data[field_name];
        let new_value = do_default ? default_value : decoder(pak, old_value);
        if (new_value === undefined) {
          delete data[field_name];
        } else {
          data[field_name] = new_value;
        }
      }
    }
  }

  private initSchema(schema: EntityManagerSchema): void {
    let field_defs: (EntityFieldDefClient<Entity>|null)[] = [null];
    let field_defs_by_name: Partial<Record<string, EntityFieldDefClient<Entity>>> = {};
    for (let ii = 0; ii < schema.length; ++ii) {
      let ser_def = schema[ii];
      let idx = ii + EntityFieldSpecial.MAX;
      let encoding = ser_def.e || EntityFieldEncoding.JSON;
      let encoder = entity_field_encoders[encoding];
      assert(encoder);
      let def = field_defs[idx] = {
        encoding,
        encoder,
        default_value: ser_def.d, // *not* `|| undefined` - 0, '', and null allowed here
        sub: ser_def.s || EntityFieldSub.None,
        field_name: ser_def.n,
        field_id: idx,
      };
      field_defs_by_name[def.field_name] = def;
    }
    this.field_defs = field_defs;
    this.field_defs_by_name = field_defs_by_name;
  }

  private initializeNewFullEntData(): EntityBaseDataCommon {
    let { field_defs } = this;
    assert(field_defs);
    let data = {} as DataObject;
    for (let ii = 0; ii < field_defs.length; ++ii) {
      let def = field_defs[ii];
      if (!def) {
        continue;
      }
      let { default_value, field_name } = def;
      if (default_value !== undefined && default_value !== data[field_name]) {
        data[field_name] = default_value;
      }
    }
    return data;
  }

  private instantiateEntFromFullUpdate(ent_id: EntityID, ent_data: EntityBaseDataCommon, is_initial: boolean): Entity {
    let existing_ent = this.entities[ent_id];
    if (existing_ent) {
      assert(existing_ent.fading_out); // otherwise should have been deleted?
      // was deleting, but got a new update on it (presumably was out of view, and came back), finish delete
      // TODO: start fade in from appropriate value (after applying full update
      //   later in the packet and calling onCreate)
      existing_ent.fading_out = false;
      existing_ent.fade = null;
      for (let jj = 0; jj < this.fading_ents.length; ++jj) {
        let fade = this.fading_ents[jj];
        if (fade.ent_id === ent_id) {
          ridx(this.fading_ents, jj);
          this.finalizeDelete(ent_id);
          break;
        }
      }
      // Should be cleaned up at this point
      assert(!this.entities[ent_id]);
    }
    let ent = this.entities[ent_id] = this.create_func(ent_data);
    ent.id = ent_id;
    ent.entity_manager = this;
    let fade_in_time = ent.onCreate(is_initial);
    if (fade_in_time) {
      this.fadeInEnt(ent, fade_in_time);
    }
    return ent;
  }

  private onEntUpdate(pak: Packet): void {
    if (!this.received_ent_start) {
      pak.pool();
      return;
    }
    let cmd: EntityUpdateCmd;
    let is_initial = false;
    while ((cmd = pak.readU8())) {
      switch (cmd) {
        case EntityUpdateCmd.Full: {
          let ent_id = pak.readInt();
          let ent_data = this.initializeNewFullEntData();
          this.readDiffFromPacket(ent_data, pak);
          let ent = this.instantiateEntFromFullUpdate(ent_id, ent_data, is_initial);
          ent.postEntUpdate();
          this.emit('ent_update', ent.id);
        } break;
        case EntityUpdateCmd.Diff: {
          let ent_id = pak.readInt();
          // Get an entity to apply the diff to.  Note: this may reference an entity
          //   that does not yet exist, and apply a meaningless diff to `dummy_ent_data`, but we
          //   need to do so in order to advance through the packet.  Presumably there's
          //   a full update for this entity at the end of the packet for us.
          let [ent_data, ent] = this.getEntDataForDiff(ent_id);
          this.readDiffFromPacket(ent_data, pak);
          if (ent) {
            ent.postEntUpdate();
            this.emit('ent_update', ent.id);
          }
        } break;
        case EntityUpdateCmd.Delete: {
          let ent_id = pak.readInt();
          let reason = pak.readAnsiString();
          this.deleteEntityInternal(ent_id, reason);
        } break;
        case EntityUpdateCmd.Event: {
          let data = pak.readJSON() as EntityManagerEvent;
          this.onBroadcast(data);
        } break;
        case EntityUpdateCmd.Schema: {
          let schema = pak.readJSON() as EntityManagerSchema;
          this.initSchema(schema);
        } break;
        case EntityUpdateCmd.IsInitialList:
          is_initial = true;
          break;
        default:
          assert(false, `Unexpected EntityUpdateCmd: ${cmd}`);
      }
    }
  }

  private onEntReady(): void {
    if (this.received_ent_start) {
      this.received_ent_ready = true;
      this.emit('ent_ready');
    } // else may have been from a previous connection?
  }

  // Has received all initial visible entities
  isReady(): boolean {
    return this.received_ent_ready;
  }

  private onEntStart(data: { ent_id: EntityID; sub_id: string }): void {
    if (data.sub_id === this.subscription_id) {
      this.my_ent_id = data.ent_id;
      this.received_ent_start = true;
      this.emit('ent_start');
    } // else may have been from a previous connection
  }

  private onEntIdChange(data: { ent_id: EntityID; sub_id: string }): void {
    if (data.sub_id === this.subscription_id) {
      this.my_ent_id = data.ent_id;
    } // else may have been from a previous connection
  }

  checkNet(): boolean {
    if (netDisconnected() || !this.channel || !this.received_ent_ready) {
      // Not yet receiving updates, do nothing
      return true;
    }
    if (netClientId() !== this.client_id) {
      // Haven't yet subscribed to this room under the new client_id
      return true;
    }

    return false;
  }

  private handleActionListResult(
    action_list: ClientActionMessageParam<Entity>[],
    resp_list: (NetErrorCallback<unknown> | undefined)[],
    err: string | null,
    resp?: ActionListResponse,
  ): void {
    resp = resp || [];
    for (let ii = 0; ii < resp_list.length; ++ii) {
      let this_resp = resp[ii] || {};
      let this_err = err || this_resp.err;
      let this_data = this_resp.data;
      let action_data = action_list[ii];
      let { ent } = action_data;
      ent.handleActionResult(action_data, this_err, this_data);
      let resp_func = resp_list[ii];
      if (resp_func) {
        resp_func(this_err || null, this_data);
      } else {
        // "Expected" errors
        let { predicate, data_assignments } = action_data;
        if (predicate && data_assignments) {
          let { field, expected_value } = predicate;
          if (
            this_err === 'ERR_FIELD_MISMATCH' || // prediction mismatch
            this_err === 'ERR_INVALID_ENT_ID' // entity has been removed / moved out of range / etc
          ) {
            console.log(`Received (not unexpected) error ${this_err} applying batch update ` +
              `${field}=${expected_value}->${data_assignments[field]} to ent:${ent.id}`);
            return;
          }
        }
        // Otherwise received an error but no client code handling the error, throw it
        if (this_err) {
          throw this_err;
        }
      }
    }
  }

  action_list_queue: {
    action_list: ClientActionMessageParam<Entity>[];
    resp_list: (NetErrorCallback<unknown> | undefined)[];
  } | null = null;

  actionListFlush(): void {
    if (!this.action_list_queue) {
      return;
    }
    assert(this.channel);
    assert(this.channel.numSubscriptions());
    let { action_list, resp_list } = this.action_list_queue;
    this.action_list_queue = null;
    let pak = this.channel.pak('ent_action_list');
    pak.writeInt(action_list.length);
    for (let ii = 0; ii < action_list.length; ++ii) {
      let action_data = action_list[ii];
      let { ent } = action_data;
      if (ent.id === this.my_ent_id) {
        action_data.self = true;
      } else {
        action_data.ent_id = ent.id;
      }
      entActionAppend(this, ent, pak, action_data);
    }

    pak.send<ActionListResponse>(this.handleActionListResult.bind(this, action_list, resp_list));
  }

  actionSendQueued(
    action: ClientActionMessageParam<Entity>,
    resp_func?: NetErrorCallback<unknown>,
  ): void {
    assert(this.channel?.numSubscriptions());
    assert(action.ent);
    if (!this.action_list_queue) {
      this.action_list_queue = {
        action_list: [],
        resp_list: [],
      };
    }
    this.action_list_queue.action_list.push(action);
    this.action_list_queue.resp_list.push(resp_func);
  }

  channelSend(msg: string, data?: unknown, resp_func?: NetErrorCallback): void {
    assert(this.channel);
    assert(this.channel.numSubscriptions());
    this.channel.send(msg, data, resp_func);
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
      new_ent.entity_manager = this;
      // Invalidate old ent
      ent.id = 0;
      ent.entity_manager = null!;
      entities[ent_id_string] = new_ent;
      ret.push(new_ent);
    }
    return ret;
  }

  isOnline(): boolean {
    return true;
  }

  addEntityFromSerialized(): Entity {
    assert(false, 'Offline only');
  }
  setMyEntID(): void {
    assert(false, 'Offline only');
  }
}

export function clientEntityManagerCreate<Entity extends EntityBaseClient>(
  options: ClientEntityManagerOpts<Entity>
): ClientEntityManagerInterface<Entity> {
  return new ClientEntityManagerImpl(options);
}
