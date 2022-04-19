// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const { eatPossiblePromise } = require('glov/common/util.js');

let user_want_locked = false;
let elem;
let on_ptr_lock;

export function isLocked() {
  return user_want_locked; // Either it's locked, or there's an async attempt to lock it outstanding
}

function pointerLog(msg) {
  console.log(`PointerLock: ${msg}`); // TODO: Disable this after things settle
}

export function exit() {
  pointerLog('Lock exit requested');
  user_want_locked = false;
  eatPossiblePromise(document.exitPointerLock());
}

export function enter(when) {
  user_want_locked = true;
  on_ptr_lock();
  pointerLog(`Trying pointer lock in response to ${when}`);
  eatPossiblePromise(elem.requestPointerLock());
}

function onPointerLockChange() {
  if (document.pointerLockElement || document.mozPointerLockElement || document.webkitPointerLockElement) {
    pointerLog('Lock successful');
    if (!user_want_locked) {
      pointerLog('User canceled lock');
      eatPossiblePromise(document.exitPointerLock());
    }
  } else {
    if (user_want_locked) {
      pointerLog('Lock lost');
      user_want_locked = false;
    }
  }
}

function onPointerLockError(e) {
  pointerLog('Error');
  user_want_locked = false;
}

export function startup(_elem, _on_ptr_lock) {
  elem = _elem;
  on_ptr_lock = _on_ptr_lock;

  elem.requestPointerLock = elem.requestPointerLock || elem.mozRequestPointerLock ||
    elem.webkitRequestPointerLock || function () { /* nop */ };
  document.exitPointerLock = document.exitPointerLock || document.mozExitPointerLock ||
    document.webkitExitPointerLock || function () { /* nop */ };

  document.addEventListener('pointerlockchange', onPointerLockChange, false);
  document.addEventListener('mozpointerlockchange', onPointerLockChange, false);
  document.addEventListener('webkitpointerlockchange', onPointerLockChange, false);

  document.addEventListener('pointerlockerror', onPointerLockError, false);
  document.addEventListener('mozpointerlockerror', onPointerLockError, false);
  document.addEventListener('webkitpointerlockerror', onPointerLockError, false);
}
