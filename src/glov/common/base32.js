/* eslint indent:off, no-multi-spaces:off */
const { floor, random } = Math;

// From Crockford's Base32, no confusing letters/numbers
let to_base_32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let char_table = to_base_32.split('');

// Tables including lower case and confusing letters (L, l, i, I, o, O)

// let to_binary = [
//   -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
//   -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
//   -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
//    0, 1, 2, 3,  4, 5, 6, 7,  8, 9,-1,-1, -1,-1,-1,-1,
//   -1,10,11,12, 13,14,15,16, 17, 1,18,19,  1,20,21, 0,
//   22,23,24,25, 26,-1,27,28, 29,30,31,-1, -1,-1,-1,-1,
//   -1,10,11,12, 13,14,15,16, 17, 1,18,19,  1,20,21, 0,
//   22,23,24,25, 26,-1,27,28, 29,30,31,-1, -1,-1,-1,-1
// ];
let to_cannon_table = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 0, 0, 0, 0, 0, 0,
  0, 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', '1', 'J', 'K', '1', 'M', 'N', '0',
  'P', 'Q', 'R', 'S', 'T', 0, 'V', 'W', 'X', 'Y', 'Z', 0, 0, 0, 0, 0,
  0, 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', '1', 'J', 'K', '1', 'M', 'N', '0',
  'P', 'Q', 'R', 'S', 'T', 0, 'V', 'W', 'X', 'Y', 'Z',
];
// Also strip out ignorable characters
(function () {
  let strip = ' -–.,\t\n\r';
  for (let ii = 0; ii < strip.length; ++ii) {
    to_cannon_table[strip.charCodeAt(ii)] = '';
  }
}());
// let to_cannon = {
//   '0':'0', '1':'1', '2':'2', '3':'3', '4':'4', '5':'5', '6':'6', '7':'7', '8':'8', '9':'9',
//   A:'A', B:'B', C:'C', D:'D', E:'E', F:'F', G:'G', H:'H', I:'1',
//   J:'J', K:'K', L:'1', M:'M', N:'N', O:'0', P:'P', Q:'Q', R:'R',
//   S:'S', T:'T', V:'V', W:'W', X:'X', Y:'Y', Z:'Z',
//   a:'A', b:'B', c:'C', d:'D', e:'E', f:'F', g:'G', h:'H', i:'1',
//   j:'J', k:'K', l:'1', m:'M', n:'N', o:'0', p:'P', q:'Q', r:'R',
//   s:'S', t:'T', v:'V', w:'W', x:'X', y:'Y', z:'Z',
// };

export function cannonize(str) {
  let ret = [];
  for (let ii = 0; ii < str.length; ++ii) {
    let new_char = to_cannon_table[str.charCodeAt(ii)];
    if (new_char === '') {
      // skipable char
      continue;
    } else if (!new_char) {
      // invalid char
      return null;
    }
    ret.push(new_char);
  }
  return ret.join('');
}

export function gen(length) {
  let ret = [];
  for (let ii = 0; ii < length; ++ii) {
    ret.push(char_table[floor(random() * 32)]);
  }
  return ret.join('');
}

export function addDashes(str) {
  let segs = floor(str.length / 4);
  let ret = [];
  for (let ii = 0; ii < segs; ++ii) {
    ret.push(str.slice(ii*4, ii*4+4));
  }
  return ret.join('-');
}
