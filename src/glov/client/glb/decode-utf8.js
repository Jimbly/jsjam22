/* eslint no-bitwise:off */
// From https://stackoverflow.com/questions/8936984/uint8array-to-string-in-javascript

let charCache = new Array(128);  // Preallocate the cache for the common single byte chars
let charFromCodePt = String.fromCodePoint || String.fromCharCode;
let result = [];
export function decode(array) {
  let codePt;
  let byte1;
  let buffLen = array.length;

  result.length = 0;

  for (let i = 0; i < buffLen;) {
    byte1 = array[i++];

    if (byte1 <= 0x7F) {
      codePt = byte1;
    } else if (byte1 <= 0xDF) {
      codePt = ((byte1 & 0x1F) << 6) | (array[i++] & 0x3F);
    } else if (byte1 <= 0xEF) {
      codePt = ((byte1 & 0x0F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
    } else if (String.fromCodePoint) {
      codePt = ((byte1 & 0x07) << 18) | ((array[i++] & 0x3F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
    } else {
      codePt = 63;    // Cannot convert four byte code points, so use "?" instead
      i += 3;
    }

    result.push(charCache[codePt] || (charCache[codePt] = charFromCodePt(codePt)));
  }

  return result.join('');
}
