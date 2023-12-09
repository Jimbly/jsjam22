// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export let entity_field_encoders: Partial<Record<EntityFieldEncodingType, EntityFieldEncoder<EntityBaseCommon>>> = {};
export let entity_field_decoders: Partial<Record<EntityFieldEncodingType, EntityFieldDecoder<EntityBaseCommon>>> = {};

import assert from 'assert';
import { Packet } from 'glov/common/packet';
import { Vec2, Vec3 } from 'glov/common/vmath';
import type { DataObject, EntityID } from 'glov/common/types';

export type { EntityID };

// Entity Action List Flags
export const EALF_HAS_PREDICATE = 1<<0;
export const EALF_HAS_ENT_ID = 1<<1; // otherwise: entity target is self
export const EALF_HAS_PAYLOAD = 1<<2;
export const EALF_HAS_ASSIGNMENTS = 1<<3;

export const EntityFieldEncoding = {
  // Note: changing any of these is a breaking change with all clients, change with care
  JSON: 1,
  Int: 2, // Packet integer taking between 1 and 9 bytes, in the range -2^64...2^64
  Float: 3,
  AnsiString: 4,  // Much more efficient than String if the input is known to be ANSI-ish (all characters <= 255)
  U8: 5,
  U32: 6,
  String: 7,
  Boolean: 8,
  Vec2: 9,
  Vec3: 10,
  U8Vec3: 11, // e.g. RGB
  IVec3: 12,

  Custom0: 127, // App-specific encodings in the range 127...255
};
export type EntityFieldEncodingType = typeof EntityFieldEncoding[keyof typeof EntityFieldEncoding];

export type EntityFieldEncoder<Entity extends EntityBaseCommon> = (
  ent: Entity,
  pak: Packet,
  value: unknown,
  // If is_diff is true, the receiver will have already received either the most
  //   recent diff, or a full update (which may have been a more up-to-date value
  //   than the most recent diff, but never older).
  // OK: Send only the fields that have changed since the last diff
  // NOT OK: Send a numerical difference from the last diff
  is_diff: boolean,
) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type EntityFieldDecoder<Entity extends EntityBaseCommon> = (
  // ent: Entity,
  pak: Packet,
  old_value: unknown // Note: on client->server encodings (data_assignmenets), old_value is always `null`
) => unknown;


export const EntityFieldSub = {
  None: 0,
  Array: 1, // numerical indices to elements
  Record: 2, // string keys to elements
} as const;
export type EntityFieldSubType = typeof EntityFieldSub[keyof typeof EntityFieldSub];

export interface EntityFieldDefCommon {
  encoding: EntityFieldEncodingType; // Default: JSON
  default_value?: undefined | number | string; // Default: undefined
  sub: EntityFieldSubType; // Default: None
}

export interface EntityFieldDefSerialized {
  n: string;
  e?: EntityFieldEncodingType;
  d?: number | string;
  s?: EntityFieldSubType;
}

export const EntityFieldSpecial = {
  Terminate: 0,
  Default: 1,
  MAX: 2, // Actual field indices start after here
} as const;

export type EntityManagerSchema = EntityFieldDefSerialized[];

export type ClientID = string;

export type ActionDataAssignments = Partial<Record<string, unknown>>;
export type ActionListResponse = { err?: string; data?: unknown }[];

export interface ActionMessageParam {
  action_id: string;
  self?: boolean;
  ent_id?: EntityID;
  predicate?: { field: string; expected_value?: string };
  data_assignments?: ActionDataAssignments;
  payload?: unknown;
}

// Server -> Client ent_update packet commands
export const enum EntityUpdateCmd {
  Terminate = 0,
  Full = 1,
  Diff = 2,
  Delete = 3,
  Event = 4,
  Schema = 5,
  IsInitialList = 6,
}

export type EntityManagerEvent = {
  from?: EntityID;
  msg: string;
  data?: unknown;
};

export interface EntityManager<Entity extends EntityBaseCommon = EntityBaseCommon> {
  entities: Partial<Record<EntityID, Entity>>;
  entitiesFind(
    predicate: (ent: Entity) => boolean,
    skip_fading_out?: boolean
  ): Entity[];
  entitiesReload(predicate?: (ent: Entity) => boolean): Entity[];
}

export type EntityBaseDataCommon = {
  // Nothing anymore (previously had `pos: number[]`)
};

export class EntityBaseCommon {
  id!: EntityID; // Set by EntityManager
  data: EntityBaseDataCommon | DataObject;
  entity_manager!: EntityManager; // Set by EntityManager

  constructor(data: EntityBaseDataCommon) {
    this.data = data;
  }

  getData<T>(field: string): T | undefined {
    assert(0); // should hit EntityBaseServer or EntityBaseClient's implementation instead
    return undefined;
  }

}

// Note: must be called _before_ entityServerRegisterFieldDefs() on the server
export function entityCommonRegisterFieldEncoding<Entity extends EntityBaseCommon>(
  data: Partial<Record<EntityFieldEncodingType, {
    // encoder: on the CLIENT used for sending data_assigments
    // decoder: on the CLIENT used for receiving full entity updates and entity diffs
    // encoder: on the SERVER used for sending full entity updates and entity diffs
    // decoder: on the SERVER used for receiving data_assignemnts (old_value always === null)
    encoder: EntityFieldEncoder<Entity>;
    decoder: EntityFieldDecoder<Entity>;
  }>>
): void {
  for (let key_string in data) {
    let key = Number(key_string) as EntityFieldEncodingType;
    let pair = data[key]!;
    let encoder = pair.encoder as EntityFieldEncoder<EntityBaseCommon>;
    let decoder = pair.decoder as EntityFieldDecoder<EntityBaseCommon>;
    assert(!entity_field_encoders[key]);
    entity_field_encoders[key] = encoder;
    entity_field_decoders[key] = decoder;
  }
}

entityCommonRegisterFieldEncoding({
  // Using functions with names to get better callstacks
  /* eslint-disable func-name-matching */
  [EntityFieldEncoding.JSON]: {
    encoder: function encJSON(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeJSON(value);
    },
    decoder: function decJSON(pak: Packet, old_value: unknown): unknown {
      return pak.readJSON();
    },
  },
  [EntityFieldEncoding.Int]: {
    encoder: function encInt(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeInt(value as number);
    },
    decoder: function decInt(pak: Packet, old_value: unknown): unknown {
      return pak.readInt();
    },
  },
  [EntityFieldEncoding.Float]: {
    encoder: function encFloat(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeFloat(value as number);
    },
    decoder: function decFloat(pak: Packet, old_value: unknown): unknown {
      return pak.readFloat();
    },
  },
  [EntityFieldEncoding.AnsiString]: {
    encoder: function encAnsiString(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeAnsiString(value as string);
    },
    decoder: function decAnsiString(pak: Packet, old_value: unknown
    ): unknown {
      return pak.readAnsiString();
    },
  },
  [EntityFieldEncoding.U8]: {
    encoder: function encU8(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeU8(value as number);
    },
    decoder: function decU8(pak: Packet, old_value: unknown): unknown {
      return pak.readU8();
    },
  },
  [EntityFieldEncoding.U32]: {
    encoder: function encU32(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeU32(value as number);
    },
    decoder: function decU32(pak: Packet, old_value: unknown): unknown {
      return pak.readU32();
    },
  },
  [EntityFieldEncoding.String]: {
    encoder: function encString(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeString(value as string);
    },
    decoder: function decString(pak: Packet, old_value: unknown): unknown {
      return pak.readString();
    },
  },
  [EntityFieldEncoding.Boolean]: {
    encoder: function encBool(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      pak.writeBool(value as boolean);
    },
    decoder: function decBool(pak: Packet, old_value: unknown): unknown {
      return pak.readBool();
    },
  },
  [EntityFieldEncoding.Vec2]: {
    encoder: function encVec2(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      let v = value as [number, number];
      pak.writeFloat(v[0]);
      pak.writeFloat(v[1]);
    },
    decoder: function decVec2(pak: Packet, old_value: unknown): unknown {
      let v = old_value as Vec2 || [];
      v[0] = pak.readFloat();
      v[1] = pak.readFloat();
      return v;
    },
  },
  [EntityFieldEncoding.Vec3]: {
    encoder: function encVec3(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      let v = value as [number, number, number];
      pak.writeFloat(v[0]);
      pak.writeFloat(v[1]);
      pak.writeFloat(v[2]);
    },
    decoder: function decVec3(pak: Packet, old_value: unknown): unknown {
      let v = old_value as Vec3 || [];
      v[0] = pak.readFloat();
      v[1] = pak.readFloat();
      v[2] = pak.readFloat();
      return v;
    },
  },
  [EntityFieldEncoding.U8Vec3]: {
    encoder: function encU8Vec3(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      let v = value as [number, number, number];
      pak.writeU8(v[0]);
      pak.writeU8(v[1]);
      pak.writeU8(v[2]);
    },
    decoder: function decU8Vec3(pak: Packet, old_value: unknown): unknown {
      let v = old_value as Vec3 || [];
      v[0] = pak.readU8();
      v[1] = pak.readU8();
      v[2] = pak.readU8();
      return v;
    },
  },
  [EntityFieldEncoding.IVec3]: {
    encoder: function encIVec3(ent: EntityBaseCommon, pak: Packet, value: unknown): void {
      let v = value as [number, number, number];
      pak.writeInt(v[0]);
      pak.writeInt(v[1]);
      pak.writeInt(v[2]);
    },
    decoder: function decIVec3(pak: Packet, old_value: unknown): unknown {
      let v = old_value as Vec3 || [];
      v[0] = pak.readInt();
      v[1] = pak.readInt();
      v[2] = pak.readInt();
      return v;
    },
  },
});
