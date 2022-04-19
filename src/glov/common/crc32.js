// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Possibly originally from PNG Specification Appendix: https://www.w3.org/TR/PNG-CRCAppendix.html

// Table of CRCs of all 8-bit messages.
let crc_table = new Array(256);

// Make the table for a fast CRC.
(function () {
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = -306674912 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    crc_table[n] = c;
  }
}());


/* Update a running CRC with the bytes buf[0..len-1]--the CRC
should be initialized to all 1's, and the transmitted value
is the 1's complement of the final running CRC (see the
crc32() routine below)). */

function update_crc(crc, buf, len) {
  for (let n = 0; n < len; n++) {
    crc = crc_table[(crc ^ buf[n]) & 0xff] ^ (crc >>> 8);
  }
  return crc;
}

// Return the CRC of the bytes buf[0..len-1].
function crc32(buf, len) {
  len = len || buf.length;
  return (update_crc(0xffffffff, buf, len) ^ 0xffffffff) >>> 0;
}
module.exports = crc32;
module.exports.crc32 = crc32;
