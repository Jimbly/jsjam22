// TODO: move when converted to TypeScript
import type { BUCKET_ALPHA, BUCKET_DECAL, BUCKET_OPAQUE } from './dyn_geom';
// TODO: move when converted to TypeScript
import type { shaderCreate } from 'glov/client/shaders';
type Shader = ReturnType<typeof shaderCreate>;
import type { ROVec1, ROVec2, ROVec3, ROVec4 } from 'glov/common/vmath';

export enum BlendMode {
  BLEND_ALPHA = 0,
  BLEND_ADDITIVE = 1,
  BLEND_PREMULALPHA = 2,
}
export const BLEND_ALPHA = 0;
export const BLEND_ADDITIVE = 1;
export const BLEND_PREMULALPHA = 2;

export interface Texture {
  width: number;
  height: number;
  src_width: number;
  src_height: number;
  destroy(): void;
}

/**
 * Client Sprite class
 */
export interface SpriteUIData {
  widths: number[]; heights: number[];
  wh: number[]; hw: number[];
  rects: ROVec4[]; // [u0, v0, u1, v1]
  aspect: number[] | null;
  total_w: number; total_h: number;
}
export interface SpriteDrawParams {
  x: number; y: number; z?: number;
  w?: number; h?: number;
  frame?: number;
  rot?: number;
  uvs?: number[]; // [u0, v0, u1, v1]
  color?: ROVec4;
  shader?: Shader;
  shader_params?: Partial<Record<string, number[]|ROVec1|ROVec2|ROVec3|ROVec4>>;
}
export type BucketType = typeof BUCKET_OPAQUE | typeof BUCKET_DECAL | typeof BUCKET_ALPHA;
export interface SpriteDraw3DParams {
  frame?: number;
  pos: ROVec3; // 3D world position
  offs?: ROVec2; // 2D offset (-x/-y is upper left), in world scale
  size: ROVec2; // 2D w;h; in world scale
  uvs?: ROVec4;
  blend?: BlendMode;
  color?: ROVec4;
  doublesided?: boolean;
  shader?: Shader;
  shader_params?: Partial<Record<string, number[]|ROVec1|ROVec2|ROVec3|ROVec4>>;
  bucket?: BucketType;
  facing?: number;
  face_right?: ROVec3;
  face_down?: ROVec3;
  vshader?: Shader;
}
export interface Sprite {
  uidata?: SpriteUIData;
  uvs: number[];
  origin: ROVec2;
  draw(params: SpriteDrawParams): void;
  drawDualTint(params: SpriteDrawParams & { color1: ROVec4 }): void;
  draw3D(params: SpriteDraw3DParams): void;
  texs: Texture[];
  lazyLoad(): number;
}
export interface UISprite extends Sprite {
  uidata: SpriteUIData;
}
/**
 * Client Sprite creation parameters
 */
export type SpriteParamBase = {
  origin?: ROVec2;
  size?: ROVec2;
  color?: ROVec4;
  uvs?: ROVec4;
  ws?: number[]; // (relative) widths/heights for calculating frames within a sprite sheet / atlas
  hs?: number[];
  shader?: Shader;
};
export type TextureOptions = {
  filter_min?: number;
  filter_mag?: number;
  wrap_s?: number;
  wrap_t?: number;
};
export type SpriteParam = SpriteParamBase & ({
  texs: Texture[];
} | {
  tex: Texture;
} | (TextureOptions & ({
  layers: number;
  name: string;
  ext?: string;
} | {
  name: string;
  ext?: string;
  lazy_load?: boolean;
} | {
  url: string;
  lazy_load?: boolean;
})));

export function spriteQueuePush(): void;
export function spriteQueuePop(): void;
export function spriteChainedStart(): void;
export function spriteChainedStop(): void;
export function spriteQueueFn(z: number, fn: () => void): void;
export function spriteClip(z_start: number, z_end: number, x: number, y: number, w: number, h: number): void;
export function spriteClipped(): boolean;
export function spriteClipPush(z: number, x: number, y: number, w: number, h: number): void;
export function spriteClipPop(): void;
export function spriteClipPause(): void;
export function spriteClipResume(): void;
export function spriteDraw(): void;
export function spriteDrawPartial(z: number): void;
export function spriteCreate(param: SpriteParam): Sprite;
export function spriteStartup(): void;

export function spriteFlippedUVsApplyHFlip(spr: Sprite): void;
export function spriteFlippedUVsRestore(spr: Sprite): void;

// TODO: export with appropriate types
// export type Shader = { _opaque: 'Shader' };
// export function spriteDataAlloc(texs: Texture[], shader: Shader, shader_params, blend: BlendMode): void;
// export function queueraw4color(
// export function queueraw4(
// export function queueSpriteData(elem, z): void;
// export function queueraw4colorBuffer(
// export function queueraw(
// export function queuesprite(
// TODO: migrate to internal only?
// export function blendModeSet(blend: BlendMode): void;
// export function blendModeReset(force: boolean): void;
// export function buildRects(ws, hs, tex): void;
