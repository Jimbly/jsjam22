// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code from Turbulenz: Copyright (c) 2012-2013 Turbulenz Limited
// Released under MIT License: https://opensource.org/licenses/MIT

export function mat43() {
  let r = new Float32Array(12);
  r[0] = r[4] = r[8] = 1;
  return r;
}

export function m43identity(out) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 1;
  out[5] = 0;
  out[6] = 0;
  out[7] = 0;
  out[8] = 1;
  out[9] = 0;
  out[10] = 0;
  out[11] = 0;
}

export function m43mul(out, a, b) {
  let a0 = a[0];
  let a1 = a[1];
  let a2 = a[2];
  let a3 = a[3];
  let a4 = a[4];
  let a5 = a[5];
  let a6 = a[6];
  let a7 = a[7];
  let a8 = a[8];
  let a9 = a[9];
  let a10 = a[10];
  let a11 = a[11];

  let b0 = b[0];
  let b1 = b[1];
  let b2 = b[2];
  let b3 = b[3];
  let b4 = b[4];
  let b5 = b[5];
  let b6 = b[6];
  let b7 = b[7];
  let b8 = b[8];

  out[0] = (b0 * a0 + b3 * a1 + b6 * a2);
  out[1] = (b1 * a0 + b4 * a1 + b7 * a2);
  out[2] = (b2 * a0 + b5 * a1 + b8 * a2);
  out[3] = (b0 * a3 + b3 * a4 + b6 * a5);
  out[4] = (b1 * a3 + b4 * a4 + b7 * a5);
  out[5] = (b2 * a3 + b5 * a4 + b8 * a5);
  out[6] = (b0 * a6 + b3 * a7 + b6 * a8);
  out[7] = (b1 * a6 + b4 * a7 + b7 * a8);
  out[8] = (b2 * a6 + b5 * a7 + b8 * a8);
  out[9] = (b0 * a9 + b3 * a10 + b6 * a11 + b[9]);
  out[10] = (b1 * a9 + b4 * a10 + b7 * a11 + b[10]);
  out[11] = (b2 * a9 + b5 * a10 + b8 * a11 + b[11]);

  return out;
}
