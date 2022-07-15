import type { FriendData } from './friends_data';
import type { Vec4 } from './vmath';

/**
 * Data object type to be used when handling an object that contains some type of (possible unknown) information.
 * @template T - The type of information held by the object, defaults to unknown.
 */
export type DataObject = Partial<Record<string, unknown>>;

/**
 * Error callback accepting an error as the first parameter and a result as the second parameter.
 * Both parameters are optional.
 *
 * @template T - The result type, defaults to never (no result)
 * @template E - The error type, defaults to unknown
 * @param err - The error parameter
 * @param result - The result parameter
 */
export type ErrorCallback<T = never, E = unknown> = (
  err?: E | undefined | null,
  result?: T extends (never | void) ? never : (T | undefined | null)
) => void;


// TODO: Implement the types below and move them to the appropriate files

/**
 * Client presence data
 */
export interface ClientPresenceData {
  active: number;
  state: string;
  payload: unknown;
}
/**
 * Server presence data
 */
export interface ServerPresenceData {
  id: number;
  active: number;
  state: string;
  payload: unknown;
}

/*
 * Chat message data
 */
export interface ChatMessageData {
  id: string | undefined;
  msg: string;
  flags: number;
  ts: number;
  display_name: string | undefined;
}
/*
 * Chat history data
 */
export interface ChatHistoryData {
  idx: number;
  msgs: ChatMessageData[];
}

/*
 * Friends command response
 */
export type FriendCmdResponse = { msg: string, friend: FriendData };

/**
 * Server worker handler callback
 */
export type HandlerCallback<T = never> = ErrorCallback<T, string>;

/**
 * Server worker handler source
 */
export interface HandlerSource {
  channel_id: string,
  id: string,
  type: string,
}

/**
 * Server client worker handler source
 */
export interface ClientHandlerSource extends HandlerSource {
  type: 'client',
  user_id?: string,
  display_name?: string,
  access?: true,
  direct?: true,
  sysadmin?: true,
}
export function isClientHandlerSource(src: HandlerSource): src is ClientHandlerSource {
  return src.type === 'client';
}

export interface Packet {
  readU8: () => number,
  writeU8: (value: number) => void,
  readU32: () => number,
  writeU32: (value: number) => void,
  readInt: () => number,
  writeInt: (value: number) => void,
  readFloat: () => number,
  writeFloat: (value: number) => void,
  readString: () => string,
  writeString: (value: string) => void,
  readAnsiString: () => string,
  writeAnsiString: (value: string) => void,
  readJSON: () => unknown,
  writeJSON: (value: unknown) => void,
  readBool: () => boolean,
  writeBool: (value: boolean) => void,
  readBuffer: (do_copy: boolean) => Uint8Array,
  writeBuffer: (value: Uint8Array) => void,

  append: (other: Packet) => void,
  appendRemaining: (other: Packet) => void,
  send: (resp_func?: ErrorCallback) => void,
  ended: () => boolean,
  updateFlags: (flags: number) => void,
  readFlags: () => void,
  writeFlags: () => void,
  getFlags: () => number,
  getBuffer: () => Uint8Array,
  getBufferLen: () => number,
  getInternalFlags: () => number,
  getOffset: () => number,
  getRefCount: () => number,
  makeReadable: () => void,
  pool: () => void,
  ref: () => void,
  seek: (offs: number) => void,
  totalSize: () => number,
}

// TODO: Delete this type and all usages of it.
// It is being used as a placeholder for data types that are not yet implemented.
export type UnimplementedData = DataObject;

/**
 * Client Sprite class
 */
export interface Sprite {
  uidata: {
    total_w: number,
    total_h: number,
  },
  uvs: number[],
  draw: (params: {
    x: number, y: number, z: number,
    w: number, h: number,
    uvs?: number[], color: Vec4,
  }) => void,
}
/**
 * Client Sprite creation parameters
 */
export type SpriteParam = UnimplementedData;
/**
 * UI Sprites object
 */
export interface UISprites {
  chat_panel: Sprite,
  scrollbar_top: Sprite,
  scrollbar_bottom: Sprite,
  scrollbar_trough: Sprite,
  scrollbar_handle: Sprite,
  scrollbar_handle_grabber: Sprite,
}
