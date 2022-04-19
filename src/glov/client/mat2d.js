// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code from https://github.com/toji/gl-matrix/blob/master/src/mat2d.js

const { cos, sin } = Math;

// Last column is always 0,0,1
export function mat2d() {
  let r = new Float32Array(6);
  r[0] = r[3] = 1;
  return r;
}

export const identity_mat2d = mat2d();

export function m2translate(out, a, v) {
  if (a !== out) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
  }
  out[4] = a[4] + v[0];
  out[5] = a[5] + v[1];
  return out;
}

export function m2mul(out, a, b) {
  let a0 = a[0];
  let a1 = a[1];
  let a2 = a[2];
  let a3 = a[3];
  let a4 = a[4];
  let a5 = a[5];
  let b0 = b[0];
  let b1 = b[1];
  let b2 = b[2];
  let b3 = b[3];
  let b4 = b[4];
  let b5 = b[5];
  out[0] = a0 * b0 + a2 * b1;
  out[1] = a1 * b0 + a3 * b1;
  out[2] = a0 * b2 + a2 * b3;
  out[3] = a1 * b2 + a3 * b3;
  out[4] = a0 * b4 + a2 * b5 + a4;
  out[5] = a1 * b4 + a3 * b5 + a5;
  return out;
}

/**
 * Rotates a mat2d by the given angle
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2d} out
 */
export function m2rot(out, a, rad) {
  let a0 = a[0];
  let a1 = a[1];
  let a2 = a[2];
  let a3 = a[3];
  let a4 = a[4];
  let a5 = a[5];
  let s = sin(rad);
  let c = cos(rad);
  out[0] = a0 * c + a2 * s;
  out[1] = a1 * c + a3 * s;
  out[2] = a0 * -s + a2 * c;
  out[3] = a1 * -s + a3 * c;
  out[4] = a4;
  out[5] = a5;
  return out;
}

export function m2scale(out, a, v) {
  let a0 = a[0];
  let a1 = a[1];
  let a2 = a[2];
  let a3 = a[3];
  let a4 = a[4];
  let a5 = a[5];
  let v0 = v[0];
  let v1 = v[1];
  out[0] = a0 * v0;
  out[1] = a1 * v0;
  out[2] = a2 * v1;
  out[3] = a3 * v1;
  out[4] = a4;
  out[5] = a5;
  return out;
}

export function m2v2transform(out, a, m) {
  let x = a[0];
  let y = a[1];
  out[0] = m[0] * x + m[2] * y + m[4];
  out[1] = m[1] * x + m[3] * y + m[5];
  return out;
}
