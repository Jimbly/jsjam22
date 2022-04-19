// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-bitwise:off */


// Encoding is fastest with non-native calls: http://jsperf.com/base64-encode
// Decoding is fastest using window.btoa: http://jsperf.com/base64-decode

const { floor } = Math;

const chr_table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');
const PAD = '=';

// dv is a DataView with a .u8 property
function encode(dv, offset, length) {
  let data = dv.u8;
  let result = '';
  let i;
  let effi;
  // Convert every three bytes to 4 ascii characters.
  for (i = 0; i < (length - 2); i += 3) {
    effi = offset + i;
    result += chr_table[data[effi] >> 2];
    result += chr_table[((data[effi] & 0x03) << 4) + (data[effi + 1] >> 4)];
    result += chr_table[((data[effi + 1] & 0x0f) << 2) + (data[effi + 2] >> 6)];
    result += chr_table[data[effi + 2] & 0x3f];
  }

  // Convert the remaining 1 or 2 bytes, pad out to 4 characters.
  if (length % 3) {
    i = length - (length % 3);
    effi = offset + i;
    result += chr_table[data[effi] >> 2];
    if ((length % 3) === 2) {
      result += chr_table[((data[effi] & 0x03) << 4) + (data[effi + 1] >> 4)];
      result += chr_table[(data[effi + 1] & 0x0f) << 2];
      result += PAD;
    } else {
      result += chr_table[(data[effi] & 0x03) << 4];
      result += PAD + PAD;
    }
  }

  return result;
}

function decodeNativeBrowser(data, allocator) {
  let str = window.atob(data);
  let len = str.length;
  let dv = allocator(len);
  let u8 = dv.u8;
  for (let ii = 0; ii < len; ++ii) {
    u8[ii] = str.charCodeAt(ii);
  }
  dv.decode_size = len;
  return dv;
}

function encodeNativeNode(dv, offset, length) {
  // Allocates a Buffer() object each time - could have our allocDataView do that if needed for perf
  return Buffer.from(dv.buffer).toString('base64', offset, offset + length);
}
// Faster, but uses an internal function that might break:
// function encodeNativeNode(dv, offset, length) {
//   return Buffer.prototype.base64Slice.call(dv.u8, offset, offset + length);
// }

function decodeNativeNode(data, allocator) {
  let buffer_len = (data.length >> 2) * 3 + floor((data.length % 4) / 1.5);
  let dv = allocator(buffer_len);
  let buffer = Buffer.from(dv.buffer);
  dv.decode_size = buffer.write(data, 'base64');
  return dv;
}

const BROWSER = typeof window !== 'undefined';

// string -> Uint8Array or Buffer
exports.base64Decode = BROWSER ? decodeNativeBrowser : decodeNativeNode;
// Uint8Array or Buffer -> string
exports.base64Encode = BROWSER ? encode : encodeNativeNode;

exports.base64CharTable = chr_table;
