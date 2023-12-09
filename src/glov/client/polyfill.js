/* eslint no-extend-native:off */

// TypedArray.slice, fill, join, sort, etc - not supported on IE, some older Safari, older Android, Chrome 44
let typedarrays = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array];

if (!Uint8Array.prototype.slice) {
  typedarrays.forEach(function (ArrayType) {
    Object.defineProperty(ArrayType.prototype, 'slice', {
      value: function (begin, end) {
        if (end === undefined) {
          end = this.length;
        }
        if (end < 0) {
          end = this.length - end;
        }
        begin = begin || 0;
        if (begin >= this.length) {
          begin = this.length - 1;
        }
        if (end > this.length) {
          end = this.length;
        }
        if (end < begin) {
          end = begin;
        }
        let len = end - begin;
        let ret = new ArrayType(len);
        for (let ii = 0; ii < len; ++ii) {
          ret[ii] = this[begin + ii];
        }
        return ret;
      }
    });
  });
}

function cmpDefault(a, b) {
  return a - b;
}
let replacements = {
  join: function (delim) {
    return Array.prototype.join.call(this, delim);
  },
  fill: function (value, begin, end) {
    if (end === undefined) {
      end = this.length;
    }
    for (let ii = begin || 0; ii < end; ++ii) {
      this[ii] = value;
    }
    return this;
  },
  sort: function (cmp) {
    Array.prototype.sort.call(this, cmp || cmpDefault);
  },
};

for (let key in replacements) {
  if (!Uint8Array.prototype[key]) {
    typedarrays.forEach(function (ArrayType) {
      Object.defineProperty(ArrayType.prototype, key, {
        value: replacements[key],
      });
    });
  }
}

if (!String.prototype.endsWith) {
  Object.defineProperty(String.prototype, 'endsWith', {
    value: function (test) {
      return this.slice(-test.length) === test;
    },
  });
  Object.defineProperty(String.prototype, 'startsWith', {
    value: function (test) {
      return this.slice(0, test.length) === test;
    },
  });
}
if (!String.prototype.includes) {
  Object.defineProperty(String.prototype, 'includes', {
    value: function (search, start) {
      return this.indexOf(search, start) !== -1;
    },
    configurable: true, // FRVR SDK polyfill overrides this :(
  });
}

if (!Array.prototype.includes) {
  Object.defineProperty(Array.prototype, 'includes', {
    value: function (search, start) {
      start = start === undefined ? 0 : start < 0 ? this.length + start : start;
      for (let ii = start; ii < this.length; ++ii) {
        if (this[ii] === search) {
          return true;
        }
      }
      return false;
    },
    // Doesn't handle `Array(1).includes()==true` expected in frvr-sdk.ie.min.js
    // value: function (search, start) {
    //   return this.indexOf(search, start) !== -1;
    // },
  });
}

if (!Object.values) {
  Object.values = function values(obj) {
    return Object.keys(obj).map((k) => obj[k]);
  };
}
if (!Object.entries) {
  Object.entries = function entries(obj) {
    let keys = Object.keys(obj);
    let ret = new Array(keys.length);
    for (let ii = keys.length - 1; ii >= 0; --ii) {
      ret[ii] = [keys[ii], obj[keys[ii]]];
    }
    return ret;
  };
}
// if (!Object.fromEntries) { // For FRVR SDK
//   Object.fromEntries = function (iterable) {
//     let keys = Object.keys(iterable);
//     let obj = {};
//     for (let ii = 0; ii < keys.length; ++ii) {
//       let pair = iterable[keys[ii]];
//       obj[pair[0]] = pair[1];
//     }
//     return obj;
//   };
//   Object.fromEntries.is_polyfill = true;
// }

if (!Object.assign) {
  Object.assign = function assign(target, source1) {
    for (let argindex = 1; argindex < arguments.length; ++argindex) {
      // eslint-disable-next-line prefer-rest-params
      let source = arguments[argindex];
      for (let key in source) {
        target[key] = source[key];
      }
    }
    return target;
  };
}

if (!Math.sign) {
  Math.sign = function sign(a) {
    return a < 0 ? -1 : a > 0 ? 1 : 0;
  };
}

if (typeof window !== 'undefined') {
  if (!window.Intl) {
    window.Intl = {};
  }
  if (!window.Intl.NumberFormat) {
    window.Intl.NumberFormat = function () {
      // Constructor
    };
    window.Intl.NumberFormat.prototype.format = function (v) {
      return String(v);
    };
  }
  if (!window.Intl.DateTimeFormat) {
    window.Intl.DateTimeFormat = function () {
      // Constructor
    };
    window.Intl.DateTimeFormat.prototype.format = function (v) {
      return String(v);
    };
  }
}
