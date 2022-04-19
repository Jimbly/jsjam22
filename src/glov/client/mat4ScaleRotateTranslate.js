// Derived from https://github.com/toji/gl-matrix/blob/master/src/mat4.js
// Under MIT License

module.exports = function (out, uniform_scale, quat, pos) {
  // Quaternion math
  let x = quat[0];
  let y = quat[1];
  let z = quat[2];
  let w = quat[3];
  let x2 = x + x;
  let y2 = y + y;
  let z2 = z + z;

  let xx = x * x2;
  let xy = x * y2;
  let xz = x * z2;
  let yy = y * y2;
  let yz = y * z2;
  let zz = z * z2;
  let wx = w * x2;
  let wy = w * y2;
  let wz = w * z2;

  out[0] = (1 - (yy + zz)) * uniform_scale;
  out[1] = (xy + wz) * uniform_scale;
  out[2] = (xz - wy) * uniform_scale;
  out[3] = 0;
  out[4] = (xy - wz) * uniform_scale;
  out[5] = (1 - (xx + zz)) * uniform_scale;
  out[6] = (yz + wx) * uniform_scale;
  out[7] = 0;
  out[8] = (xz + wy) * uniform_scale;
  out[9] = (yz - wx) * uniform_scale;
  out[10] = (1 - (xx + yy)) * uniform_scale;
  out[11] = 0;
  out[12] = pos[0];
  out[13] = pos[1];
  out[14] = pos[2];
  out[15] = 1;

  return out;
};
