// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Vector math functions required by the rest of the engine taken piecemeal from
// gl-matrix and related, as well as some generic math utilities
const mat3Create = require('gl-mat3/create');
const mat4Create = require('gl-mat4/create');

const { abs, acos, max, min, floor, pow, round, sqrt } = Math;

export type Mat3 = Float32Array |
  [number, number, number,
   number, number, number,
   number, number, number];
export type Mat4 = Float32Array |
  [number, number, number, number,
   number, number, number, number,
   number, number, number, number,
   number, number, number, number];

export type Vec4 = [number, number, number, number] | Float32Array | Int32Array;
export type Vec3 = [number, number, number] | Vec4;
export type Vec2 = [number, number] | Vec3;
export type Vec1 = [number] | Vec2;

export const mat3 = mat3Create as () => Mat3;
export const mat4 = mat4Create as () => Mat4;

export function vec1(v: number): Vec1 {
  return new Float32Array([v || 0]);
}

export function vec2(): Vec2;
export function vec2(a: number, b: number): Vec2;
export function vec2(a?: number, b?: number): Vec2 {
  let r = new Float32Array(2);
  if (a || b) {
    r[0] = a as number;
    r[1] = b as number;
  }
  return r;
}

export function ivec2(): Vec2;
export function ivec2(a: number, b: number): Vec2;
export function ivec2(a?: number, b?: number): Vec2 {
  let r = new Int32Array(2);
  if (a || b) {
    r[0] = a as number;
    r[1] = b as number;
  }
  return r;
}

export function vec3(): Vec3;
export function vec3(a: number, b: number, c: number): Vec3;
export function vec3(a?: number, b?: number, c?: number): Vec3 {
  let r = new Float32Array(3);
  if (a || b || c) {
    r[0] = a as number;
    r[1] = b as number;
    r[2] = c as number;
  }
  return r;
}

export function ivec3(): Vec3;
export function ivec3(a: number, b: number, c: number): Vec3;
export function ivec3(a?: number, b?: number, c?: number): Vec3 {
  let r = new Int32Array(3);
  if (a || b || c) {
    r[0] = a as number;
    r[1] = b as number;
    r[2] = c as number;
  }
  return r;
}

export function vec4(): Vec4
export function vec4(a: number, b: number, c: number, d: number): Vec4
export function vec4(a?: number, b?: number, c?: number, d?: number): Vec4 {
  let r = new Float32Array(4);
  if (a || b || c || d) {
    r[0] = a as number;
    r[1] = b as number;
    r[2] = c as number;
    r[3] = d as number;
  }
  return r;
}

function frozenVec4(a: number, b: number, c: number, d: number): Vec4 {
  // if (debug) {
  //   return Object.freeze([a,b,c,d]); // Not a vec4, but lets us catch bugs
  // }
  return vec4(a,b,c,d);
}

export const unit_vec = frozenVec4(1,1,1,1);
export const half_vec = frozenVec4(0.5,0.5,0.5,0.5);
export const zero_vec = frozenVec4(0,0,0,0);
export const identity_mat3 = mat3();
export const identity_mat4 = mat4();
export const xaxis = frozenVec4(1,0,0,0);
export const yaxis = frozenVec4(0,1,0,0);
export const zaxis = frozenVec4(0,0,1,0);


export function v2abs(out: Vec2, a: Vec2): Vec2 {
  out[0] = abs(a[0]);
  out[1] = abs(a[1]);
  return out;
}

export function v2add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  return out;
}

export function v2addScale(out: Vec2, a: Vec2, b: Vec2, s: number): Vec2 {
  out[0] = a[0] + b[0] * s;
  out[1] = a[1] + b[1] * s;
  return out;
}

export function v2angle(a: Vec2, b: Vec2): number {
  let mag = sqrt(
    (a[0] * a[0] + a[1] * a[1]) *
    (b[0] * b[0] + b[1] * b[1])
  );
  return acos(
    min(max(
      mag && ((a[0] * b[0] + a[1] * b[1]) / mag),
      -1),1
    )
  );
}

export function v2copy(out: Vec2, a: Vec2): Vec2 {
  out[0] = a[0];
  out[1] = a[1];
  return out;
}

export function v2dist(a: Vec2, b: Vec2): number {
  return sqrt((a[0] - b[0]) * (a[0] - b[0]) +
    (a[1] - b[1]) * (a[1] - b[1]));
}

export function v2distSq(a: Vec2, b: Vec2): number {
  return (a[0] - b[0]) * (a[0] - b[0]) +
    (a[1] - b[1]) * (a[1] - b[1]);
}

export function v2div(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out[0] = a[0] / b[0];
  out[1] = a[1] / b[1];
  return out;
}

export function v2dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function v2floor(out: Vec2, a: Vec2): Vec2 {
  out[0] = floor(a[0]);
  out[1] = floor(a[1]);
  return out;
}

export function v2iFloor(a: Vec2): Vec2 {
  a[0] = floor(a[0]);
  a[1] = floor(a[1]);
  return a;
}

export function v2lengthSq(a: Vec2): number {
  return a[0]*a[0] + a[1]*a[1];
}

export function v2lerp(out: Vec2, t: number, a: Vec2, b: Vec2): Vec2 {
  let it = 1 - t;
  out[0] = it * a[0] + t * b[0];
  out[1] = it * a[1] + t * b[1];
  return out;
}

export function v2mul(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  return out;
}

export function v2normalize(out: Vec2, a: Vec2): Vec2 {
  let len = a[0]*a[0] + a[1]*a[1];
  if (len > 0) {
    len = 1 / sqrt(len);
    out[0] = a[0] * len;
    out[1] = a[1] * len;
  }
  return out;
}

export function v2iNormalize(a: Vec2): Vec2 {
  let len = a[0]*a[0] + a[1]*a[1];
  if (len > 0) {
    len = 1 / sqrt(len);
    a[0] *= len;
    a[1] *= len;
  }
  return a;
}

export function v2round(out: Vec2, a: Vec2): Vec2 {
  out[0] = round(a[0]);
  out[1] = round(a[1]);
  return out;
}

export function v2iRound(a: Vec2): Vec2 {
  a[0] = round(a[0]);
  a[1] = round(a[1]);
  return a;
}

export function v2same(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function v2scale(out: Vec2, a: Vec2, s: number): Vec2 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  return out;
}

export function v2set(out: Vec2, a: number, b: number): Vec2 {
  out[0] = a;
  out[1] = b;
  return out;
}

export function v2sub(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  return out;
}


export function v3add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function v3iAdd(a: Vec3, b: Vec3): Vec3 {
  a[0] += b[0];
  a[1] += b[1];
  a[2] += b[2];
  return a;
}

export function v3addScale(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out[0] = a[0] + b[0] * s;
  out[1] = a[1] + b[1] * s;
  out[2] = a[2] + b[2] * s;
  return out;
}

export function v3angle(a: Vec3, b: Vec3): number {
  let mag = sqrt(
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) *
    (b[0] * b[0] + b[1] * b[1] + b[2] * b[2])
  );
  return acos(
    min(max(
      mag && ((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / mag),
      -1),1
    )
  );
}

export function v3copy(out: Vec3, a: Vec3): Vec3 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

export function v3cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  let a0 = a[0];
  let a1 = a[1];
  let a2 = a[2];
  let b0 = b[0];
  let b1 = b[1];
  let b2 = b[2];
  out[0] = ((a1 * b2) - (a2 * b1));
  out[1] = ((a2 * b0) - (a0 * b2));
  out[2] = ((a0 * b1) - (a1 * b0));
  return out;
}

// determinant of the matrix made by (columns?) [a, b, c];
export function v3determinant(a: Vec3, b: Vec3, c: Vec3): number {
  // let a00 = a[0];
  // let a01 = a[1];
  // let a02 = a[2];
  // let a10 = b[0];
  // let a11 = b[1];
  // let a12 = b[2];
  // let a20 = c[0];
  // let a21 = c[2];
  // let a22 = c[2];
  let a00 = a[0];
  let a01 = b[0];
  let a02 = c[0];
  let a10 = a[1];
  let a11 = b[1];
  let a12 = c[1];
  let a20 = a[2];
  let a21 = b[2];
  let a22 = c[2];

  return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
}

export function v3distSq(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) * (a[0] - b[0]) +
    (a[1] - b[1]) * (a[1] - b[1]) +
    (a[2] - b[2]) * (a[2] - b[2]);
}

export function v3dist(a: Vec3, b: Vec3): number {
  return sqrt(v3distSq(a,b));
}

export function v3div(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] / b[0];
  out[1] = a[1] / b[1];
  out[2] = a[2] / b[2];
  return out;
}

export function v3dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function v3iFloor(a: Vec3): Vec3 {
  a[0] = floor(a[0]);
  a[1] = floor(a[1]);
  a[2] = floor(a[2]);
  return a;
}

export function v3floor(out: Vec3, a: Vec3): Vec3 {
  out[0] = floor(a[0]);
  out[1] = floor(a[1]);
  out[2] = floor(a[2]);
  return out;
}

export function v3lengthSq(a: Vec3): number {
  return a[0]*a[0] + a[1]*a[1] + a[2]*a[2];
}

export function v3lerp(out: Vec3, t: number, a: Vec3, b: Vec3): Vec3 {
  let it = 1 - t;
  out[0] = it * a[0] + t * b[0];
  out[1] = it * a[1] + t * b[1];
  out[2] = it * a[2] + t * b[2];
  return out;
}

export function v3iMax(a: Vec3, b: Vec3): Vec3 {
  a[0] = max(a[0], b[0]);
  a[1] = max(a[1], b[1]);
  a[2] = max(a[2], b[2]);
  return a;
}

export function v3iMin(a: Vec3, b: Vec3): Vec3 {
  a[0] = min(a[0], b[0]);
  a[1] = min(a[1], b[1]);
  a[2] = min(a[2], b[2]);
  return a;
}

export function v3mul(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  out[2] = a[2] * b[2];
  return out;
}

export function v3iMul(a: Vec3, b: Vec3): Vec3 {
  a[0] *= b[0];
  a[1] *= b[1];
  a[2] *= b[2];
  return a;
}

export function v3mulMat4(out: Vec3, a: Vec3, m: Mat4): Vec3 {
  let x = a[0];
  let y = a[1];
  let z = a[2];
  out[0] = x * m[0] + y * m[4] + z * m[8];
  out[1] = x * m[1] + y * m[5] + z * m[9];
  out[2] = x * m[2] + y * m[6] + z * m[10];
  return out;
}

// Same as v3mulMat4, but assumes it's a vector with w=1
export function m4TransformVec3(out: Vec3, a: Vec3, m: Mat4): Vec3 {
  let x = a[0];
  let y = a[1];
  let z = a[2];
  out[0] = x * m[0] + y * m[4] + z * m[8] + m[12];
  out[1] = x * m[1] + y * m[5] + z * m[9] + m[13];
  out[2] = x * m[2] + y * m[6] + z * m[10] + m[14];
  return out;
}

export function v3normalize(out: Vec3, a: Vec3): Vec3 {
  let len = a[0]*a[0] + a[1]*a[1] + a[2]*a[2];
  if (len > 0) {
    len = 1 / sqrt(len);
    out[0] = a[0] * len;
    out[1] = a[1] * len;
    out[2] = a[2] * len;
  }
  return out;
}

export function v3iNormalize(a: Vec3): Vec3 {
  let len = a[0]*a[0] + a[1]*a[1] + a[2]*a[2];
  if (len > 0) {
    len = 1 / sqrt(len);
    a[0] *= len;
    a[1] *= len;
    a[2] *= len;
  }
  return a;
}

// Treats `a` as vec3 input with w assumed to be 1
// out[0]/[1] have had perspective divide and converted to normalized 0-1 range
// out[2] is distance
export function v3perspectiveProject(out: Vec3, a: Vec3, m: Mat4): Vec3 {
  let x = a[0];
  let y = a[1];
  let z = a[2];
  let w = m[3] * x + m[7] * y + m[11] * z + m[15];
  let invw = 0.5 / (w || 0.00001);
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * invw + 0.5;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * -invw + 0.5;
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

export function v3pow(out: Vec3, a: Vec3, exp: number) : Vec3 {
  out[0] = pow(a[0], exp);
  out[1] = pow(a[1], exp);
  out[2] = pow(a[2], exp);
  return out;
}

export function v3round(out: Vec3, a: Vec3): Vec3 {
  out[0] = round(a[0]);
  out[1] = round(a[1]);
  out[2] = round(a[2]);
  return out;
}

export function v3iRound(a: Vec3): Vec3 {
  a[0] = round(a[0]);
  a[1] = round(a[1]);
  a[2] = round(a[2]);
  return a;
}

export function v3same(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function v3scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

export function v3scaleFloor(out: Vec3, a: Vec3, s: number): Vec3 {
  out[0] = floor(a[0] * s);
  out[1] = floor(a[1] * s);
  out[2] = floor(a[2] * s);
  return out;
}

export function v3iScale(a: Vec3, s: number): Vec3 {
  a[0] *= s;
  a[1] *= s;
  a[2] *= s;
  return a;
}

export function v3set(out: Vec3, a: number, b: number, c: number): Vec3 {
  out[0] = a;
  out[1] = b;
  out[2] = c;
  return out;
}

export function v3sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function v3iSub(a: Vec3, b: Vec3): Vec3 {
  a[0] -= b[0];
  a[1] -= b[1];
  a[2] -= b[2];
  return a;
}

export function v3zero(out: Vec3): Vec3 {
  out[0] = out[1] = out[2] = 0;
  return out;
}


export function v4add(out: Vec4, a: Vec4, b: Vec4): Vec4 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  out[3] = a[3] + b[3];
  return out;
}

export function v4clone(a: Vec4): Vec4 {
  return a.slice(0) as Vec4;
}

export function v4copy(out: Vec4, a: Vec4): Vec4 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  return out;
}

export function v4dot(a: Vec4, b: Vec4): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function v4fromRGBA(rgba: number): Vec4 {
  let r = rgba >>> 24;
  let g = (rgba & 0x00FF0000) >> 16;
  let b = (rgba & 0x0000FF00) >> 8;
  let a = rgba & 0xFF;
  return vec4(r/255, g/255, b/255, a/255);
}

export function v4lerp(out: Vec4, t: number, a: Vec4, b: Vec4): Vec4 {
  let it = 1 - t;
  out[0] = it * a[0] + t * b[0];
  out[1] = it * a[1] + t * b[1];
  out[2] = it * a[2] + t * b[2];
  out[3] = it * a[3] + t * b[3];
  return out;
}

export function v4mul(out: Vec4, a: Vec4, b: Vec4): Vec4 {
  out[0] = a[0] * b[0];
  out[1] = a[1] * b[1];
  out[2] = a[2] * b[2];
  out[3] = a[3] * b[3];
  return out;
}

export function v4mulAdd(out: Vec4, a: Vec4, b: Vec4, c: Vec4): Vec4 {
  out[0] = a[0] * b[0] + c[0];
  out[1] = a[1] * b[1] + c[1];
  out[2] = a[2] * b[2] + c[2];
  out[3] = a[3] * b[3] + c[3];
  return out;
}

export function v4same(a: Vec4, b: Vec4): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function v4scale(out: Vec4, a: Vec4, s:number): Vec4 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  out[3] = a[3] * s;
  return out;
}

export function v4set(out: Vec4, a: number, b: number, c: number, d: number): Vec4 {
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  return out;
}

export function v4zero(out: Vec4): Vec4 {
  out[0] = out[1] = out[2] = out[3] = 0;
  return out;
}
