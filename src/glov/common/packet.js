// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code derived from libGLOV (C++), also MIT Licensed

/* eslint no-bitwise:off */

// Upon read, throw an exception if there is any data read error (e.g. read off of end of packet)

// TODO: Maybe: Have 2 offsets, one for writing (data_len?), one for reading (buf_offs?),
//   then there should be many fewer ?pak.readable branches
//   that return different values under different circumstances, and maybe fewer .makeReadable() calls needed.


// 3 bits of flags reserved for internal use
const PACKET_DEBUG = exports.PACKET_DEBUG = 1<<0;
const PACKET_RESERVED1 = exports.PACKET_RESERVED1 = 1<<1;
const PACKET_RESERVED2 = exports.PACKET_RESERVED2 = 1<<2;
const FLAG_PACKET_INTERNAL = PACKET_DEBUG | PACKET_RESERVED1 | PACKET_RESERVED2;

// Internal, runtime-only (not serialized) flags < 8 bits
const PACKET_UNOWNED_BUFFER = 1 << 8;

/* eslint-disable import/order */
const assert = require('assert');
const { max } = Math;
const { deprecate, isInteger, log2 } = require('./util.js');
// const { isInteger, log2 } = require('../../build.dev/common/glov/util.js');
const { base64Encode, base64Decode } = require('./base64.js');

deprecate(exports, 'default_flags');

const FALSYS = [undefined, null, 0, false, '', NaN];
const PAK_BUF_DEFAULT_SIZE = 1024;

const UNDERRUN = 'PKTERR_UNDERRUN';

const POOL_PACKETS = 5000;
const POOL_TIMEOUT = 5000;
const POOL_BUF_BY_SIZE = [
  0, // 2^0 : 1 - shouldn't be allocated ever?
  10, // 2^1 : 2
  10, // 2^2 : 4
  20, // 2^3 : 8
  20, // 2^4 : 16
  20, // 2^5 : 32
  20, // 2^6 : 64
  20, // 2^7 : 128
  20, // 2^8 : 256
  20, // 2^9 : 512
  5000, // 2^10 : 1024 - standard Packet size
  20, // 2^11 : 2048
  20, // 2^12 : 4096
  20, // 2^13 : 8192
  20, // 2^14 : 16384
  20, // 2^15 : 32768
  20, // 2^16 : 65536
  10, // 2^17 : 131072
  10, // 2^18 : 262144,
];

let pak_pool = [];
let pak_debug_pool = [];
let buf_pool = POOL_BUF_BY_SIZE.map(() => []);

function allocDataView(size) {
  let pool_idx = log2(size);
  assert(pool_idx);
  if (pool_idx >= buf_pool.length) {
    pool_idx = 0;
  }
  if (pool_idx) {
    size = 1 << pool_idx;
    if (buf_pool[pool_idx].length) {
      // No reinit here, just a container
      //console.log(`Buffer FROMPOOL:${size}/${pool_idx}`);
      return buf_pool[pool_idx].pop();
    }
  } else {
    // Enable this (and lower pool size) to track down big packets:
    // console.log(`Allocating UNPOOLABLE buffer of size ${size} from ${new Error().stack}`);
  }
  //console.log(`Buffer ALLOC:${size}`);
  let u8 = new Uint8Array(size);
  let dv = new DataView(u8.buffer);
  dv.u8 = u8;
  if (pool_idx) {
    dv.packet_pool_idx = pool_idx;
  }
  return dv;
}

function wrapU8AsDataView(u8) {
  let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  dv.u8 = u8;
  return dv;
}

function utf8ByteLength(str) {
  let len = str.length;
  let ret = len;
  for (let ii = 0; ii < len; ++ii) {
    let c = str.charCodeAt(ii);
    if (c > 0x7F) {
      ++ret;
      if (c > 0x07FF) {
        ++ret;
        if (c > 0xFFFF) {
          ++ret;
          if (c > 0x1FFFFF) {
            ++ret;
            if (c > 0x3FFFFFF) {
              ++ret;
            }
          }
        }
      }
    }
  }
  return ret;
}

// Assumes buffer will fit it
function utf8WriteChar(buf, buf_offs, c) {
  if (c > 0x10FFFF) {
    // Limit to Unicode max code point. Note that this function currently
    //   receives character codes, not code points, so will not actually
    //   ever receive a value over 0xFFFF since JavaScript uses UTF-16
    //   character codes.  See note on writeString below.
    c = 0xFFFF;
  }
  if (c <= 0x7F) {
    buf.u8[buf_offs++] = c;
  } else if (c <= 0x07FF) {
    buf.u8[buf_offs++] = (c >> 6) | 0xC0;
    buf.u8[buf_offs++] = (c & 0x3F) | 0x80;
  } else if (c <= 0xFFFF) {
    buf.u8[buf_offs++] = (c >> 12) | 0xE0;
    buf.u8[buf_offs++] = ((c >> 6) & 0x3F) | 0x80;
    buf.u8[buf_offs++] = (c & 0x3F) | 0x80;
  } else if (c <= 0x10FFFF) { // Note: technically can fit up to 0x1FFFFF here, but those code points are disallowed
    buf.u8[buf_offs++] = (c >> 18) | 0xF0;
    buf.u8[buf_offs++] = ((c >> 12) & 0x3F) | 0x80;
    buf.u8[buf_offs++] = ((c >> 6) & 0x3F) | 0x80;
    buf.u8[buf_offs++] = (c & 0x3F) | 0x80;
  } else {
    assert(false);
  }
  return buf_offs;
}

function poolBuf(dv) {
  // if it's poolable (not part of another Buffer), pool it!
  assert(dv);
  assert(dv.u8);
  let pool_idx = dv.packet_pool_idx;
  if (pool_idx) {
    let arr = buf_pool[pool_idx];
    if (arr.length < POOL_BUF_BY_SIZE[pool_idx]) {
      //console.log(`Buffer TOPOOL:${dv.byteLength}/${pool_idx}`);
      arr.push(dv);
    }
  } else {
    // console.log(`Buffer UNPOOLABLE:${dv.byteLength}`);
  }
}

export function packetBufPoolAlloc(size) {
  return allocDataView(size);
}
export function packetBufPoolFree(dv) {
  poolBuf(dv);
}


let default_flags = 0;
export function packetDefaultFlags() {
  return default_flags;
}

export function packetEnableDebug(enable) {
  if (enable) {
    default_flags |= PACKET_DEBUG;
  }
}

function Packet(flags, init_size, pak_debug) {
  this.reinit(flags, init_size, pak_debug);
}
Packet.prototype.reinit = function (flags, init_size, pak_debug) {
  this.flags = flags || 0;
  this.has_flags = false;
  this.buf = null;
  this.buf_len = 0;
  this.buf_offs = 0;
  this.bufs = null;
  this.bsizes = null;
  this.readable = false;
  this.ref_count = 1;
  this.pak_debug = pak_debug;
  if (init_size) {
    this.fit(init_size, true);
    this.buf_len = init_size;
  }
};
Packet.prototype.getRefCount = function () {
  return this.ref_count;
};
Packet.prototype.ref = function () {
  assert(this.ref_count); // must not already be pooled!
  ++this.ref_count;
};
Packet.prototype.pool = function () {
  assert(this.ref_count);
  if (--this.ref_count) {
    return;
  }
  // Do not clear on pool(), callers (readInt()) may still momentarily reference .buf, etc
  if (this.flags & PACKET_UNOWNED_BUFFER) {
    // doing nothing with buffers, still pooling the packet
  } else {
    if (this.buf) {
      poolBuf(this.buf);
    }
    if (this.bufs) {
      for (let ii = 0; ii < this.bufs.length; ++ii) {
        poolBuf(this.bufs[ii]);
      }
    }
  }
  if (pak_pool.length < POOL_PACKETS) {
    pak_pool.push(this);
  }
  if (this.pak_debug) {
    this.pak_debug.poolDebug();
  }
};

Packet.prototype.totalSize = function () {
  let ret = 0;
  if (this.readable) {
    return this.buf_len;
  }
  if (this.bsizes) {
    for (let ii = 0; ii < this.bsizes.length; ++ii) {
      ret += this.bsizes[ii];
    }
  }
  ret += this.buf_offs;
  return ret;
};

Packet.prototype.setReadable = function () {
  assert(this.buf);
  assert(!this.bufs);
  assert(!this.readable);
  this.readable = true;
};

Packet.prototype.makeReadable = function () {
  assert(this.buf);
  assert(!this.readable); // otherwise just reset offset? or do nothing?
  let total = this.totalSize(); // before this.readable = true
  this.readable = true;
  if (!this.bufs) {
    this.buf_len = total;
    this.buf_offs = 0;
    return;
  }
  let buf = allocDataView(total);
  let u8 = buf.u8;
  let offs = 0;
  for (let ii = 0; ii < this.bufs.length; ++ii) {
    let bsize = this.bsizes[ii];
    let dv = this.bufs[ii];
    if (offs + dv.u8.length > total) {
      // unused portion would overrun
      assert.equal(dv.byteOffset, 0);
      u8.set(new Uint8Array(dv.buffer, 0, bsize), offs);
    } else {
      u8.set(dv.u8, offs);
    }
    offs += bsize;
    poolBuf(dv);
  }
  assert.equal(this.buf.byteOffset, 0); // Would handle it, but should never happen here, these are our pooled buffers?
  u8.set(new Uint8Array(this.buf.buffer, this.buf.byteOffset, this.buf_offs), offs);
  poolBuf(this.buf);
  assert.equal(offs + this.buf_offs, total);
  this.bufs = this.bsizes = null;
  this.buf = buf;
  this.buf_offs = 0;
  this.buf_len = total; // buffer is actually buf.buffer.byteLength, but we can't read past `total`
};

Packet.prototype.flush = function () {
  let { buf, buf_offs } = this;
  if (!this.bufs) {
    this.bufs = [buf];
    this.bsizes = [buf_offs];
  } else {
    this.bufs.push(buf);
    this.bsizes.push(buf_offs);
  }
  this.buf = null;
  this.buf_len = 0;
  this.buf_offs = 0;
};
Packet.prototype.fit = function (extra_bytes, no_advance) {
  let { buf, buf_len, buf_offs } = this;
  let new_offs = buf_offs + extra_bytes;
  if (new_offs <= buf_len) {
    if (!no_advance) {
      this.buf_offs = new_offs;
    }
    return buf_offs;
  }
  assert(!this.readable); // Shouldn't happen on concatenated buffers
  if (buf) {
    this.flush();
  }
  this.buf_len = buf_len = max(PAK_BUF_DEFAULT_SIZE, extra_bytes);
  this.buf = allocDataView(buf_len);
  this.buf_offs = no_advance ? 0 : extra_bytes;
  return 0;
};
Packet.prototype.advance = function (bytes) {
  let offs = this.buf_offs;
  let new_offs = offs + bytes;
  this.buf_offs = new_offs;
  if (new_offs > this.buf_len) {
    throw new Error(UNDERRUN);
  }
  if (new_offs === this.buf_len) {
    this.pool();
  }
  return offs;
};
Packet.prototype.ended = function () {
  return this.buf_offs === this.buf_len;
};

// low-level write/read functions
Packet.prototype.writeU8 = function (v) {
  assert(v >= 0 && v < 256);
  let offs = this.fit(1);
  this.buf.u8[offs] = v;
};
Packet.prototype.readU8 = function () {
  return this.buf.u8[this.advance(1)];
};
// Packed int, first byte:
// 0-247 byte
// 248 positive 16-bit
// 249 negative 16-bit
// 250 positive 32-bit
// 251 negative 32-bit
// 252 positive 64-bit
// 253 negative 64-bit
// 254 unused
// 255 negative byte
export function packetSizeInt(v) {
  assert(isInteger(v));
  let neg = (v < 0) ? 1 : 0;
  if (neg) {
    v = -v;
  }
  if (v < 248) { // || neg && v < 256 would also decode right
    if (neg) {
      return 2;
    }
    return 1;
  } else {
    if (v < 65536) {
      return 3;
    } else if (v < 4294967296) {
      return 5;
    } else {
      return 9;
    }
  }
}
Packet.prototype.writeInt = function (v) {
  assert(isInteger(v));
  let offs = this.fit(9, true); // 9 is max size of a packed int
  let buf = this.buf;
  let neg = (v < 0) ? 1 : 0;
  if (neg) {
    v = -v;
  }
  if (v < 248) { // || neg && v < 256 would also decode right
    if (neg) {
      buf.u8[offs++] = 255;
    }
    buf.u8[offs++] = v;
  } else {
    if (v < 65536) {
      buf.u8[offs++] = 248 + neg;
      buf.setUint16(offs, v, true);
      offs += 2;
    } else if (v < 4294967296) {
      buf.u8[offs++] = 250 + neg;
      buf.setUint32(offs, v, true);
      offs += 4;
    } else {
      buf.u8[offs++] = 252 + neg;
      let low_bits = v >>> 0;
      buf.setUint32(offs, low_bits, true);
      offs += 4;
      buf.setUint32(offs, (v - low_bits) / 4294967296, true);
      offs += 4;
    }
  }
  this.buf_offs = offs;
};
Packet.prototype.zeroInt = function () {
  // Overwrite an existing int with a zero, keeping the same packed size
  let b1 = this.buf.u8[this.buf_offs];
  if (b1 < 248) {
    this.buf.u8[this.buf_offs++] = 0;
    return;
  }
  // Otherwise, leave header bit
  this.buf_offs++;
  let zeroes;
  switch (b1) {
    case 253:
    case 252:
      zeroes = 8;
      break;
    case 251:
    case 250:
      zeroes = 4;
      break;
    case 249:
    case 248:
      zeroes = 2;
      break;
    case 255:
      zeroes = 1;
      break;
    default:
      throw new Error('PKTERR_PACKED_INT');
  }
  while (zeroes) {
    --zeroes;
    this.buf.u8[this.buf_offs++] = 0;
  }
};

// Actual Node.js Buffer, not Uint8Array/DataView
// Speculative read, if there's enough data
export function packetReadIntFromBuffer(buf, offs, buf_len) {
  if (buf_len - offs < 1) {
    return null;
  }
  let b1 = buf[offs++];
  if (b1 < 248) {
    return { v: b1, offs };
  }
  let sign = 1;
  switch (b1) {
    case 249:
      sign = -1;
    case 248: { // eslint-disable-line no-fallthrough
      if (buf_len - offs < 2) {
        return null;
      }
      let v = sign * buf.readUInt16LE(offs);
      offs += 2;
      return { v, offs };
    }
    case 251:
      sign = -1;
    case 250: { // eslint-disable-line no-fallthrough
      if (buf_len - offs < 4) {
        return null;
      }
      let v = sign * buf.readUInt32LE(offs);
      offs += 4;
      return { v, offs };
    }
    case 253:
      sign = -1;
    case 252: { // eslint-disable-line no-fallthrough
      if (buf_len - offs < 8) {
        return null;
      }
      let low_bits = buf.readUInt32LE(offs);
      offs += 4;
      let high_bits = buf.readUInt32LE(offs);
      offs += 4;
      let v = sign * (high_bits * 4294967296 + low_bits);
      return { v, offs };
    }
    case 255: {
      if (buf_len - offs < 1) {
        return null;
      }
      let v = -buf[offs++];
      return { v, offs };
    }
    default:
      throw new Error('PKTERR_PACKED_INT');
  }
}

Packet.prototype.readInt = function () {
  let b1 = this.buf.u8[this.advance(1)];
  if (b1 < 248) {
    return b1;
  }
  let sign = 1;
  switch (b1) {
    case 249:
      sign = -1;
    case 248: // eslint-disable-line no-fallthrough
      return sign * this.buf.getUint16(this.advance(2), true);
    case 251:
      sign = -1;
    case 250: // eslint-disable-line no-fallthrough
      return sign * this.buf.getUint32(this.advance(4), true);
    case 253:
      sign = -1;
    case 252: { // eslint-disable-line no-fallthrough
      let low_bits = this.buf.getUint32(this.advance(4), true);
      let high_bits = this.buf.getUint32(this.advance(4), true);
      return sign * (high_bits * 4294967296 + low_bits);
    }
    case 255:
      return -this.buf.u8[this.advance(1)];
    default:
      throw new Error('PKTERR_PACKED_INT');
  }
};
Packet.prototype.writeFloat = function (v) {
  assert.equal(typeof v, 'number');
  if (!v) {
    this.buf.u8[this.fit(1)] = 0;
    return;
  }
  let offs = this.fit(5, true);
  this.buf.setFloat32(offs, v, true);
  if (this.buf.u8[offs] <= 1) { // escape a 0 or 1 in the first byte
    this.buf.u8[offs++] = 1;
    this.buf.setFloat32(offs, v, true);
  }
  this.buf_offs = offs + 4;
};
Packet.prototype.readFloat = function () {
  let offs = this.advance(1);
  let b1 = this.buf.u8[offs];
  if (!b1) {
    return 0;
  }
  if (b1 === 1) {
    return this.buf.getFloat32(this.advance(4), true);
  }
  this.advance(3);
  return this.buf.getFloat32(offs, true);
};
Packet.prototype.writeU32 = function (v) {
  assert.equal(typeof v, 'number');
  this.buf.setUint32(this.fit(4), v, true);
};
Packet.prototype.readU32 = function () {
  return this.buf.getUint32(this.advance(4), true);
};
// Note this is not quite serializing the same as UTF-8 when dealing with surrogate
//   pairs, such as code point U+1F303 which is represented by character codes
//   0xD83C, 0xDF03, and would technically be <f0 9f 8c 83> in UTF-8, but we
//   serialize as two separate characters.  When deserialized in the same way,
//   this reconstructs the same original string, without losing the ability to
//   serialize some otherwise valid JavaScript strings (e.g. just one char
//   code 0xD83C) like with Node.js's Buffer's utf8 implementation.
Packet.prototype.writeString = function (v) {
  assert.equal(typeof v, 'string'); // Could maybe do a toString() here if not
  let byte_length = utf8ByteLength(v);
  this.writeInt(byte_length); // Just 1 byte for small strings
  if (!byte_length) {
    return;
  }
  let offs = this.fit(byte_length);
  let buf = this.buf;
  for (let ii = 0; ii < v.length; ++ii) {
    let c = v.charCodeAt(ii);
    if (c <= 0x7F) {
      buf.u8[offs++] = c;
    } else {
      offs = utf8WriteChar(buf, offs, c);
    }
  }
};
// Only called on multi-byte characters; Supplied the first byte for efficiency
Packet.prototype.utf8ReadChar = function (c) {
  let buf = this.buf;
  if (c >= 0xC0 && c < 0xE0) {
    return ((c & 0x1F) << 6) |
      (buf.u8[this.buf_offs++] & 0x3F);
  } else if (c >= 0xE0 && c < 0xF0) {
    return ((c & 0x0F) << 12) |
      ((buf.u8[this.buf_offs++] & 0x3F) << 6) |
      (buf.u8[this.buf_offs++] & 0x3F);
  } else if (c >= 0xF0 && c < 0xF8) {
    return ((c & 0x0F) << 18) |
      ((buf.u8[this.buf_offs++] & 0x3F) << 12) |
      ((buf.u8[this.buf_offs++] & 0x3F) << 6) |
      (buf.u8[this.buf_offs++] & 0x3F);
  } else { // c >= 0x80 & c < 0xC0 or c >= 0xF8
    // Illegal continuation character, or old-spec 5-byte/6-byte UTF-8 encoding
    //   Regardless, was not generated by our utf8WriteChar().
    return 0xFFFD;
  }
};

let string_assembly = [];
Packet.prototype.readString = function () {
  let byte_length = this.readInt();
  if (!byte_length) {
    return '';
  }
  if (this.buf_offs + byte_length > this.buf_len) {
    throw new Error(UNDERRUN);
  }

  let { buf } = this;
  let end_offset = this.buf_offs + byte_length;
  let ret;
  if (byte_length > 8192) {
    ret = '';
    while (this.buf_offs < end_offset) {
      let c = buf.u8[this.buf_offs++];
      if (c > 0x7F) {
        c = this.utf8ReadChar(c);
      }
      ret += String.fromCharCode(c);
    }
  } else {
    string_assembly.length = byte_length;
    let ii = 0;
    while (this.buf_offs < end_offset) {
      let c = buf.u8[this.buf_offs++];
      if (c > 0x7F) {
        c = this.utf8ReadChar(c);
      }
      string_assembly[ii++] = c;
    }
    if (string_assembly.length !== ii) {
      // truncate if multi-byte UTF8 produced single characters
      string_assembly.length = ii;
    }
    ret = String.fromCharCode.apply(undefined, string_assembly);
  }
  if (this.buf_offs === this.buf_len) {
    this.pool();
  }
  return ret;
};
// Much more efficient than writeString if the input is known to be ANSI-ish (all characters <= 255)
Packet.prototype.writeAnsiString = function (v) {
  assert.equal(typeof v, 'string'); // Could maybe do a toString() here if not
  let byte_length = v.length;
  this.writeInt(byte_length);
  let offs = this.fit(byte_length);
  let { buf } = this;
  for (let ii = 0; ii < byte_length; ++ii) {
    buf.u8[offs++] = v.charCodeAt(ii);
  }
};
Packet.prototype.readAnsiString = function () {
  let len = this.readInt();
  if (!len) {
    return '';
  }
  let offs = this.advance(len);
  let { buf } = this;
  string_assembly.length = len;
  for (let ii = 0; ii < len; ++ii) {
    string_assembly[ii] = buf.u8[offs++];
  }
  return String.fromCharCode.apply(undefined, string_assembly);
};
export function packetSizeAnsiString(v) {
  return packetSizeInt(v.length) + v.length;
}

// high-level write/read functions
Packet.prototype.writeJSON = function (v) {
  if (!v) {
    let idx = FALSYS.indexOf(v);
    assert(idx !== -1);
    this.writeU8(idx + 1);
    return;
  }
  this.writeU8(0);
  this.writeString(JSON.stringify(v));
};
Packet.prototype.readJSON = function () {
  let byte = this.readU8();
  if (byte) {
    if (byte - 1 >= FALSYS.length) {
      throw new Error('PKTERR_JSON_HEADER');
    }
    return FALSYS[byte - 1];
  }
  let str = this.readString();
  return JSON.parse(str);
};
// Uint8Array or Buffer object?
Packet.prototype.writeBuffer = function (v) {
  this.writeInt(v.length);
  if (v.length) {
    let offs = this.fit(v.length);
    this.buf.u8.set(v, offs);
  }
};
const null_buf = new Uint8Array(0);
Packet.prototype.readBuffer = function (do_copy) {
  let len = this.readInt();
  if (!len) {
    return null_buf;
  }
  let offs = this.advance(len);
  if (do_copy) {
    return this.buf.u8.slice(offs, offs + len);
  } else {
    let { buf } = this;
    return new Uint8Array(buf.buffer, buf.byteOffset + offs, len);
  }
};
Packet.prototype.appendBuffer = function (v) {
  if (v.length) {
    let offs = this.fit(v.length);
    this.buf.u8.set(v, offs);
  }
};
Packet.prototype.writeBool = function (v) {
  this.writeU8(v?1:0);
};
Packet.prototype.readBool = function () {
  return Boolean(this.readU8());
};

Packet.prototype.append = function (pak) {
  assert.equal(this.flags & FLAG_PACKET_INTERNAL, pak.flags & FLAG_PACKET_INTERNAL);
  if (pak.bufs) {
    for (let ii = 0; ii < pak.bufs.length; ++ii) {
      let buf = pak.bufs[ii];
      let bsize = pak.bsizes[ii];
      let offs = this.fit(bsize);
      if (bsize !== buf.byteLength) {
        this.buf.u8.set(new Uint8Array(buf.buffer, buf.byteOffset, bsize), offs);
      } else {
        this.buf.u8.set(buf.u8, offs);
      }
    }
  }
  if (pak.buf) {
    let buf = pak.buf;
    let bsize = pak.readable ? pak.buf_len : pak.buf_offs;
    let offs = this.fit(bsize);
    if (bsize !== buf.byteLength) {
      this.buf.u8.set(new Uint8Array(buf.buffer, buf.byteOffset, bsize), offs);
    } else {
      this.buf.u8.set(buf.u8, offs);
    }
  }
};

Packet.prototype.appendRemaining = function (pak) {
  assert.equal(this.flags & FLAG_PACKET_INTERNAL, pak.flags & FLAG_PACKET_INTERNAL);
  assert(pak.readable);
  assert(!pak.bufs);
  assert(pak.buf);
  assert(pak.buf_offs <= pak.buf_len);
  let bsize = pak.buf_len - pak.buf_offs;
  if (bsize) {
    let offs = this.fit(bsize);
    this.buf.u8.set(new Uint8Array(pak.buf.buffer, pak.buf.byteOffset + pak.buf_offs, bsize), offs);
  }
  // everything consumed, pool it
  pak.pool();
};

Packet.prototype.toJSON = function () {
  let ret = {
    f: this.flags,
  };

  if (this.bufs) {
    ret.b = [];
    for (let ii = 0; ii < this.bufs.length; ++ii) {
      ret.b.push(base64Encode(this.bufs[ii], 0, this.bsizes[ii]));
    }
  }
  if (this.buf) {
    if (this.readable) {
      ret.d = base64Encode(this.buf, 0, this.buf_len);
    } else {
      ret.d = base64Encode(this.buf, 0, this.buf_offs);
    }
  }
  return ret;
};

Packet.prototype.setBuffer = function (buf, buf_len) {
  assert(!this.buf);
  assert(!this.bufs);
  assert(this.flags & PACKET_UNOWNED_BUFFER); // Probably okay if not?
  assert(buf instanceof Uint8Array);
  this.buf = wrapU8AsDataView(buf);
  this.buf_len = buf_len;
  this.readable = true;
};

Packet.prototype.getBuffer = function () {
  assert(this.buf);
  assert(!this.bufs);
  return this.buf.u8;
};

Packet.prototype.getBufferLen = function () {
  assert(this.buf);
  assert(!this.bufs);
  return this.readable ? this.buf_len : this.buf_offs;
};

Packet.prototype.getOffset = function () {
  if (this.readable) {
    return this.buf_offs;
  }
  return this.totalSize();
};

Packet.prototype.seek = function (pos) {
  assert(this.readable); // .makeReadable should be called so that it is a single buffer
  assert(pos >= 0 && pos <= this.buf_len);
  this.buf_offs = pos;
};

Packet.prototype.writeFlags = function () {
  assert(!this.has_flags);
  assert.equal(this.buf_offs, 0);
  this.writeU8(this.flags);
  this.has_flags = true;
};

Packet.prototype.updateFlags = function (flags) {
  assert(this.has_flags);
  assert(!(flags & FLAG_PACKET_INTERNAL));
  this.flags = this.flags & FLAG_PACKET_INTERNAL | flags;
  let buf = this.bufs ? this.bufs[0] : this.buf;
  buf.u8[0] = this.flags;
};

Packet.prototype.readFlags = function () {
  let read = this.readU8();
  assert.equal(read, this.flags & 0xFF);
  this.has_flags = true;
  return this.flags;
};

Packet.prototype.getFlags = function () {
  return this.flags;
};

Packet.prototype.getInternalFlags = function () {
  return this.flags & FLAG_PACKET_INTERNAL;
};

Packet.prototype.contents = function () {
  return `pak(${this.totalSize()}b)`;
};

function PacketDebug(flags, init_size) {
  this.reinit(flags, init_size);
}
PacketDebug.prototype.reinit = function (flags, init_size) {
  this.in_pool = false;
  if (pak_pool.length) {
    this.pak = pak_pool.pop();
    this.pak.reinit(flags, init_size, this);
  } else {
    this.pak = new Packet(flags, init_size, this);
  }
  this.warned = false;
  this.pool_timer = setTimeout(() => {
    console.warn(`Packet not pooled after 5s: ${this.contents()}`);
    this.warned = true;
  }, POOL_TIMEOUT);
};
PacketDebug.prototype.poolDebug = function () {
  if (this.warned) {
    console.warn('Packet pooled after timeout');
  } else {
    clearTimeout(this.pool_timer);
  }
  assert(!this.in_pool);
  this.in_pool = true; // Set this, as if pooled, even if discarded
  if (pak_debug_pool.length < POOL_PACKETS) {
    pak_debug_pool.push(this);
  }
};
const types = [null, 'U8', 'U32', 'Int', 'Float', 'String', 'AnsiString', 'JSON', 'Bool', 'Buffer'];
// Functions (types) that read and write a debug byte
types.forEach((type, idx) => {
  if (!type) { // don't use debug ID 0
    return;
  }
  let write = `write${type}`;
  let read = `read${type}`;
  let write_fn = Packet.prototype[write];
  let read_fn = Packet.prototype[read];
  PacketDebug.prototype[write] = function (v) {
    this.pak.writeU8(idx);
    write_fn.call(this.pak, v);
  };
  PacketDebug.prototype[read] = function (param) {
    let found_idx = this.pak.readU8();
    if (found_idx !== idx) {
      assert(false, `PacketDebug error: Expected ${type}(${idx}), found ${types[found_idx]}(${found_idx})`);
    }
    return read_fn.call(this.pak, param);
  };
});
PacketDebug.prototype.zeroInt = function () {
  this.pak.writeU8(3); // types.indexof('Int')
  this.pak.zeroInt();
};
// Functions that simply fall through
[
  'ended',
  'getBuffer',
  'getBufferLen',
  'getFlags',
  'getInternalFlags',
  'getOffset',
  'getRefCount',
  'makeReadable',
  'pool',
  'readFlags', // *not* wrapped in debug headers
  'ref',
  'seek',
  'setBuffer',
  'setReadable',
  'toJSON',
  'totalSize',
  'updateFlags',
  'writeFlags', // *not* wrapped in debug headers
  'appendBuffer', // low-level
].forEach((fname) => {
  let fn = Packet.prototype[fname];
  PacketDebug.prototype[fname] = function () {
    return fn.apply(this.pak, arguments); // eslint-disable-line prefer-rest-params
  };
});
PacketDebug.prototype.append = function (pak) {
  assert(pak instanceof PacketDebug);
  this.pak.append(pak.pak);
};
PacketDebug.prototype.appendRemaining = function (pak) {
  assert(pak instanceof PacketDebug);
  this.pak.appendRemaining(pak.pak);
};
function format(v) {
  switch (typeof v) {
    case 'object':
      if (v instanceof Uint8Array) {
        return `u8<${v.length}>`;
      }
      return JSON.stringify(v);
    default:
      return v;
  }
}
PacketDebug.prototype.contents = function () {
  let { pak } = this;
  let cur_offs = pak.getOffset();
  let read_len = cur_offs;
  let ret = [`buf:${pak.buf_offs}/${pak.buf_len}`];
  if (pak.bufs) {
    // write packet, just combine and reset location when done
    pak.makeReadable();
    ret.push('bufs');
  } else if (pak.buf) {
    // read packet, or write packet that is a single buf
    if (pak.readable) {
      read_len = pak.buf_len;
    }
    pak.buf_offs = 0;
  } else {
    ret.push('empty');
    read_len = -1;
  }
  let saved_ref_count = pak.ref_count;
  pak.ref_count = 2; // prevent auto pooling, don't assert on ref() if unref'd.
  try {
    if (!saved_ref_count) {
      ret.push('!ref_count=0!');
    }
    if (pak.has_flags) {
      ret.push(`flags:${pak.readU8()}`);
    }
    while (pak.buf_offs < read_len) {
      let type_idx = pak.readU8();
      let type = types[type_idx];
      if (!type) {
        ret.push(`UnknownType:${type_idx}`);
        break;
      }
      let val = pak[`read${type}`]();
      ret.push(`${type}:${format(val)}`);
    }
  } catch (e) {
    ret.push(`Error dumping packet contents: ${e}`);
  }
  pak.ref_count = saved_ref_count;
  pak.buf_offs = cur_offs;
  return ret.join(',');
};

function packetCreate(flags, init_size) {
  if (flags === undefined) {
    flags = default_flags;
  }
  let pool = (flags & PACKET_DEBUG) ? pak_debug_pool : pak_pool;
  if (pool.length) {
    let pak = pool.pop();
    pak.reinit(flags, init_size);
    return pak;
  }
  if (flags & PACKET_DEBUG) {
    return new PacketDebug(flags, init_size);
  }
  return new Packet(flags, init_size);
}
exports.packetCreate = packetCreate;

function packetFromBuffer(buf, buf_len, need_copy) {
  let flags = buf[0];
  assert.equal(typeof flags, 'number'); // `buf` should be a Buffer or Uint8Array, not a DataView like other funcs here
  if (need_copy) {
    assert(buf_len);
    assert(buf.buffer instanceof ArrayBuffer);
    let pak = packetCreate(flags, buf_len);
    if (buf.byteLength !== buf_len) {
      buf = Buffer.from(buf.buffer, buf.byteOffset, buf_len);
    }
    pak.getBuffer().set(buf);
    pak.setReadable();
    return pak;
  } else {
    // reference unowned/unpoolable buffer
    assert(buf instanceof Uint8Array);
    let pak = packetCreate(flags | PACKET_UNOWNED_BUFFER);
    pak.setBuffer(buf, buf_len || buf.byteLength);
    return pak;
  }
}
exports.packetFromBuffer = packetFromBuffer;

function packetFromJSON(js_obj) {
  let pak = packetCreate(js_obj.f);

  let payload = pak.pak || pak;

  function decode(str) {
    return base64Decode(str, allocDataView);
  }
  if (js_obj.b) {
    payload.bsizes = [];
    payload.bufs = [];
    for (let ii = 0; ii < js_obj.b.length; ++ii) {
      let buf = decode(js_obj.b[ii]);
      payload.bufs.push(buf);
      payload.bsizes.push(buf.decode_size);
      delete buf.decode_size;
    }
  }
  if (js_obj.d) {
    payload.buf = decode(js_obj.d);
    payload.buf_len = payload.buf.decode_size;
    delete payload.buf.decode_size;
    payload.buf_offs = 0;
  }

  return pak;
}
exports.packetFromJSON = packetFromJSON;

function isPacket(thing) {
  return thing instanceof Packet || thing instanceof PacketDebug;
}
exports.isPacket = isPacket;
