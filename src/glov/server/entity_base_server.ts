// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export let entity_field_defs: Partial<Record<string, EntityFieldDef>> = Object.create(null);

import assert from 'assert';
import { asyncSeries } from 'glov-async';
import {
  ActionMessageParam,
  ClientID,
  EntityBaseCommon,
  EntityBaseDataCommon,
  EntityFieldDecoder,
  EntityFieldDefCommon,
  EntityFieldEncoder,
  EntityFieldEncoding,
  EntityFieldSpecial,
  EntityFieldSub,
  EntityManagerEvent,
  entity_field_decoders,
  entity_field_encoders,
} from 'glov/common/entity_base_common';
import {
  ClientHandlerSource,
  DataObject,
  ErrorCallback,
  HandlerSource,
  NetErrorCallback,
  WithRequired,
} from 'glov/common/types';
import {
  clone,
  defaults,
  has,
  objectToSet,
} from 'glov/common/util';
import {
  JoinPayload,
  ServerEntityManagerInterface,
} from './entity_manager_server';

export type VAID = number; // Or, maybe `number | string`?

/*
  Note: Can extend this per-app with code like:

  declare module 'glov/server/entity_base_server' {
    interface EntityFieldDef {
      my_option?: boolean;
    }
  }

  And then reference these options in, e.g., the savePlayerEntity() override
*/
export interface EntityFieldDef extends EntityFieldDefCommon {
  ephemeral: boolean; // not saved to storage
  server_only: boolean; // not synced to clients
  // The following members are auto-filled, and only actually required for non-server_only fields
  encoder: EntityFieldEncoder<EntityBaseServer>; // Looked up by `encoding`, _not_ specified per-field, just cached here
  decoder: EntityFieldDecoder<EntityBaseServer>; // Looked up by `encoding`, _not_ specified per-field, just cached here
  field_id: number;
  field_name: string;
}
export type EntityFieldDefOpts = Partial<Exclude<EntityFieldDef, 'encoder'>>;

let last_field_id = EntityFieldSpecial.MAX - 1;
export function entityServerRegisterFieldDefs<DataObjectType>(
  defs: Record<keyof DataObjectType, EntityFieldDefOpts>
): void;
export function entityServerRegisterFieldDefs(defs: Record<string, EntityFieldDefOpts>): void {
  for (let key in defs) {
    let def_in = defs[key];
    // Construct an EntityFieldDef in a type-safe manner
    let ephemeral = def_in.ephemeral || false;
    let server_only = def_in.server_only || false;
    let default_value = def_in.default_value;
    let encoding = def_in.encoding || EntityFieldEncoding.JSON;
    let encoder = entity_field_encoders[encoding];
    assert(encoder, `Missing encoder for type ${encoding} referenced by field ${key}`);
    let decoder = entity_field_decoders[encoding];
    assert(decoder);
    let sub = def_in.sub || EntityFieldSub.None;
    if (sub) {
      assert(default_value === undefined, 'Default values not supported for Records/Arrays');
    }
    let field_id = server_only ? -1 : ++last_field_id;
    let def_out: EntityFieldDef = {
      ephemeral,
      server_only,
      encoding,
      default_value,
      sub,
      encoder,
      decoder,
      field_id,
      field_name: key,
    };

    // Then also copy all other app-specific fields
    defaults(def_out, def_in);

    assert(!entity_field_defs[key]);
    entity_field_defs[key] = def_out;
  }
}

export interface ActionHandlerParam extends WithRequired<ActionMessageParam, 'data_assignments' | 'self' | 'ent_id'> {
  src: ClientHandlerSource;
  predicate?: { field: string; expected_value: string }; // expected_value no longer optional
}

export type ActionHandler<Entity extends EntityBaseServer> = (
  this: Entity,
  param: ActionHandlerParam,
  resp_func: ErrorCallback<unknown, string>
) => void;

export type DataAssignmentType = 'number' | 'string' | 'array' | 'boolean' | 'object' | null;

export type ActionDef<Entity extends EntityBaseServer> = {
  self_only: boolean;
  allowed_data_assignments: Partial<Record<string, DataAssignmentType>>;
  allow_any_assignment?: boolean;
  handler?: ActionHandler<Entity>;
};

export interface ActionDefOpts<Entity extends EntityBaseServer>
  extends Partial<ActionDef<Entity>>
{
  action_id: string;
}

function actionDefDefaults<Entity extends EntityBaseServer>(
  action_def: Partial<ActionDefOpts<Entity>>
): asserts action_def is ActionDef<EntityBaseServer> {
  if (has(action_def, 'handler')) {
    // Has a handler member, but it's `undefined`, likely but with caller
    assert(action_def.handler, `Undefined function set for action ${action_def.action_id}`);
  }
  if (action_def.self_only === undefined) {
    action_def.self_only = true;
  }
  action_def.allow_any_assignment = action_def.allow_any_assignment || false;
  action_def.allowed_data_assignments = objectToSet(action_def.allowed_data_assignments);
}

let entity_action_defs: Partial<Record<string, ActionDef<EntityBaseServer>>> = Object.create(null);
export function entityServerRegisterActions<Entity extends EntityBaseServer>(
  action_defs: ActionDefOpts<Entity>[]
): void {
  action_defs.forEach((action_def) => {
    let { action_id } = action_def;
    assert(!entity_action_defs[action_id]);
    actionDefDefaults(action_def);
    entity_action_defs[action_id] = action_def;
  });
}

interface PlayerEntity extends EntityBaseServer {
  is_player: true;
  player_uid: string;
}

export type DirtyFields = Partial<Record<string, true>>;

export class EntityBaseServer extends EntityBaseCommon {
  declare entity_manager: ServerEntityManagerInterface;

  declare is_player: boolean; // on prototype
  in_dirty_list: boolean;
  dirty_fields: DirtyFields;
  dirty_sub_fields: Partial<Record<string, DirtyFields>>;
  need_save: boolean;
  player_uid?: string; // Only for player-type entities
  current_vaid!: VAID; // Initially set in finishCreation()
  last_vaid?: VAID;
  last_delete_reason?: string = undefined;

  constructor(data: EntityBaseDataCommon) {
    super(data);
    this.in_dirty_list = false;
    this.need_save = false;
    this.dirty_fields = {};
    this.dirty_sub_fields = {};
  }

  debugSrc(src: HandlerSource, ...args: unknown[]): void {
    this.entity_manager.worker.debugSrc(src, ...args);
  }
  infoSrc(src: HandlerSource, ...args: unknown[]): void {
    this.entity_manager.worker.infoSrc(src, ...args);
  }
  logSrc(src: HandlerSource, ...args: unknown[]): void {
    this.entity_manager.worker.logSrc(src, ...args);
  }
  warnSrc(src: HandlerSource, ...args: unknown[]): void {
    this.entity_manager.worker.warnSrc(src, ...args);
  }
  errorSrc(src: HandlerSource, ...args: unknown[]): void {
    this.entity_manager.worker.errorSrc(src, ...args);
  }

  getData<T>(field: string, deflt: T): T;
  getData<T>(field: string): T | undefined;
  getData(field: string, deflt?: unknown): unknown {
    return (this.data as DataObject)[field];
  }

  last_saved_data?: string;
  savePlayerEntity(cb: ErrorCallback): void {
    // Optional app-specific override
    let data = this.toSerializedStorage();
    let data_string = JSON.stringify(data);
    if (data_string === this.last_saved_data) {
      return void cb();
    }
    this.last_saved_data = data_string;
    this.entity_manager.worker.setBulkChannelData(`pent.${this.player_uid}`, data, cb);
  }

  // Note: this function is called immediately after savePlayerEntity(nop) (potentially before it has resolved)
  releasePlayerEntity(): void {
    // Optional app-specific override
    // Called immediately before delete, after last save has been issued (but not yet finished)
  }

  fixupPostLoad(): void {
    // Optional app-specific override
    // Also ran upon creation
  }

  isPlayer(): this is PlayerEntity {
    return this.is_player;
  }

  getClientID(): null | ClientID {
    if (!this.isPlayer()) {
      return null;
    }
    let sem = this.entity_manager;
    let { player_uid } = this;
    let client = sem.player_uid_to_client[player_uid];
    return client && client.client_id || null;
  }

  sendClientMessage(data: EntityManagerEvent): void {
    let client_id = this.getClientID();
    assert(client_id);
    this.entity_manager.worker.sendChannelMessage(`client.${client_id}`, 'ent_broadcast', data);
  }

  // Serialized when saving to the data store
  toSerializedStorage(): DataObject {
    let { data } = this;
    let ret: DataObject = {};
    for (let key in data) {
      let field_def = entity_field_defs[key];
      if (!field_def) {
        assert(field_def, `Missing field definition for ${key}`);
      }
      if (!field_def.ephemeral) {
        let value = (data as DataObject)[key];
        if (value !== field_def.default_value) {
          ret[key] = clone(value);
        }
      }
    }
    return ret;
  }

  // Needs to be called after child class's constructor finishes, not in base class's constructor
  finishCreation(): void {
    this.current_vaid = this.visibleAreaGet();
  }

  visibleAreaGet(): VAID {
    // App-specific override
    return 0;
  }

  dirty(field: string): void {
    this.entity_manager.dirty(this, field, null);
  }

  dirtySub(field: string, index: string | number): void {
    this.entity_manager.dirtySub(this, field, index);
  }

  dirtyVA(field: string, delete_reason: string | null): void {
    this.entity_manager.dirty(this, field, delete_reason);
  }

  handleAction(action_data: ActionHandlerParam, resp_func: NetErrorCallback<unknown>): void {
    let { action_id, ent_id, predicate, self, /*payload, */data_assignments, src } = action_data;

    // Validate
    let action_def = entity_action_defs[action_id];
    if (!action_def) {
      this.errorSrc(src, `Received invalid action_id=${action_id}`);
      return void resp_func('ERR_INVALID_ACTION');
    }

    let { allowed_data_assignments, allow_any_assignment, self_only, handler } = action_def;

    if (self) {
      assert.equal(ent_id, this.id);
    }

    if (self_only && !self) {
      this.errorSrc(src, `Received self_only action_id=${action_id} not on self`);
      return void resp_func('ERR_SELF_ONLY');
    }

    if (predicate) {
      let { field, expected_value } = predicate;
      let existing_value = (this.data as DataObject)[field];
      if (existing_value || expected_value) {
        if (existing_value !== expected_value) {
          this.debugSrc(src, `Rejecting action ${action_id} ` +
            `due to field "${field}" mismatch (was ${JSON.stringify(existing_value)}, ` +
            `expected ${JSON.stringify(expected_value)})`);
          return void resp_func('ERR_FIELD_MISMATCH');
        }
      }
    }

    for (let key in data_assignments) {
      let allowed_type = allowed_data_assignments[key];
      let provided_type = Array.isArray(data_assignments[key]) ? 'array' : typeof data_assignments[key];
      if (allow_any_assignment) {
        // OK
      } else if (allowed_type === null && data_assignments[key] === null) {
        // OK
      } else if (!allowed_type) {
        this.errorSrc(src, `Action ${action_id} attempted to set disallowed field "${key}"`);
        return void resp_func('ERR_INVALID_ASSIGNMENT');
      } else if (provided_type !== allowed_type) {
        this.errorSrc(src, `Action ${action_id} attempted to set field "${key}"` +
          ` to incorrect type (${provided_type})`);
        return void resp_func('ERR_INVALID_ASSIGNMENT');
      }
    }

    let result: unknown;
    asyncSeries([
      (next) => {
        // First attempt to execute action handler if there is one
        if (handler) {
          if (!data_assignments) {
            data_assignments = action_data.data_assignments = {}; // in case the handler wants to add some
          }
          let is_async = true;
          handler.call(this, action_data, (err?: string | null, data?: unknown) => {
            is_async = false;
            result = data;
            next(err);
          });
          if (is_async) {
            assert(!predicate); // Otherwise, predicate is checked and applied non-atomically
          }
        } else {
          next();
        }
      },
      (next) => {
        // If action was successful, apply data changes
        // (should include setting the expected field)
        for (let key in data_assignments) {
          let value = data_assignments[key];
          this.setData(key, value);
        }
        next();
      },
    ], (err?: string | null) => {
      if (err) {
        this.warnSrc(src, `Action ${action_id} failed "${err}"`);
      }
      resp_func(err || null, result);
    });
  }

  setData(field: string, value: unknown): void {
    assert(value !== undefined); // Use `null` for an explicit delete
    let data = this.data as DataObject;
    if (value === null && data[field] !== undefined ||
      value !== null && value !== data[field]
    ) {
      if (value === null) {
        delete data[field];
      } else {
        data[field] = value;
      }
      this.dirty(field);
    }
  }

  setDataSub(field: string, index: string | number, value: unknown): void {
    assert(value !== undefined); // Use `null` for an explicit delete
    let data = this.data as DataObject;
    let sub_value = data[field] as (unknown[] | DataObject);
    if (!sub_value) {
      let field_def = entity_field_defs[field];
      assert(field_def);
      let { sub } = field_def;
      assert(sub);
      sub_value = data[field] = (sub === EntityFieldSub.Array) ? [] : {};
    }
    if (Array.isArray(sub_value)) {
      assert(typeof index === 'number');
      if (value !== sub_value[index]) {
        if (value === null) {
          // Remove and swap last element
          let last = sub_value.pop();
          if (index !== sub_value.length) {
            sub_value[index] = last;
            this.dirtySub(field, index);
          }
          this.dirtySub(field, 'length');
        } else {
          sub_value[index] = value;
          this.dirtySub(field, index);
        }
      }
    } else {
      if (value === null && sub_value[index] !== undefined ||
        value !== null && value !== sub_value[index]
      ) {
        if (value === null) {
          delete sub_value[index];
        } else {
          sub_value[index] = value;
        }
        this.dirtySub(field, index);
      }
    }
  }
}
EntityBaseServer.prototype.is_player = false;

// Optional app-specific override
// cb(err, constructed entity)
export function entityServerDefaultLoadPlayerEntity<
  Entity extends EntityBaseServer,
>(
  default_data: DataObject,
  sem: ServerEntityManagerInterface,
  src: ClientHandlerSource,
  join_payload: JoinPayload,
  player_uid: string,
  cb: NetErrorCallback<Entity>,
): void {
  sem.worker.getBulkChannelData(`pent.${player_uid}`, null, (err: null | string, data: DataObject) => {
    if (err) {
      return void cb(err);
    }
    if (!data) {
      data = clone(default_data);
    }
    let ent = sem.createEntity(data);
    ent.last_saved_data = JSON.stringify(data);
    cb(null, ent);
  });
}

// Example, handler-less, permissive move and animation state
// entityServerRegisterActions([{
//   action_id: 'move',
//   self_only: false,
//   allowed_data_assignments: {
//     pos: 'array',
//     state: 'string',
//   },
// }]);
