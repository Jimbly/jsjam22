// From 'fscreen' module, https://github.com/rafrex/fscreen, MIT Licensed

// Changes:
//   Fixed depending on Object.keys() ordering
//   Standardized exports with more meaningful names
//   Added ability to disable

const { eatPossiblePromise } = require('glov/common/util.js');

const key = {
  fullscreenEnabled: 0,
  fullscreenElement: 1,
  requestFullscreen: 2,
  exitFullscreen: 3,
//  fullscreenchange: 4,
//  fullscreenerror: 5,
};

const html5 = [
  'fullscreenEnabled',
  'fullscreenElement',
  'requestFullscreen',
  'exitFullscreen',
  // 'fullscreenchange',
  // 'fullscreenerror',
];

const webkit = [
  'webkitFullscreenEnabled',
  'webkitFullscreenElement',
  'webkitRequestFullscreen',
  'webkitExitFullscreen',
  // 'webkitfullscreenchange',
  // 'webkitfullscreenerror',
];

const moz = [
  'mozFullScreenEnabled',
  'mozFullScreenElement',
  'mozRequestFullScreen',
  'mozCancelFullScreen',
  // 'mozfullscreenchange',
  // 'mozfullscreenerror',
];

const ms = [
  'msFullscreenEnabled',
  'msFullscreenElement',
  'msRequestFullscreen',
  'msExitFullscreen',
  // 'MSFullscreenChange',
  // 'MSFullscreenError',
];

// const document = typeof window !== 'undefined' && typeof window.document !== 'undefined' ? window.document : {};

const vendor = (
  (html5[0] in document && html5) ||
  (webkit[0] in document && webkit) ||
  (moz[0] in document && moz) ||
  (ms[0] in document && ms) ||
  []
);

export function fscreenEnter() {
  let element = document.documentElement;
  eatPossiblePromise(element[vendor[key.requestFullscreen]]());
}
export function fscreenExit() {
  eatPossiblePromise(document[vendor[key.exitFullscreen]]());
}
// export function addEventListener(type, handler, options) {
//   document.addEventListener(vendor[key[type]], handler, options);
// }
// export function removeEventListener(type, handler, options) {
//   document.removeEventListener(vendor[key[type]], handler, options);
// }
let disabled = false;
export function fscreenAvailable() {
  return !disabled && Boolean(document[vendor[key.fullscreenEnabled]]);
}
export function fscreenDisable() {
  disabled = true;
}
export function fscreenActive() {
  return document[vendor[key.fullscreenElement]];
}
// set onfullscreenchange(handler) { return document[`on${vendor[key.fullscreenchange]}`.toLowerCase()] = handler; },
// set onfullscreenerror(handler) { return document[`on${vendor[key.fullscreenerror]}`.toLowerCase()] = handler; },
