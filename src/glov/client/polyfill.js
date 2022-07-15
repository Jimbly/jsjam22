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
  });
}

if (!Array.prototype.includes) {
  Object.defineProperty(Array.prototype, 'includes', {
    value: function (search, start) {
      return this.indexOf(search, start) !== -1;
    },
  });
}

if (!Object.values) {
  Object.values = function values(obj) {
    return Object.keys(obj).map((k) => obj[k]);
  };
}

if (!Math.sign) {
  Math.sign = function sign(a) {
    return a < 0 ? -1 : a > 0 ? 1 : 0;
  };
}
