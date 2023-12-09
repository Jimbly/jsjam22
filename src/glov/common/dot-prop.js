/* eslint prefer-template:off */
// From https://github.com/sindresorhus/dot-prop
// MIT License
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

// Adjusted to work on old browsers (if through Babel) and to not crash on Arrays

const { arrayToSet } = require('./util.js');

const disallowedKeys = arrayToSet([
  '__proto__',
  'prototype',
  'constructor'
]);

function isObject(value) {
  const type = typeof value;
  return value !== null && (type === 'object' || type === 'function');
}

function isValidPath(pathSegments) {
  for (let ii = 0; ii < pathSegments.length; ++ii) {
    if (disallowedKeys[pathSegments[ii]]) {
      return false;
    }
  }
  return true;
}

function getPathSegments(path) {
  const pathArray = path.split('.');
  const parts = [];

  for (let i = 0; i < pathArray.length; i++) {
    let p = pathArray[i];

    while (p[p.length - 1] === '\\' && pathArray[i + 1] !== undefined) {
      p = p.slice(0, -1) + '.';
      p += pathArray[++i];
    }

    parts.push(p);
  }

  if (!isValidPath(parts)) {
    return [];
  }

  return parts;
}

export function dotPropGet(object, path, value) {
  if (!isObject(object) || typeof path !== 'string') {
    return value === undefined ? object : value;
  }

  const pathArray = getPathSegments(path);
  if (pathArray.length === 0) {
    return value;
  }

  for (let i = 0; i < pathArray.length; i++) {
    object = object[pathArray[i]];

    if (object === undefined || object === null) {
      // `object` is either `undefined` or `null` so we want to stop the loop, and
      // if this is not the last bit of the path, and
      // if it did't return `undefined`
      // it would return `null` if `object` is `null`
      // but we want `get({foo: null}, 'foo.bar')` to equal `undefined`, or the supplied value, not `null`
      if (i !== pathArray.length - 1) {
        return value;
      }

      break;
    }
  }

  return object === undefined ? value : object;
}

export function dotPropSet(object, path, value) {
  if (!isObject(object) || typeof path !== 'string') {
    return object;
  }

  const root = object;
  const pathArray = getPathSegments(path);

  for (let i = 0; i < pathArray.length; i++) {
    const p = pathArray[i];

    if (i === pathArray.length - 1) {
      object[p] = value;
    } else if (!isObject(object[p])) {
      object[p] = {};
    }


    object = object[p];
  }

  return root;
}

// eslint-disable-next-line consistent-return
export function dotPropDelete(object, path) {
  if (!isObject(object) || typeof path !== 'string') {
    return false;
  }

  const pathArray = getPathSegments(path);

  for (let i = 0; i < pathArray.length; i++) {
    const p = pathArray[i];

    if (i === pathArray.length - 1) {
      delete object[p];
      return true;
    }

    object = object[p];

    if (!isObject(object)) {
      return false;
    }
  }
}

export function dotPropHas(object, path) {
  if (!isObject(object) || typeof path !== 'string') {
    return false;
  }

  const pathArray = getPathSegments(path);
  if (pathArray.length === 0) {
    return false;
  }

  for (let i = 0; i < pathArray.length; i++) {
    if (isObject(object)) {
      if (!(pathArray[i] in object)) {
        return false;
      }

      object = object[pathArray[i]];
    } else {
      return false;
    }
  }

  return true;
}

// Legacy APIs
exports.get = dotPropGet;
exports.set = dotPropSet;
exports.delete = dotPropDelete;
exports.has = dotPropHas;
