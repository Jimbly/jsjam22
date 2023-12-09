// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import { asyncEach } from 'glov-async';
import {
  ActionListResponse,
  ActionMessageParam,
  ClientID,
  EALF_HAS_ASSIGNMENTS,
  EALF_HAS_ENT_ID,
  EALF_HAS_PAYLOAD,
  EALF_HAS_PREDICATE,
  EntityFieldDefSerialized,
  EntityFieldEncoding,
  EntityFieldSpecial,
  EntityFieldSub,
  EntityID,
  EntityManager,
  EntityManagerEvent,
  EntityManagerSchema,
  EntityUpdateCmd,
} from 'glov/common/entity_base_common';
import { Packet, packetCreate } from 'glov/common/packet';
import { EventEmitter } from 'glov/common/tiny-events';
import {
  ChatMessageDataBroadcast,
  ChatMessageDataSaved,
  ClientHandlerSource,
  DataObject,
  ErrorCallback,
  NetErrorCallback,
  NetResponseCallback,
  isDataObject,
} from 'glov/common/types';
import { callEach, logdata, nop } from 'glov/common/util';
import { entityServerDefaultLoadPlayerEntity, entity_field_defs } from 'glov/server/entity_base_server';
import { ChannelWorker } from './channel_worker.js';
import { ChattableWorker } from './chattable_worker.js';
import {
  ActionHandlerParam,
  DirtyFields,
  EntityBaseServer,
  EntityFieldDef,
  VAID,
} from './entity_base_server';

const { min } = Math;

export const ENTITY_LOG_VERBOSE = false;

export type JoinPayload = unknown;

export interface EntityManagerReadyWorker<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
> extends ChannelWorker {
  semClientInitialVisibleAreaSees(join_payload: JoinPayload, client: SEMClient): VAID[];
  entity_manager: ServerEntityManager<Entity, Worker>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServerEntityManagerInterface = ServerEntityManager<any,any>;

class VARecord<Entity extends EntityBaseServer> {
  loading: NetErrorCallback<never>[] | null;
  client_count = 0;
  in_unseen_set = false;
  last_needed_timestamp = 0; // was either seen or modified
  entities: Partial<Record<EntityID, Entity>> = {};

  constructor(on_load?: NetErrorCallback<never>) {
    this.loading = on_load ? [on_load] : [];
  }
}

function visibleAreaInit<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>(sem: ServerEntityManager<Entity, Worker>, vaid: VAID, next?: ErrorCallback<never, string>): void {
  let va = sem.visible_areas[vaid];
  if (va) {
    if (va.loading) {
      if (next) {
        va.loading.push(next);
      }
      return;
    }
    if (next) {
      return void next();
    }
    return;
  }
  let va2: VARecord<Entity> = va = sem.visible_areas[vaid] = new VARecord(next);
  sem.mem_usage.va.count++;
  function done(err?: string): void {
    if (err) {
      delete sem.visible_areas[vaid];
    }
    callEach(va2.loading, va2.loading = null, err || null);
  }
  sem.vaAddToUnseenSet(vaid, va);
  if (ENTITY_LOG_VERBOSE) {
    sem.worker.debug(`Initializing VisibleArea ${vaid}: Loading existing entities`);
  }
  sem.load_func(sem.worker, vaid, function (err?: string, ent_data?: DataObject[]) {
    if (err) {
      return void done(err);
    }
    if (!ent_data) {
      // initial load of VA
      sem.worker.debug(`Initializing VisibleArea ${vaid}: No existing data, asking worker to initialize`);
      // Want to at least save an empty ent_data[] so that the next load is not consider initial
      sem.visible_areas_need_save[vaid] = true;
      sem.emit('visible_area_init', vaid);
    } else {
      if (ENTITY_LOG_VERBOSE || ent_data.length) {
        sem.worker.debug(`Initializing VisibleArea ${vaid}: Loaded ${ent_data.length} entities`);
      }
      for (let ii = 0; ii < ent_data.length; ++ii) {
        // Same as addEntityFromSerialized(), but does not flag `visible_areas_need_save`
        let ent = sem.createEntity(ent_data[ii]);
        ent.fixupPostLoad();
        // Dirty flag should not be set: anyone who sees this VA must be waiting to send
        // initial ents anyway, do not need to send this entity to anyone
        // during regular ticking.
        assert(!ent.in_dirty_list);
        assert(ent.current_vaid !== undefined);
        ent.last_vaid = ent.current_vaid;
        assert.equal(ent.current_vaid, vaid);
        sem.addEntityInternal(ent);
      }
      sem.emit('visible_area_load', vaid);
    }
    done();
  });
}

function addToDirtyList<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>(
  sem: ServerEntityManager<Entity, Worker>,
  ent: Entity,
): void {
  assert(!ent.in_dirty_list);
  sem.dirty_list.push(ent);
  ent.in_dirty_list = true;
}

function loadPlayerEntity<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>(
  sem: ServerEntityManager<Entity, Worker>,
  src: ClientHandlerSource,
  join_payload: JoinPayload,
  client: SEMClient,
  player_uid: string | null,
  cb: NetErrorCallback<EntityID>
): void {
  if (!player_uid) {
    assert(!client.loading);
    assert(!client.ent_id);
    assert(!client.player_uid);
    return void cb(null, 0);
  }
  // Asks the entity to load it's data (presumably from the worker) if needed
  // Boots existing client registered for this player_uid

  let old_client = sem.player_uid_to_client[player_uid];
  if (old_client) {
    if (old_client.loading) {
      return void cb('ERR_STILL_LOADING');
    }
    assert(old_client.ent_id);
    // Kick old client
    let target_channel = `client.${old_client.client_id}`;
    sem.worker.logSrc(src, `Booting previous client ${old_client.client_id} for player_uid ${player_uid}`);
    // TODO: use force_unsub instead?  Probably also need an app-level message to send.
    sem.worker.sendChannelMessage(target_channel, 'force_kick');

    // Steal entity/player_uid
    client.player_uid = player_uid;
    client.ever_had_ent_id = true;
    client.ent_id = old_client.ent_id;
    old_client.player_uid = null;
    old_client.ent_id = 0;
    sem.player_uid_to_client[player_uid] = client;

    sem.clientLeave(old_client.client_id);

    return void cb(null, client.ent_id);
  }

  assert(!client.loading);
  sem.player_uid_to_client[player_uid] = client;
  client.player_uid = player_uid;
  client.loading = true;
  sem.load_player_func(sem, src, join_payload, player_uid, (err?: string | null, ent?: Entity) => {
    client.loading = false;
    if (err || client.left_while_loading) {
      if (ent) {
        ent.releasePlayerEntity();
      }

      sem.clientLeave(client.client_id);
      return void cb(err || 'ERR_LEFT_WHILE_LOADING');
    }

    assert(ent);
    assert.equal(client, sem.player_uid_to_client[player_uid]); // hasn't changed async while loading
    if (client.removed_ent_while_loading) {
      ent.releasePlayerEntity();
      sem.clientRemoveEntityInternal(client, 'left_while_loading');
      return void cb(null, 0);
    }
    assert(ent.id > 0);
    // ent.user_id = user_id; // not currently needed, but might be generally useful?
    ent.player_uid = player_uid;
    if (!ent.is_player) {
      // If the caller is using a TraitFactory, this should already be true on
      //   the prototype, if not, add it to the object.
      ent.is_player = true;
    }
    client.ever_had_ent_id = true;
    client.ent_id = ent.id;
    ent.fixupPostLoad();

    sem.addEntityInternal(ent);

    // Add to dirty list so full update gets sent to all subscribers
    addToDirtyList(sem, ent);

    cb(null, ent.id);
  });
}

function newEntsInVA<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>(
  sem: ServerEntityManager<Entity, Worker>,
  array_out: Entity[],
  vaid: VAID,
  known_entities: Partial<Record<EntityID, true>>
): void {
  let va = sem.vaGetRecord(vaid);
  let { entities: va_entities } = va;
  for (let ent_id_string in va_entities) {
    let ent = va_entities[ent_id_string]!;
    if (!ent.in_dirty_list && !known_entities[ent.id]) {
      // Note: since not dirty, current_vaid === last_vaid
      known_entities[ent.id] = true;
      array_out.push(ent);
    }
  }
}

function toSerializedStorage(ent: EntityBaseServer): DataObject {
  return ent.toSerializedStorage();
}

export function entityManagerDefaultSaveEnts(
  serialized_ent_version: number,
  worker: ChannelWorker,
  vaid: VAID,
  ent_data: DataObject[],
  done: () => void,
): void {
  worker.debug(`Saving ${ent_data.length} ent(s) for VA ${vaid}`);
  let ser_data = {
    ver: serialized_ent_version,
    ents: ent_data,
  };
  worker.setBulkChannelData(`ents.${vaid}`, ser_data, done);
}

export function entityManagerDefaultLoadEnts(
  serialized_ent_version: number,
  worker: ChannelWorker,
  vaid: VAID,
  cb: (err?: string, ent_data?: DataObject[]) => void,
): void {
  worker.getBulkChannelData(`ents.${vaid}`, null, function (err?: string | null, data?: unknown) {
    if (err) {
      return cb(err);
    }
    if (!data) {
      return cb();
    }
    if (Array.isArray(data)) {
      data = {
        ver: 0,
        ents: data,
      };
    }
    assert(isDataObject(data));
    assert(typeof data.ver === 'number');
    if (data.ver !== serialized_ent_version) {
      worker.debug(`Dropping old version (${data.ver}) ents for VisibleArea ${vaid}`);
      return cb();
    }
    assert(Array.isArray(data.ents));
    cb(undefined, data.ents);
  });
}


export type SEMClient = SEMClientImpl;
class SEMClientImpl {
  client_id: ClientID;
  player_uid: string | null;
  ent_id: EntityID;
  ever_had_ent_id: boolean;
  known_entities: Partial<Record<EntityID, true>>;
  loading: boolean;
  left_while_loading: boolean;
  removed_ent_while_loading: boolean;
  visible_area_sees: VAID[];
  has_schema: boolean;
  user_data: unknown;
  constructor(client_id: ClientID) {
    this.client_id = client_id;
    this.player_uid = null;
    this.ent_id = 0;
    this.ever_had_ent_id = false;
    this.known_entities = {};
    this.loading = false;
    this.left_while_loading = false;
    this.removed_ent_while_loading = false;
    this.visible_area_sees = [];
    this.has_schema = false;
  }

  getUserData<T>(): T {
    return this.user_data as T;
  }
  setUserData<T>(data: T): void {
    this.user_data = data;
  }
}

export type EntCreateFunc<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
> = (
  data: DataObject,
) => Entity;

export type EntSaveFunc<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
> = (
  worker: Worker,
  vaid: VAID,
  ent_data: DataObject[],
  done: () => void,
) => void;

export type EntLoadFunc<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
> = (
  worker: Worker,
  vaid: VAID,
  cb: (err?: string, ent_data?: DataObject[]) => void,
) => void;

export type EntLoadPlayerFunc<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
> = (
  sem: ServerEntityManager<Entity, Worker>,
  src: ClientHandlerSource,
  join_payload: JoinPayload,
  player_uid: string,
  cb: NetErrorCallback<Entity>,
) => void;

export interface ServerEntityManagerOpts<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
> {
  worker: Worker;
  create_func: EntCreateFunc<Entity, Worker>;
  max_ents_per_tick?: number;
  va_unload_time?: number;
  save_time?: number;
  load_func?: EntLoadFunc<Entity, Worker>;
  save_func?: EntSaveFunc<Entity, Worker>;
  load_player_func?: EntLoadPlayerFunc<Entity, Worker>;
  serialized_ent_version?: number;
}

export type ServerEntityManager<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
> = ServerEntityManagerImpl<Entity, Worker>;

type EntDelete = [EntityID, string];

type PerVAUpdate = {
  ent_ids: EntityID[];
  pak: Packet | null;
  debug: string[];
};

class ServerEntityManagerImpl<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>
  extends EventEmitter
  implements EntityManager<Entity>
{ // eslint-disable-line brace-style
  worker: Worker;
  field_defs_by_id: (EntityFieldDef|null)[];

  last_ent_id: EntityID = 0;
  clients: Partial<Record<ClientID, SEMClient>> = {};
  player_uid_to_client: Partial<Record<string, SEMClient>> = {}; // player_uid -> SEMClient
  visible_areas: Partial<Record<VAID, VARecord<Entity>>> = {};
  visible_areas_need_save: Partial<Record<VAID, true>> = {};
  visible_areas_unseen: Partial<Record<VAID, true>> = {};
  visible_area_broadcasts: Partial<Record<VAID, EntityManagerEvent[]>> = {};
  ent_deletes: Partial<Record<VAID, EntDelete[]>> = {};
  entities: Partial<Record<EntityID, Entity>> = {};
  flushing_changes: boolean = false;
  dirty_list: Entity[] = [];
  max_ents_per_tick: number;
  va_unload_time: number;
  save_time: number;
  create_func: EntCreateFunc<Entity, Worker>;
  load_func: EntLoadFunc<Entity, Worker>;
  save_func: EntSaveFunc<Entity, Worker>;
  load_player_func: EntLoadPlayerFunc<Entity, Worker>;
  schema: EntityManagerSchema;
  all_client_fields: DirtyFields;
  mem_usage = {
    entities: {
      count: 0,
    },
    va: {
      count: 0,
    },
    clients: {
      count: 0,
    },
  };

  last_save_time: number = 0;
  last_server_time: number = 0;

  constructor(options: ServerEntityManagerOpts<Entity, Worker>) {
    super();
    this.worker = options.worker;
    (this.worker.default_mem_usage as DataObject).entity_manager = this.mem_usage;
    this.create_func = options.create_func;
    this.max_ents_per_tick = options.max_ents_per_tick || 100;
    this.va_unload_time = options.va_unload_time || 10000;
    this.save_time = options.save_time || 10000;
    this.load_func = options.load_func || entityManagerDefaultLoadEnts.bind(null, options.serialized_ent_version || 0);
    this.save_func = options.save_func || entityManagerDefaultSaveEnts.bind(null, options.serialized_ent_version || 0);
    this.load_player_func = options.load_player_func || entityServerDefaultLoadPlayerEntity.bind(null, {}) as
      EntLoadPlayerFunc<Entity, Worker>;
    this.schema = [];
    this.all_client_fields = {};
    this.field_defs_by_id = [null];
    let { all_client_fields, field_defs_by_id } = this;
    for (let key in entity_field_defs) {
      let field_def = entity_field_defs[key]!;
      if (!field_def.server_only) {
        assert(field_def.field_id);
        let index = field_def.field_id - EntityFieldSpecial.MAX;
        assert(!this.schema[index]);
        let schema_def: EntityFieldDefSerialized = {
          n: key,
        };
        if (field_def.encoding !== EntityFieldEncoding.JSON) {
          schema_def.e = field_def.encoding;
        }
        if (field_def.default_value !== undefined) {
          schema_def.d = field_def.encoding;
        }
        if (field_def.sub !== EntityFieldSub.None) {
          schema_def.s = field_def.sub;
        }
        this.schema[index] = schema_def;
        all_client_fields[key] = true;
        field_defs_by_id[field_def.field_id] = field_def;
      }
    }
    // Ensure we properly filled in the schema
    for (let ii = 0; ii < this.schema.length; ++ii) {
      assert(this.schema[ii]);
    }
  }

  hasClient(client_id: ClientID): boolean {
    return Boolean(this.clients[client_id]);
  }

  getClient(client_id: ClientID): SEMClient {
    let client = this.clients[client_id];
    assert(client);
    return client;
  }

  getEntityForClient(client: SEMClient): Entity | undefined {
    return this.entities[client.ent_id];
  }

  visibleAreaReset(vaid: VAID, resp_func: NetErrorCallback<string>): void {
    let old_va_check = this.visible_areas[vaid];
    if (!old_va_check) {
      return void resp_func('VisibleArea not loaded');
    }
    let old_va = old_va_check;
    if (old_va.loading) {
      return void resp_func('VisibleArea still loading');
    }

    let { entities } = old_va;
    for (let ent_id_string in entities) {
      let ent = entities[ent_id_string]!;
      if (!ent.is_player) {
        assert.equal(ent.current_vaid, vaid);
        this.deleteEntity(ent.id, 'debug');
      }
    }

    this.worker.log(`Reinitializing VisibleArea ${vaid}: Asking worker to initialize`);
    this.emit('visible_area_init', vaid);

    resp_func(null, 'VisibleArea re-initialized');
  }

  // Called on an entity-less, already joined, client
  clientAddEntity(
    src: ClientHandlerSource,
    client: SEMClient,
    player_uid: string | null,
    join_payload: JoinPayload,
    on_ent_load_cb: (ent: Entity) => void,
  ): void {
    assert(client);
    let { client_id } = client;
    assert.equal(this.clients[client_id], client);
    assert(!client.loading);
    let sub_id = this.worker.getSubscriberId(src.channel_id);
    loadPlayerEntity(this, src, join_payload, client, player_uid, (err, ent_id) => {
      if (err) {
        // Just leave them entity-less?
        this.worker.logSrc(src, `${client_id}: clientAddEntity failed: ${err}`);
        return;
      }
      assert(ent_id);
      let ent = this.entities[ent_id];
      assert(ent);
      on_ent_load_cb(ent);
      this.worker.debugSrc(src, `${client_id}: clientAddEntity success: ent_id=${ent_id}, sub_id="${sub_id}"`);
      this.worker.sendChannelMessage(`client.${client_id}`, 'ent_id_change', {
        ent_id,
        sub_id,
      });
    });
  }

  numClients(): number {
    return this.mem_usage.clients.count;
  }

  clientJoin(
    src: ClientHandlerSource,
    player_uid: string | null,
    join_payload: JoinPayload,
  ): void {
    let { id: client_id } = src;
    assert(!this.clients[client_id]);
    let client = this.clients[client_id] = new SEMClientImpl(client_id);
    this.mem_usage.clients.count++;
    let sub_id = this.worker.getSubscriberId(src.channel_id);
    loadPlayerEntity(this, src, join_payload, client, player_uid, (err, ent_id) => {
      if (err) {
        // Immediately failed, remove this client
        this.clientLeave(client_id);
        this.worker.logSrc(src, `${client_id}: clientJoin failed: ${err}`);
        // TODO: send error to client?
        return;
      }

      this.worker.debugSrc(src, `${client_id}: clientJoin success: ent_id=${ent_id}, sub_id="${sub_id}"`);
      // Immediately let client know their entity ID, and notify that they are
      //   now receiving entity updates (will not yet have own entity yet, though)
      this.worker.sendChannelMessage(`client.${client_id}`, 'ent_start', {
        ent_id,
        sub_id,
      });
      // Join and initialize appropriate visible areas
      this.clientSetVisibleAreaSeesInternal(client, this.worker.semClientInitialVisibleAreaSees(join_payload, client));
      this.sendInitialEntsToClient(client, false, () => {
        // By now, client has already received the initial update for all relevant
        //   entities (should include own entity, if they have one)
        this.worker.sendChannelMessage(`client.${client_id}`, 'ent_ready');
      });
    });
  }

  clientLeave(client_id: ClientID): void {
    let client = this.clients[client_id];
    if (!client) {
      // ignore, maybe subscribed to the worker, never actually joined the entity
      //   manager, or was kicked
      return;
    }
    if (client.loading) {
      client.left_while_loading = true;
      // This function will be called again when loading flag is cleared
      return;
    }
    this.clientSetVisibleAreaSeesInternal(client, []);
    this.clientRemoveEntityInternal(client, 'disconnect');
    delete this.clients[client.client_id];
    this.mem_usage.clients.count--;
  }

  clientRemoveEntityInternal(client: SEMClient, reason: string): void {
    // Remove the client's entity, but keep the client joined and receiving updates
    let { player_uid, ent_id } = client;
    if (player_uid) {
      if (ent_id) {
        let ent = this.entities[ent_id];
        assert(ent);
        if (ent.need_save) {
          ent.savePlayerEntity(nop);
        }
        ent.releasePlayerEntity();
        this.deleteEntity(ent_id, reason);

        client.ent_id = 0;
      }
      if (player_uid) {
        delete this.player_uid_to_client[player_uid];
        client.player_uid = null;
      }
    }
  }

  clientRemoveEntity(client: SEMClient, reason: string): void {
    if (client.loading) {
      client.removed_ent_while_loading = true;
      // clientRemoveEntityInternal() will be called when loading flag is cleared
      return;
    }
    this.clientRemoveEntityInternal(client, reason);
    let channel_id = `client.${client.client_id}`;
    let sub_id = this.worker.getSubscriberId(channel_id);
    this.worker.sendChannelMessage(channel_id, 'ent_id_change', {
      ent_id: 0,
      sub_id,
    });
  }

  deleteEntityFinish(va: VARecord<Entity>, ent: Entity): void {
    let { id: ent_id } = ent;
    let { entities: va_entities } = va;
    let { entities: sem_entities } = this;
    if (ent.in_dirty_list) {
      let idx = this.dirty_list.indexOf(ent);
      assert(idx !== -1);
      this.dirty_list.splice(idx, 1);
      ent.in_dirty_list = false;
    }
    delete sem_entities[ent_id];
    delete va_entities[ent_id];
    this.mem_usage.entities.count--;
  }

  deleteEntityInternal(ent: Entity): void {
    let { current_vaid } = ent;
    let va = this.visible_areas[current_vaid];
    assert(va);
    this.deleteEntityFinish(va, ent);
  }

  deleteEntity(ent_id: EntityID, reason: string): void {
    assert.equal(typeof ent_id, 'number');
    let ent = this.entities[ent_id];
    assert(ent);
    let { last_vaid } = ent;
    if (last_vaid !== undefined) { // has had an update sent
      let dels = this.ent_deletes[last_vaid] = this.ent_deletes[last_vaid] || [];
      dels.push([ent_id, reason]);
      if (!ent.is_player) {
        this.visible_areas_need_save[last_vaid] = true;
      }
    }

    this.deleteEntityInternal(ent);
  }

  addEntityInternal(ent: Entity): void {
    let { entities: sem_entities } = this;
    assert(ent.id);
    assert(ent.current_vaid !== undefined);
    assert.equal(ent.visibleAreaGet(), ent.current_vaid);
    assert(!sem_entities[ent.id]);
    let va = this.vaGetRecord(ent.current_vaid);
    let { entities: va_entities } = va;
    assert(!va_entities[ent.id]);
    sem_entities[ent.id] = ent;
    va_entities[ent.id] = ent;
    this.mem_usage.entities.count++;
  }

  createEntity(data: DataObject): Entity {
    let ent = this.create_func(data);
    ent.id = ++this.last_ent_id;
    ent.entity_manager = this;
    ent.finishCreation();
    return ent;
  }

  addEntityFromSerialized(data: DataObject): void {
    let ent = this.createEntity(data);
    assert(!ent.is_player);
    ent.fixupPostLoad();

    this.addEntityInternal(ent);
    this.visible_areas_need_save[ent.current_vaid] = true;

    // Add to dirty list so full update gets sent to all subscribers
    addToDirtyList(this, ent);
  }

  handleActionList(src: ClientHandlerSource, pak: Packet, resp_func: NetResponseCallback<ActionListResponse>): void {
    let count = pak.readInt();
    let actions = [];
    for (let ii = 0; ii < count; ++ii) {
      let flags = pak.readInt();
      let action_data = {} as ActionMessageParam;
      action_data.action_id = pak.readAnsiString();
      if (flags & EALF_HAS_PREDICATE) {
        let field = pak.readAnsiString();
        let expected_value = pak.readAnsiString();
        action_data.predicate = { field, expected_value };
      }
      if (flags & EALF_HAS_ENT_ID) {
        action_data.ent_id = pak.readInt();
      } else {
        action_data.self = true;
      }
      if (flags & EALF_HAS_PAYLOAD) {
        action_data.payload = pak.readJSON();
      }
      if (flags & EALF_HAS_ASSIGNMENTS) {
        action_data.data_assignments = {};
        let field_id;
        while ((field_id = pak.readInt())) {
          let do_default = field_id === EntityFieldSpecial.Default;
          if (do_default) {
            field_id = pak.readInt();
          }
          let field_def = this.field_defs_by_id[field_id];
          assert(field_def);
          let { decoder, sub, field_name, default_value } = field_def;
          assert(!sub); // TODO: support
          let new_value = do_default ? default_value === undefined ? null : default_value : decoder(pak, null);
          action_data.data_assignments[field_name] = new_value;
        }
      }
      actions.push(action_data);
    }
    if (ENTITY_LOG_VERBOSE) {
      this.worker.debugSrc(src, `${src.id}: ent_action_list(${count}): ${logdata(actions)}`);
    }
    let results: undefined | ActionListResponse;
    asyncEach(actions, (action_data, next, idx) => {
      function returnResult(err?: string | null, data?: unknown): void {
        if (data !== undefined || err) {
          results = results || [];
          if (!err) {
            err = undefined;
          }
          results[idx] = { err, data };
        }
        next();
      }
      if (action_data.self) {
        assert(src);
        let { id: client_id } = src;
        let client = this.clients[client_id];
        if (!client || !client.ent_id) {
          let msg = `${src.id}: ent_action_list:${action_data.action_id}: ERR_NO_ENTITY`;
          if (client && client.ever_had_ent_id) {
            this.worker.debugSrc(src, msg);
          } else {
            this.worker.warnSrc(src, msg);
          }
          return void returnResult('ERR_NO_ENTITY');
        }
        action_data.ent_id = client.ent_id;
      }
      let ent_id = action_data.ent_id;
      assert(ent_id);
      let ent = this.entities[ent_id];
      if (!ent) {
        return void returnResult('ERR_INVALID_ENT_ID');
      }
      (action_data as ActionHandlerParam).src = src;
      ent.handleAction(action_data as ActionHandlerParam, returnResult);
    }, (err?: string | null) => {
      resp_func(err, results);
    });
  }

  dirty(ent: Entity, field: string, delete_reason: string | null): void {
    if (!ent.in_dirty_list) {
      addToDirtyList(this, ent);
    }
    ent.dirty_fields[field] = true;
    ent.need_save = true;
    let vaid = ent.visibleAreaGet();
    if (vaid !== ent.current_vaid) {
      let oldva = this.vaGetRecord(ent.current_vaid);
      assert(oldva.entities[ent.id]);
      delete oldva.entities[ent.id];
      ent.current_vaid = vaid;
      let newva = this.vaGetRecord(ent.current_vaid);
      newva.entities[ent.id] = ent;
    }
    if (!ent.is_player) {
      this.visible_areas_need_save[vaid] = true;
      if (vaid !== ent.last_vaid) {
        if (ent.last_vaid !== undefined) {
          this.visible_areas_need_save[ent.last_vaid] = true;
        }
      }
    }
    if (delete_reason) {
      ent.last_delete_reason = delete_reason;
    }
  }

  dirtySub(ent: Entity, field: string, index: string | number): void {
    let sub = ent.dirty_sub_fields[field];
    if (!sub) {
      sub = ent.dirty_sub_fields[field] = {};
    }
    sub[index] = true;
    this.dirty(ent, field, null);
  }

  vaRemoveFromUnseenSet(vaid: VAID, va: VARecord<Entity>): void {
    assert(va.in_unseen_set);
    va.in_unseen_set = false;
    delete this.visible_areas_unseen[vaid];
    va.last_needed_timestamp = 0;
  }
  vaAddToUnseenSet(vaid: VAID, va: VARecord<Entity>): void {
    assert(!va.in_unseen_set);
    va.last_needed_timestamp = this.last_server_time;
    va.in_unseen_set = true;
    this.visible_areas_unseen[vaid] = true;
  }

  vaGetRecord(vaid: VAID): VARecord<Entity> {
    let va = this.visible_areas[vaid];
    if (!va) {
      visibleAreaInit(this, vaid);
      va = this.visible_areas[vaid];
    }
    assert(va);
    return va;
  }

  clientSetVisibleAreaSeesInternal(client: SEMClient, new_visible_areas: VAID[]): void {
    for (let ii = 0; ii < new_visible_areas.length; ++ii) {
      let vaid = new_visible_areas[ii];
      let va = this.vaGetRecord(vaid);
      va.client_count++;
      if (va.in_unseen_set) {
        this.vaRemoveFromUnseenSet(vaid, va);
      }
    }
    let old = client.visible_area_sees;
    for (let ii = 0; ii < old.length; ++ii) {
      let vaid = old[ii];
      let va = this.visible_areas[vaid];
      assert(va);
      va.client_count--;
      if (!va.client_count) {
        this.vaAddToUnseenSet(vaid, va);
      }
    }
    client.visible_area_sees = new_visible_areas;
  }

  // Optional resp_func called when all full updates have been sent to the client,
  // but dirty ents still pending, likely including one's own entity.
  clientSetVisibleAreaSees(client: SEMClient, new_visible_areas: VAID[], resp_func?: NetErrorCallback<never>): void {
    this.clientSetVisibleAreaSeesInternal(client, new_visible_areas);
    this.sendInitialEntsToClient(client, true, resp_func);
  }

  private unloadVA(vaid: VAID): void {
    // unload all relevant entities and other tracking structures
    let va = this.visible_areas[vaid];
    assert(va);
    assert(!va.loading);
    assert(!this.visible_areas_need_save[vaid]);
    assert(!this.visible_area_broadcasts[vaid]);
    let { entities: va_entities } = va;
    let count = 0;
    for (let ent_id_string in va_entities) {
      let ent = va_entities[ent_id_string]!;
      if (ent.is_player) {
        continue;
      }
      let { current_vaid, last_vaid } = ent;
      assert.equal(current_vaid, vaid);
      assert.equal(current_vaid, last_vaid); // Shouldn't be mid-move if this is getting unloaded!
      this.deleteEntityFinish(va, ent);
      ++count;
    }
    delete this.visible_areas[vaid];
    delete this.visible_areas_unseen[vaid];
    this.mem_usage.va.count--;
    this.worker.debug(`Unloaded VA ${vaid} (${count} entities)`);
  }

  last_unload_time: number = 0;
  private unloadUnseenVAs(): void {
    let unload_time = this.last_server_time - this.va_unload_time;
    if (this.last_unload_time > unload_time) {
      // Did an unload recently, nothing this tick
      return;
    }
    this.last_unload_time = unload_time;
    let { visible_areas_unseen, visible_areas, visible_areas_need_save } = this;
    for (let vaid_string in visible_areas_unseen) {
      let vaid = Number(vaid_string);
      let va = visible_areas[vaid];
      assert(va);
      if (!va.loading && va.last_needed_timestamp < unload_time && !visible_areas_need_save[vaid]) {
        this.unloadVA(vaid);
      }
    }
  }

  private flushChangesToDataStores(): void {
    if (this.flushing_changes) {
      return;
    }
    if (this.last_server_time - this.last_save_time < this.save_time) {
      return;
    }
    this.last_save_time = this.last_server_time;
    this.flushing_changes = true;
    let left = 1;
    let self = this;
    function done(): void {
      if (!--left) {
        self.flushing_changes = false;
      }
    }

    // Go through all need_save entities and batch them up to user stores and bulk store
    // First, save player entities (not VA-specific)
    let { clients, entities: sem_entities } = this;
    // PERFTODO: Add "need save" list for players instead of iterating all?
    for (let client_id in clients) {
      let client = clients[client_id]!;
      if (client.ent_id) {
        let ent = sem_entities[client.ent_id];
        assert(ent);
        assert(ent.is_player);
        if (ent.need_save) {
          ++left;
          ent.savePlayerEntity(done);
          ent.need_save = false;
        }
      }
    }
    // Second, save each VA's entities
    let { visible_areas_need_save } = this;
    this.visible_areas_need_save = {};
    for (let vaid_string in visible_areas_need_save) {
      let vaid = Number(vaid_string);
      let va = this.vaGetRecord(vaid);
      if (va.loading) {
        // Trying to save entities in an area that is not loaded?  something must
        //   have moved out of view into an unloaded VA
        // still loading, cannot save yet
        // re-add for next flush
        this.visible_areas_need_save[vaid] = true;
        // also don't flush until this is loaded
        ++left;
        va.loading.push(done);
        continue;
      }

      let ents = [];
      let { entities: va_entities } = va;
      for (let ent_id_string in va_entities) {
        let ent = va_entities[ent_id_string]!;
        if (!ent.is_player) {
          assert.equal(vaid, ent.current_vaid);
          ents.push(ent);
        }
      }

      // If it's in the unseen list, flag it as still needed
      va.last_needed_timestamp = this.last_server_time;

      ++left;
      let ent_data = ents.map(toSerializedStorage);
      this.save_func(this.worker, vaid, ent_data, done);
    }

    done();
  }

  broadcast(ent: Entity, msg: string, data: unknown): void {
    let vaid = ent.visibleAreaGet();
    let list = this.visible_area_broadcasts[vaid];
    if (!list) {
      list = this.visible_area_broadcasts[vaid] = [];
    }
    list.push({
      from: ent.id,
      msg,
      data,
    });
  }

  private sendFullEnts(
    client: SEMClient,
    new_ents: Entity[],
    deletes: EntDelete[][] | null,
  ): void {
    let debug: string[] | null = ENTITY_LOG_VERBOSE ? [] : null;
    let pak = this.worker.pak(`client.${client.client_id}`, 'ent_update', null, 1);
    pak.writeU8(EntityUpdateCmd.IsInitialList);
    if (!client.has_schema) {
      client.has_schema = true;
      pak.writeU8(EntityUpdateCmd.Schema);
      pak.writeJSON(this.schema);
    }
    for (let ii = 0; ii < new_ents.length; ++ii) {
      let ent = new_ents[ii];
      this.addFullEntToPacket(pak, debug, ent);
    }
    if (deletes) {
      for (let ii = 0; ii < deletes.length; ++ii) {
        let dels = deletes[ii];
        for (let jj = 0; jj < dels.length; ++jj) {
          let pair = dels[jj];
          let [ent_id, reason] = pair;
          if (debug) {
            debug.push(`${ent_id}:X(${reason})`);
          }
          pak.writeU8(EntityUpdateCmd.Delete);
          pak.writeInt(ent_id);
          pak.writeAnsiString(reason);
        }
      }
    }
    pak.writeU8(EntityUpdateCmd.Terminate);
    if (ENTITY_LOG_VERBOSE) {
      this.worker.debug(`->${client.client_id}: ent_update(initial) ${debug!.join(';')}`);
    }
    pak.send();
  }

  private sendInitialEntsToClient(
    client: SEMClient,
    needs_deletes: boolean,
    cb?: NetErrorCallback<never>,
  ): void {
    let {
      known_entities,
      visible_area_sees: needed_areas,
    } = client;
    let left = 1;
    let any_err: string | null = null;
    function done(err?: string): void {
      if (!any_err && err) {
        any_err = err;
      }
      if (!--left) {
        if (cb) {
          cb(any_err);
        }
      }
    }
    let sync_ents: Entity[] | null = [];
    needed_areas.forEach((vaid) => {
      ++left;
      visibleAreaInit(this, vaid, (err?: string | null) => {
        if (err) {
          return void done(err); // not expected
        }

        let new_ents: Entity[] = sync_ents || [];
        newEntsInVA(this, new_ents, vaid, known_entities);
        if (!sync_ents && new_ents.length) {
          // send immediately (was an async load)
          this.sendFullEnts(client, new_ents, null);
        }
        done();
      });
    });

    let my_ent = this.getEntityForClient(client);

    let all_dels: EntDelete[][] | null = null;
    if (needs_deletes) {
      let dels: EntDelete[] = [];
      for (let ent_id_str in known_entities) {
        let ent_id = Number(ent_id_str);
        let other_ent = this.entities[ent_id];
        if (other_ent === my_ent) {
          // Never delete own entity
          continue;
        }
        if (!other_ent) {
          // Presumably there is a delete queued, possibly in the VA we just left.
          // Could look up why somewhere in ent_deletes, but presumably they're now
          //   out of view anyway, so just sending 'unknown'
          // TODO: This might go slightly wrong if there's an unrelated delete
          //   right near us on the same frame we transition!  Maybe need to do
          //   something smarter (either here or on the client when it next receives
          //   an update packet)
          dels.push([ent_id, 'unknown']);
          delete known_entities[ent_id];
        } else {
          let { last_vaid, current_vaid } = other_ent;
          // Delete this entity if either the current or last VAID is in an area we no longer see.
          // If it just transitioned from last(seen) to current(unseen), we would get the delete later
          // If it just transitioned from last(just now unseen) to current(unseen) we would never get the delete
          // If it just transitioned from last(unseen) to current(seen), we would not get a delete if it transitions
          //    back to last(unseen) between now and when the updates are broadcast
          if (last_vaid !== undefined && !needed_areas.includes(last_vaid) || !needed_areas.includes(current_vaid)) {
            dels.push([ent_id, 'oldva']);
            delete known_entities[ent_id];
          }
        }
      }
      if (dels.length) {
        if (!all_dels) {
          all_dels = [];
        }
        all_dels.push(dels);
      }
    }

    if (my_ent && !known_entities[my_ent.id]) {
      // Always send own entity if it is currently unknown
      known_entities[my_ent.id] = true;
      sync_ents.push(my_ent);
    }

    if (sync_ents.length || all_dels) {
      this.sendFullEnts(client, sync_ents, all_dels);
    }

    sync_ents = null;
    done();
  }

  private addFullEntToPacket(pak: Packet, debug_out: string[] | null, ent: Entity): void {
    let { all_client_fields } = this;
    pak.writeU8(EntityUpdateCmd.Full);
    pak.writeInt(ent.id);

    let data: DataObject = ent.data;
    let debug: string[] | null = debug_out ? [] : null;

    for (let field in all_client_fields) {
      let field_def = entity_field_defs[field];
      assert(field_def);
      let { field_id, sub, encoder, default_value } = field_def;
      assert(typeof field_id === 'number');
      let value = data[field];
      if (value === default_value) {
        continue;
      }
      if (sub) {
        if (debug) {
          debug.push(field);
        }
        pak.writeInt(field_id);
        if (sub === EntityFieldSub.Array) {
          assert(Array.isArray(value));
          for (let index = 0; index < value.length; ++index) {
            pak.writeInt(index + 1);
            let sub_value = value[index];
            encoder(ent, pak, sub_value, false);
          }
          pak.writeInt(0);
        } else { // EntityFieldSub.Record
          assert(value && typeof value === 'object' && !Array.isArray(value));
          let keys = Object.keys(value);
          for (let ii = 0; ii < keys.length; ++ii) {
            let key = keys[ii];
            let sub_value = (value as DataObject)[key];
            pak.writeAnsiString(key);
            encoder(ent, pak, sub_value, false);
          }
          pak.writeAnsiString('');
        }
      } else {
        if (debug) {
          debug.push(field);
        }
        pak.writeInt(field_id);
        encoder(ent, pak, value, false);
      }
    }
    if (debug_out) {
      debug_out.push(`${ent.id}:${debug!.join()}`);
    }
    pak.writeInt(EntityFieldSpecial.Terminate);
  }

  private addDiffToPacket(per_va: PerVAUpdate, ent: Entity): boolean {
    let data: DataObject = ent.data;
    let wrote_header = false;
    let pak!: Packet; // Initialized with wrote_header
    let debug = [];
    let { dirty_fields, dirty_sub_fields } = ent;

    // Clear these *before* iterating, in case of crash, don't crash repeatedly!
    ent.dirty_fields = {};
    ent.dirty_sub_fields = {};


    for (let field in dirty_fields) {
      let field_def = entity_field_defs[field];
      assert(field_def);
      let { server_only, field_id, sub, encoder, default_value } = field_def;
      if (server_only) {
        continue;
      }
      assert(typeof field_id === 'number');
      if (!wrote_header) {
        if (!pak) {
          if (!per_va.pak) {
            per_va.pak = packetCreate();
          }
          pak = per_va.pak;
        }
        pak.writeU8(EntityUpdateCmd.Diff);
        pak.writeInt(ent.id);
        wrote_header = true;
      }
      debug.push(field);
      let value = data[field];
      if (sub) {
        pak.writeInt(field_id);
        let dirty_sub = dirty_sub_fields[field];
        assert(dirty_sub);
        if (sub === EntityFieldSub.Array) {
          assert(Array.isArray(value));
          for (let index_string in dirty_sub) {
            if (index_string === 'length') {
              pak.writeInt(-1);
              pak.writeInt(value.length);
            } else {
              let index = Number(index_string);
              assert(isFinite(index));
              pak.writeInt(index + 1);
              let sub_value = value[index];
              encoder(ent, pak, sub_value, true);
            }
          }
          pak.writeInt(0);
        } else { // EntityFieldSub.Record
          assert(value && typeof value === 'object' && !Array.isArray(value));
          for (let key in dirty_sub) {
            let sub_value = (value as DataObject)[key];
            pak.writeAnsiString(key);
            encoder(ent, pak, sub_value, true);
          }
          pak.writeAnsiString('');
        }
      } else {
        if (value === default_value) {
          pak.writeInt(EntityFieldSpecial.Default);
          pak.writeInt(field_id);
        } else {
          pak.writeInt(field_id);
          encoder(ent, pak, value, true);
        }
      }
    }
    if (wrote_header) {
      per_va.debug.push(`${ent.id}:${debug.join()}`);
      pak.writeInt(EntityFieldSpecial.Terminate);
    }
    return wrote_header;
  }

  update_per_va!: Partial<Record<VAID, PerVAUpdate>>;

  private prepareUpdate(ent: Entity): void {
    let vaid = ent.current_vaid;
    assert.equal(vaid, ent.visibleAreaGet()); // Should have been updated upon call to .dirty()

    let { update_per_va } = this;

    let per_va = update_per_va[vaid];
    if (!per_va) {
      per_va = update_per_va[vaid] = {
        ent_ids: [],
        pak: null,
        debug: [],
      };
    }
    let had_diff = this.addDiffToPacket(per_va, ent);

    let vaid_changed = vaid !== ent.last_vaid;
    if (vaid_changed) {
      // If they existed elsewhere, add a transit delete
      if (ent.last_vaid !== undefined) {
        let dels = this.ent_deletes[ent.last_vaid];
        if (!dels) {
          dels = this.ent_deletes[ent.last_vaid] = [];
        }
        dels.push([ent.id, ent.last_delete_reason || 'newva']);
      }
      ent.last_vaid = vaid;
    }

    if (had_diff || vaid_changed) {
      // Even if no diff, if the VAID changed (or was undefined), we may need to send full updates to some clients
      per_va.ent_ids.push(ent.id);
    }

    // Clean up per-tick state
    ent.in_dirty_list = false;
    ent.last_delete_reason = undefined;
  }

  private prepareNonEntUpdates(): void {
    let { update_per_va } = this;
    let any = false;
    for (let vaid in this.visible_area_broadcasts) {
      let broadcasts = this.visible_area_broadcasts[vaid]!;
      let per_va = update_per_va[vaid];
      if (!per_va) {
        per_va = update_per_va[vaid] = {
          ent_ids: [],
          pak: null,
          debug: [],
        };
      }
      if (!per_va.pak) {
        per_va.pak = packetCreate();
      }
      let pak = per_va.pak;
      for (let ii = 0; ii < broadcasts.length; ++ii) {
        let event = broadcasts[ii];
        pak.writeU8(EntityUpdateCmd.Event);
        pak.writeJSON(event);
      }
      any = true;
    }
    if (any) {
      this.visible_area_broadcasts = {};
    }
  }

  private gatherUpdates(client: SEMClient): void {
    let { update_per_va } = this;
    let { visible_area_sees: needed_areas, known_entities } = client;
    let va_updates: PerVAUpdate[] | undefined;
    let va_deletes: EntDelete[][] | undefined;
    let new_ents: EntityID[] | undefined;
    for (let ii = 0; ii < needed_areas.length; ++ii) {
      let vaid = needed_areas[ii];
      let per_va = update_per_va[vaid];
      if (per_va) {
        if (per_va.pak) {
          va_updates = va_updates || [];
          va_updates.push(per_va);
        }
        for (let jj = 0; jj < per_va.ent_ids.length; ++jj) {
          let ent_id = per_va.ent_ids[jj];
          if (!known_entities[ent_id]) {
            known_entities[ent_id] = true;
            if (!new_ents) {
              new_ents = [];
            }
            new_ents.push(ent_id);
          }
        }
      }
      let dels = this.ent_deletes[vaid];
      if (dels) {
        va_deletes = va_deletes || [];
        va_deletes.push(dels);
      }
    }

    if (va_updates || va_deletes || new_ents) {
      let pak = this.worker.pak(`client.${client.client_id}`, 'ent_update', null, 1);
      if (!client.has_schema) {
        client.has_schema = true;
        pak.writeU8(EntityUpdateCmd.Schema);
        pak.writeJSON(this.schema);
      }
      let debug: string[] | null = ENTITY_LOG_VERBOSE ? [] : null;
      if (va_updates) {
        for (let ii = 0; ii < va_updates.length; ++ii) {
          let per_va = va_updates[ii];
          if (per_va.pak) {
            pak.append(per_va.pak);
          }
          if (debug) {
            debug = debug.concat(per_va.debug);
          }
        }
      }
      if (va_deletes) {
        for (let ii = 0; ii < va_deletes.length; ++ii) {
          let dels = va_deletes[ii];
          for (let jj = 0; jj < dels.length; ++jj) {
            let pair = dels[jj];
            let [ent_id, reason] = pair;
            if (known_entities[ent_id]) {
              let current_ent = this.entities[ent_id];
              if (
                // It's a transit delete, and to a VA we are not watching
                current_ent && !needed_areas.includes(current_ent.current_vaid) ||
                // Or, it's a full delete
                !current_ent
              ) {
                if (debug) {
                  debug.push(`${ent_id}:X(${reason})`);
                }
                pak.writeU8(EntityUpdateCmd.Delete);
                pak.writeInt(ent_id);
                pak.writeAnsiString(reason);
                delete known_entities[ent_id];
              }
            }
          }
        }
      }
      if (new_ents) {
        for (let ii = 0; ii < new_ents.length; ++ii) {
          let ent_id = new_ents[ii];
          let ent = this.entities[ent_id];
          assert(ent);
          this.addFullEntToPacket(pak, debug, ent);
        }
      }
      pak.writeU8(EntityUpdateCmd.Terminate);
      if (ENTITY_LOG_VERBOSE) {
        // TODO: logging is probably too verbose, combine to summary for all updates sent?
        this.worker.debug(`->${client.client_id}: ent_update(tick) ${debug!.join(';')}`);
      }
      pak.send();
    }
  }

  tick(dt: number, server_time: number): void {
    this.last_server_time = server_time;
    this.update_per_va = {};
    let { clients, dirty_list, max_ents_per_tick, update_per_va } = this;

    let ent_count = min(max_ents_per_tick, dirty_list.length);
    // Clearing dirty list _before_ iterating, in case of crash (leave some possibly
    //   out of sync entities instead of repeatedly crashing on them every tick).
    if (ent_count === dirty_list.length) {
      this.dirty_list = [];
    } else {
      this.dirty_list = dirty_list.slice(ent_count);
    }
    for (let dirty_idx = 0; dirty_idx < ent_count; ++dirty_idx) {
      let ent = dirty_list[dirty_idx];
      this.prepareUpdate(ent);
    }

    this.prepareNonEntUpdates();

    for (let client_id in clients) {
      this.gatherUpdates(clients[client_id]!);
    }

    // Reset / clear state
    for (let vaid in update_per_va) {
      let per_va = update_per_va[vaid]!;
      if (per_va.pak) {
        per_va.pak.pool();
      }
    }
    for (let vaid in this.ent_deletes) {
      delete this.ent_deletes[vaid];
    }

    if (!this.flushing_changes) {
      this.unloadUnseenVAs();
    }
    this.flushChangesToDataStores();
    this.update_per_va = null!; // only valid/used inside `tick()`, release references so they can be GC'd
  }

  // PERFTODO: Find by VAID API
  entitiesFind(
    predicate: (ent: Entity) => boolean,
    skip_fading_out?: boolean
  ): Entity[] {
    let { entities } = this;
    let ret = [];
    for (let ent_id_string in entities) {
      let ent = entities[ent_id_string]!;
      if (!predicate(ent)) {
        continue;
      }
      ret.push(ent);
    }
    return ret;
  }

  entitiesReload(predicate?: (ent: Entity) => boolean): Entity[] {
    let ret: Entity[] = [];
    // TODO: destroy and recreate all existing entities under new IDs, except for players?
    // let { entities } = this;
    // for (let ent_id_string in entities) {
    //   let ent = entities[ent_id_string]!;
    //   if (predicate && !predicate(ent)) {
    //     continue;
    //   }
    //   let new_ent = this.create_func(ent.data);
    //   new_ent.id = ent.id;
    //   new_ent.entity_manager = this;
    //   // Invalidate old ent
    //   ent.id = 0;
    //   ent.entity_manager = null!;
    //   entities[ent_id_string] = new_ent;
    //   ret.push(new_ent);
    // }
    return ret;
  }

}

export function createServerEntityManager<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>(
  options: ServerEntityManagerOpts<Entity, Worker>
): ServerEntityManager<Entity, Worker> {
  return new ServerEntityManagerImpl<Entity, Worker>(options);
}

export function entityManagerChatDecorateData<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>(
  worker: Worker,
  data_saved: ChatMessageDataSaved,
  data_broadcast: ChatMessageDataBroadcast,
): void {
  if (data_broadcast.client_id) {
    if (worker.entity_manager.hasClient(data_broadcast.client_id)) {
      let client = worker.entity_manager.getClient(data_broadcast.client_id);
      if (client.ent_id) {
        data_broadcast.ent_id = client.ent_id;
      }
    }
  }
}

// TODO: should get this from ChannelWorker automatically after channel_worker.js is converted to TypeScript
type TickableWorker = {
  tick?(dt: number, server_time: number): void;
};

export function entityManagerWorkerInit<
  Entity extends EntityBaseServer,
  Worker extends EntityManagerReadyWorker<Entity, Worker>,
>(ctor: typeof ChannelWorker, no_proto_extend?: boolean): void {
  if (!no_proto_extend && !(ctor.prototype as TickableWorker).tick) {
    // Add a default tick function if the worker does not have one
    (ctor.prototype as TickableWorker).tick = function tick(
      this: Worker,
      dt: number,
      server_time: number
    ): void {
      this.entity_manager.tick(dt, server_time);
    };
  }
  if (!no_proto_extend && !(ctor.prototype as ChattableWorker).chatDecorateData) {
    // Add a default chatDecorateData function if the worker does not have one
    (ctor.prototype as ChattableWorker).chatDecorateData = function chatDecorateData(
      this: Worker,
      data_saved: ChatMessageDataSaved,
      data_broadcast: ChatMessageDataBroadcast,
    ): void {
      entityManagerChatDecorateData(this, data_saved, data_broadcast);
    };
  }
  ctor.registerClientHandler<Packet, ActionListResponse>('ent_action_list', function entityManagerHandleEntActionList(
    this: Worker,
    src: ClientHandlerSource,
    pak: Packet,
    resp_func: NetResponseCallback<ActionListResponse>
  ): void {
    this.entity_manager.handleActionList(src, pak, resp_func);
  });
}
