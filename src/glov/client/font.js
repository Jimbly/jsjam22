// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-bitwise:off, complexity:off, @typescript-eslint/no-shadow:off */

/* eslint-disable import/order */
const assert = require('assert');
const camera2d = require('./camera2d.js');
const engine = require('./engine.js');
const geom = require('./geom.js');
const { getStringFromLocalizable } = require('./localization.js');
const { max, round } = Math;
// const settings = require('./settings.js');
const shaders = require('./shaders.js');
const sprites = require('./sprites.js');
const { BLEND_ALPHA, BLEND_PREMULALPHA } = sprites;
const textures = require('./textures.js');
const { clamp } = require('glov/common/util.js');
const { v3scale, vec4, v4clone, v4copy, v4scale } = require('glov/common/vmath.js');

/*

font_style = glov_font.style(null, {
  color: 0xFFFFFFff,
  outline_width: 0,
  outline_color: 0x00000000,
  glow_xoffs: 0,
  glow_yoffs: 0,
  glow_inner: 0,
  glow_outer: 0,
  glow_color: 0x000000ff,
});

 */

// typedef struct FontCharInfo {
//   int c;
//   float x0;
//   float y0;
//   int w;
//   int h;
//   int imgIdx;
// } FontCharInfo;

// typedef struct FontInfo {
//   AS_NAME(CharInfo) FontCharInfo **char_infos;
//   int font_size;
//   float x0;
//   float y0;
//   int imageW;
//   int imageH;
//   int spread;
// } FontInfo;

// export const COLOR_MODE = {
//   SINGLE: 0,
//   GRADIENT: 1,
// };

export const ALIGN = {
  HLEFT: 0,
  HCENTER: 1,
  HRIGHT: 2,
  HMASK: 3,

  VTOP: 0 << 2,
  VCENTER: 1 << 2,
  VBOTTOM: 2 << 2,
  VMASK: 3 << 2,

  HFIT: 1 << 4,
  HWRAP: 1 << 5,

  HCENTERFIT: 1 | (1 << 4),
  HRIGHTFIT: 2 | (1 << 4),
  HVCENTER: 1 | (1 << 2), // to avoid doing bitwise ops elsewhere
  HVCENTERFIT: 1 | (1 << 2) | (1 << 4), // to avoid doing bitwise ops elsewhere
};


// typedef struct GlovFontStyle
// {
//   // These members will never be changed (safe to initialize with GlovFontStyle foo = {1.0, 0xfff, etc};
//   float outline_width;
//   U32 outline_color;
//   // Glow: can be used for a dropshadow as well
//   //   inner can be negative to have the glow be less opaque (can also just change the alpha of the glow color)
//   //   a glow would be e.g. (0, 0, -1, 5)
//   //   a dropshadow would be e.g. (3.25, 3.25, -2.5, 5)
//   float glow_xoffs;
//   float glow_yoffs;
//   float glow_inner;
//   float glow_outer;
//   U32 glow_color;
//   U32 color; // upper left, or single color
//   // U32 colorUR; // upper right
//   // U32 colorLR; // lower right
//   // U32 colorLL; // lower left
//   // GlovFontColorMode color_mode;
// } GlovFontStyle;

/* Default GlovFontStyle:
  font_style = {
    outline_width: 0, outline_color: 0x00000000,
    glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: 0x00000000,
    color: 0xFFFFFFff
  };

  // font_style = {
  //   outline_width: 0, outline_color: 0x00000000,
  //   glow_xoffs: 0, glow_yoffs: 0, glow_inner: 0, glow_outer: 0, glow_color: 0x00000000,
  //   // Color gradient: UL, UR, LR, LL
  //   color: 0xFFFFFFff, colorUR: 0xFFFFFFff, colorLR: 0x000000ff, colorLL: 0x000000ff,
  //   color_mode: glov_font.COLOR_MODE.GRADIENT,
  // };
*/

function GlovFontStyle() {
  // Not calling `vec4()` directly, since this constructor may be called during
  //   initialization before our local `vec4` has been assigned.
  this.color_vec4 = new Float32Array([1,1,1,1]); // Matches GlovFontStyle.prototype.color below
}
GlovFontStyle.prototype.outline_width = 0;
GlovFontStyle.prototype.outline_color = 0x00000000;
GlovFontStyle.prototype.glow_xoffs = 0;
GlovFontStyle.prototype.glow_yoffs = 0;
GlovFontStyle.prototype.glow_inner = 0;
GlovFontStyle.prototype.glow_outer = 0;
GlovFontStyle.prototype.glow_color = 0x00000000;
GlovFontStyle.prototype.color = 0xFFFFFFff;
// GlovFontStyle.prototype.colorUR = 0;
// GlovFontStyle.prototype.colorLR = 0;
// GlovFontStyle.prototype.colorLL = 0;
// GlovFontStyle.prototype.color_mode = COLOR_MODE.SINGLE;

export const font_shaders = {};

export function intColorFromVec4Color(v) {
  return ((v[0] * 255 | 0) << 24) |
    ((v[1] * 255 | 0) << 16) |
    ((v[2] * 255 | 0) << 8) |
    ((v[3] * 255 | 0));
}

export function vec4ColorFromIntColor(v, c) {
  v[0] = ((c >> 24) & 0xFF) / 255;
  v[1] = ((c >> 16) & 0xFF) / 255;
  v[2] = ((c >> 8) & 0xFF) / 255;
  v[3] = (c & 0xFF) / 255;
}

function vec4ColorFromIntColorPreMultiplied(v, c) {
  let a = v[3] = (c & 0xFF) / 255;
  a *= (1/255);
  v[0] = ((c >> 24) & 0xFF) * a;
  v[1] = ((c >> 16) & 0xFF) * a;
  v[2] = ((c >> 8) & 0xFF) * a;
}

export const glov_font_default_style = new GlovFontStyle();

export function style(font_style, fields) {
  let ret = new GlovFontStyle();
  let { color_vec4 } = ret;
  if (font_style) {
    for (let f in font_style) {
      ret[f] = font_style[f];
    }
  }
  for (let f in fields) {
    ret[f] = fields[f];
  }
  ret.color_vec4 = color_vec4; // Restore
  vec4ColorFromIntColor(ret.color_vec4, ret.color);
  return ret;
}

export function styleColored(font_style, color) {
  return style(font_style, {
    color
  });
}

function colorAlpha(color, alpha) {
  alpha = clamp(round((color & 0xFF) * alpha), 0, 255);
  return color & 0xFFFFFF00 | alpha;
}

export function styleAlpha(font_style, alpha) {
  return style(font_style, {
    color: colorAlpha((font_style || glov_font_default_style).color, alpha),
    outline_color: colorAlpha((font_style || glov_font_default_style).outline_color, alpha),
    glow_color: colorAlpha((font_style || glov_font_default_style).glow_color, alpha),
  });
}

let tech_params = null;
let tech_params_dirty = false;
let tech_params_cache = [];
let tech_params_cache_idx = 0;
let temp_color = vec4();
let geom_stats;

function createTechniqueParameters() {
  if (tech_params) {
    return;
  }

  geom_stats = geom.stats;

  tech_params = {
    param0: vec4(),
    outline_color: vec4(),
    glow_color: vec4(),
    glow_params: vec4(),
  };
}

function techParamsSet(param, value) {
  let tpv = tech_params[param];
  // not dirty, if anything changes, we need a new object!
  if (!tech_params_dirty) {
    if (tpv[0] !== value[0] || tpv[1] !== value[1] || tpv[2] !== value[2] || tpv[3] !== value[3]) {
      // clone
      // PERFTODO: Should not be cloning these vec4s every frame!
      //   Should use a pool of them, but need to reset the tech_param_cache each frame.
      tech_params = {
        param0: v4clone(tech_params.param0),
        outline_color: v4clone(tech_params.outline_color),
        glow_color: v4clone(tech_params.glow_color),
        glow_params: v4clone(tech_params.glow_params),
      };
      geom_stats.font_params++;
      tech_params_dirty = true;
      tpv = tech_params[param];
    } else {
      // identical, do nothing
      return;
    }
  }
  if (tech_params_dirty) {
    // just set
    tpv[0] = value[0];
    tpv[1] = value[1];
    tpv[2] = value[2];
    tpv[3] = value[3];
    // return;
  }
}

function sameTP(as) {
  for (let key in tech_params) {
    let v1 = tech_params[key];
    let v2 = as[key];
    for (let ii = 0; ii < 4; ++ii) {
      if (v1[ii] !== v2[ii]) {
        return false;
      }
    }
  }
  return true;
}

function techParamsGet() {
  if (!tech_params_dirty) {
    return tech_params;
  }
  tech_params_dirty = false;
  for (let ii = 0; ii < tech_params_cache.length; ++ii) {
    if (sameTP(tech_params_cache[ii])) {
      tech_params = tech_params_cache[ii];
      if (tech_params_cache_idx === ii) {
        // about to be overwritten
        tech_params_cache_idx = (tech_params_cache_idx + 1) % 4;
      }
      --geom_stats.font_params;
      return tech_params;
    }
  }
  tech_params_cache[tech_params_cache_idx] = tech_params;
  tech_params_cache_idx = (tech_params_cache_idx + 1) % 4;
  return tech_params;
}

function GlovFont(font_info, texture_name) {
  assert(font_info.font_size !== 0); // Got lost somewhere

  this.texture = textures.load({
    url: `img/${texture_name}.png`,
    filter_min: font_info.noFilter ? gl.NEAREST : gl.LINEAR,
    filter_mag: font_info.noFilter ? gl.NEAREST : gl.LINEAR,
    wrap_s: gl.CLAMP_TO_EDGE,
    wrap_t: gl.CLAMP_TO_EDGE,
  });
  this.textures = [this.texture];

  this.font_info = font_info;
  this.shader = font_shaders.font_aa;
  this.tex_w = font_info.imageW;
  this.tex_h = font_info.imageH;

  // Calculate inverse scale, fixup 0s
  for (let ii = 0; ii < font_info.char_infos.length; ++ii) {
    let char_info = font_info.char_infos[ii];
    char_info.scale = 1 / (char_info.sc || 1);
    char_info.w = char_info.w || 0;
  }

  // build lookup
  this.char_infos = [];
  for (let ii = 0; ii < font_info.char_infos.length; ++ii) {
    let char_info = font_info.char_infos[ii];
    this.char_infos[font_info.char_infos[ii].c] = char_info;
    char_info.xpad = char_info.xpad || 0;
    char_info.yoffs = char_info.yoffs || 0;
  }
  this.replacement_character = this.infoFromChar(0xFFFD);
  if (!this.replacement_character) {
    this.replacement_character = this.infoFromChar(63); // '?'
  }
  this.whitespace_character = this.infoFromChar(13);

  this.default_style = new GlovFontStyle();
  this.applied_style = new GlovFontStyle();

  createTechniqueParameters();
}

// General draw functions return width
// Pass NULL for style to use default style
// If the function takes a color, this overrides the color on the style
GlovFont.prototype.drawSizedColor = function (style, x, y, z, size, color, text) {
  return this.drawSized(styleColored(style, color), x, y, z, size, text);
};
GlovFont.prototype.drawSized = function (style, x, y, z, size, text) {
  return this.drawScaled(style, x, y, z, size / this.font_info.font_size, size / this.font_info.font_size, text);
};

GlovFont.prototype.drawSizedAligned = function (style, _x, _y, z, size, align, w, h, text) {
  text = getStringFromLocalizable(text);

  if (align & ALIGN.HWRAP) {
    return this.drawSizedAlignedWrapped(style, _x, _y, z, 0, size, align & ~ALIGN.HWRAP, w, h, text);
  }
  let x_size = size;
  let y_size = size;
  let width = this.getStringWidth(style, x_size, text);
  if ((align & ALIGN.HFIT) && width > w) {
    let scale = w / width;
    x_size *= scale;
    width = w;
    // Additionally, if we're really squishing things horizontally, shrink the font size
    // and offset to be centered.
    if (scale < 0.5) {
      if ((align & ALIGN.VMASK) !== ALIGN.VCENTER && (align & ALIGN.VMASK) !== ALIGN.VBOTTOM) {
        // Offset to be roughly centered in the original line bounds
        _y += (y_size - (y_size * scale * 2)) / 2;
      }
      y_size *= scale * 2;
    }
  }
  let height = y_size;
  let x;
  let y;
  switch (align & ALIGN.HMASK) {
    case ALIGN.HCENTER:
      x = _x + (w - width) / 2;
      if (this.font_info.noFilter) {
        x |= 0; // ensure integral - TODO: often only want this for pixely = strict modes?
      }
      break;
    case ALIGN.HRIGHT:
      x = _x + w - width;
      break;
    case ALIGN.HLEFT:
      x = _x;
      break;
    default:
      x = _x;
  }
  switch (align & ALIGN.VMASK) {
    case ALIGN.VCENTER:
      y = _y + (h - height) / 2;
      if (this.font_info.noFilter) {
        y |= 0; // ensure integral
      }
      break;
    case ALIGN.VBOTTOM:
      y = _y + h - height;
      break;
    case ALIGN.VTOP:
      y = _y;
      break;
    default:
      y = _y;
  }

  return this.drawScaled(style, x, y, z, x_size / this.font_info.font_size, y_size / this.font_info.font_size, text);
};

GlovFont.prototype.drawSizedAlignedWrapped = function (style, x, y, z, indent, size, align, w, h, text) {
  text = getStringFromLocalizable(text);
  assert(w > 0);
  assert(typeof h !== 'string'); // Old API did not have `indent` parameter
  this.applyStyle(style);
  let lines = [];
  let line_xoffs = [];
  lines.length = this.wrapLines(w, indent, size, text, align, (xoffs, linenum, line) => {
    line_xoffs[linenum] = xoffs;
    lines[linenum] = line;
  });

  let yoffs = 0;
  let height = size * lines.length;
  // eslint-disable-next-line default-case
  switch (align & ALIGN.VMASK) {
    case ALIGN.VCENTER:
      yoffs = (h - height) / 2;
      if (this.font_info.noFilter) {
        yoffs |= 0; // ensure integral
      }
      break;
    case ALIGN.VBOTTOM:
      yoffs = h - height;
      break;
  }
  align &= ~ALIGN.VMASK;

  for (let ii = 0; ii < lines.length; ++ii) {
    let line = lines[ii];
    if (line && line.trim()) {
      this.drawSizedAligned(style, x + line_xoffs[ii], y + yoffs, z, size, align, w - line_xoffs[ii], 0, line);
    }
    yoffs += size;
  }
  return yoffs;
};

// returns height
GlovFont.prototype.drawSizedColorWrapped = function (style, x, y, z, w, indent, size, color, text) {
  return this.drawScaledWrapped(styleColored(style, color), x, y, z, w,
    indent, size / this.font_info.font_size, size / this.font_info.font_size, text);
};
GlovFont.prototype.drawSizedWrapped = function (style, x, y, z, w, indent, size, text) {
  return this.drawScaledWrapped(style, x, y, z, w,
    indent, size / this.font_info.font_size, size / this.font_info.font_size, text);
};

let default_size = 24;
export function setDefaultSize(h) {
  default_size = h;
}

GlovFont.prototype.draw = function (param) {
  let { style, color, alpha, x, y, z, size, w, h, align, text, indent } = param;
  if (color) {
    style = styleColored(style, color);
  }
  if (alpha !== undefined) {
    style = styleAlpha(style, alpha);
  }
  indent = indent || 0;
  size = size || default_size;
  z = z || Z.UI;
  if (align) {
    if (align & ALIGN.HWRAP) {
      return this.drawSizedAlignedWrapped(style, x, y, z, indent, size, align & ~ALIGN.HWRAP, w, h, text);
    }
    return this.drawSizedAligned(style, x, y, z, size, align, w || 0, h || 0, text);
  } else {
    return this.drawSized(style, x, y, z, size, text);
  }
};

// line_cb(x0, int linenum, const char *line, x1)
GlovFont.prototype.wrapLines = function (w, indent, size, text, align_bits, line_cb) {
  return this.wrapLinesScaled(w, indent, size / this.font_info.font_size, text, align_bits, line_cb);
};

GlovFont.prototype.numLines = function (style, w, indent, size, text) {
  this.applyStyle(style);
  return this.wrapLines(w, indent, size, text, 0);
};

GlovFont.prototype.dims = function (style, w, indent, size, text) {
  this.applyStyle(style);
  let max_x1 = 0;
  function lineCallback(ignored1, ignored2, line, x1) {
    max_x1 = max(max_x1, x1);
  }
  let numlines = this.wrapLines(w, indent, size, text, 0, lineCallback);
  return {
    h: numlines * size,
    w: max_x1,
  };
};

GlovFont.prototype.infoFromChar = function (c) {
  let ret = this.char_infos[c];
  if (ret) {
    return ret;
  }
  if (c >= 9 && c <= 13) { // characters that String.trim() strip
    return this.whitespace_character;
  }
  // no char info, not whitespace, show replacement even if ascii, control code
  return this.replacement_character;
};

GlovFont.prototype.getCharacterWidth = function (style, x_size, c) {
  assert.equal(typeof c, 'number');
  this.applyStyle(style);
  let char_info = this.infoFromChar(c);
  let xsc = x_size / this.font_info.font_size;
  let x_advance = this.calcXAdvance(xsc);
  if (char_info) {
    return (char_info.w + char_info.xpad) * xsc * char_info.scale + x_advance;
  }
  return 0;
};

GlovFont.prototype.getStringWidth = function (style, x_size, text) {
  text = getStringFromLocalizable(text);

  this.applyStyle(style);
  let ret=0;
  let xsc = x_size / this.font_info.font_size;
  let x_advance = this.calcXAdvance(xsc);
  for (let ii = 0; ii < text.length; ++ii) {
    let c = text.charCodeAt(ii);
    let char_info = this.infoFromChar(c);
    if (char_info) {
      ret += (char_info.w + char_info.xpad) * xsc * char_info.scale + x_advance;
    }
  }
  return ret;
};

GlovFont.prototype.getSpaceSize = function (xsc) {
  let space_info = this.infoFromChar(32); // ' '
  return (space_info ? (space_info.w + space_info.xpad) * space_info.scale : this.font_info.font_size) * xsc;
};

function endsWord(char_code) {
  return char_code === 32 || // ' '
    char_code === 0 || // end of string
    char_code === 10 || // '\n'
    char_code === 9; // '\t'
}

// line_cb(x0, int linenum, const char *line, x1)
GlovFont.prototype.wrapLinesScaled = function (w, indent, xsc, text, align_bits, line_cb) {
  text = getStringFromLocalizable(text);
  assert(typeof align_bits !== 'function'); // Old API had one less parameter
  const len = text.length;
  const max_word_w = w - indent;
  // "fit" mode: instead of breaking the too-long word, output it on a line of its own
  const hard_wrap_mode_fit = align_bits & ALIGN.HFIT;
  const x_advance = this.calcXAdvance(xsc);
  const space_size = this.getSpaceSize(xsc) + x_advance;
  let idx = 0;
  let line_start = 0;
  let line_x0 = 0;
  let line_x1 = 0;
  let line_end = -1;
  let word_start = 0;
  let word_x0 = 0;
  let word_w = 0;
  let word_slice = -1;
  let word_slice_w = 0;
  let linenum = 0;

  function flushLine() {
    if (line_end !== -1 && line_cb) {
      line_cb(line_x0, linenum, text.slice(line_start, line_end), line_x1);
    }
    linenum++;
    line_x0 = indent;
    line_x1 = -1;
    line_start = word_start;
    line_end = -1;
    word_x0 = line_x0;
  }

  do {
    let c = idx < len ? text.charCodeAt(idx) || 0xFFFD : 0;
    if (endsWord(c)) {
      if (word_start !== idx) {
        let need_line_flush = false;
        // flush word, take care of space on next loop
        if (word_x0 + word_w <= w) {
          // fits fine, add to line, start new word
        } else if (word_w > max_word_w && !hard_wrap_mode_fit) {
          // even just this word alone won't fit, needs a hard wrap
          // output what fits on this line, then continue to next line
          need_line_flush = true;
          if (word_slice === -1) {
            // not even a single letter fits on this line
            if (line_end !== -1) {
              // wrap to a new line if not already
              flushLine();
            }
            // just output one letter, start new word from second letter
            idx = line_start + 1;
            word_w = max_word_w; // underestimate
          } else {
            // output what fits on this line so far
            idx = word_slice;
            word_w = word_slice_w;
          }
        } else {
          // won't fit, but fits on next line, soft wrap
          if (line_end !== -1) {
            flushLine();
          }
        }
        //addWord();
        line_end = idx;
        line_x1 = word_x0 + word_w;
        word_x0 = line_x1;
        word_w = 0;
        word_start = idx;
        word_slice = -1;

        if (need_line_flush) {
          flushLine();
        }

        // we're now either still pointing at the space, or rewound to an earlier point
        continue;
      } else {
        // process the space
        word_start = idx + 1;
        word_x0 += space_size;
        if (c === 10) { // \n
          flushLine();
        }
      }
    } else {
      let char_info = this.infoFromChar(c);
      if (char_info) {
        let char_w = (char_info.w + char_info.xpad) * xsc * char_info.scale + x_advance;
        word_w += char_w;
        if (word_x0 + word_w <= w) { // would partially fit up to and including this letter
          word_slice = idx + 1;
          word_slice_w = word_w;
        }
      }
    }
    ++idx;
  } while (idx <= len);
  if (line_end !== -1) {
    flushLine();
  }

  return linenum;
};

GlovFont.prototype.drawScaledWrapped = function (style, x, y, z, w, indent, xsc, ysc, text) {
  if (text === null || text === undefined) {
    text = '(null)';
  }
  assert(w > 0);
  this.applyStyle(style);
  // This function returns height instead of width, so leave the maximum width encountered here for caller
  this.last_width = 0;
  let num_lines = this.wrapLinesScaled(w, indent, xsc, text, 0, (xoffs, linenum, line, x1) => {
    let y2 = y + this.font_info.font_size * ysc * linenum;
    let x2 = x + xoffs;
    this.drawScaled(style, x2, y2, z, xsc, ysc, line);
    this.last_width = max(this.last_width, x1);
  });
  return num_lines * this.font_info.font_size * ysc;
};

GlovFont.prototype.calcXAdvance = function (xsc) {
  // Assume called: applyStyle(style);

  // scale all supplied values by this so that if we swap in a font with twice the resolution (and twice the spread)
  //   things look almost identical, just crisper
  let font_texel_scale = this.font_info.font_size / 32;
  // As a compromise, -2 bias here seems to work well
  let x_advance = round(xsc * font_texel_scale * max(this.applied_style.outline_width - 2, 0));
  // As a compromise, there's a -3 bias in there, so it only kicks in under extreme circumstances
  x_advance = max(x_advance, xsc * font_texel_scale *
    max(this.applied_style.glow_outer - this.applied_style.glow_xoffs - 3, 0));
  return x_advance;
};

//////////////////////////////////////////////////////////////////////////
// Main implementation

GlovFont.prototype.drawScaled = function (style, _x, y, z, xsc, ysc, text) {
  text = getStringFromLocalizable(text);
  let x = _x;
  assert(isFinite(x));
  assert(isFinite(y));
  assert(isFinite(z));
  let font_info = this.font_info;
  // Debug: show expect area of glyphs
  // require('./ui.js').drawRect(_x, y,
  //   _x + xsc * font_info.font_size * 20, y + ysc * font_info.font_size,
  //   1000, [1, 0, 1, 0.5]);
  y += (font_info.y_offset || 0) * ysc;
  let texs = this.textures;
  if (text === null || text === undefined) {
    text = '(null)';
  }
  const len = text.length;
  if (xsc === 0 || ysc === 0) {
    return 0;
  }

  geom_stats.font_calls++;

  this.applyStyle(style);

  let blend_mode = engine.defines.NOPREMUL ? BLEND_ALPHA : BLEND_PREMULALPHA;

  const avg_scale_font = (xsc + ysc) * 0.5;
  const camera_xscale = camera2d.data[4];
  const camera_yscale = camera2d.data[5];
  let avg_scale_combined = (xsc * camera_xscale + ysc * camera_yscale) * 0.5;
  // Not doing this here, because render_scale_all is not currently reflected in camera_x/yscale
  // avg_scale_combined *= settings.render_scale_all;

  // scale all supplied values by this so that if we swap in a font with twice the resolution (and twice the spread)
  //   things look almost identical, just crisper
  let x_advance = this.calcXAdvance(xsc);
  let font_texel_scale = font_info.font_size / 32;
  let tile_state = 0;

  let applied_style = this.applied_style;

  // Calculate anti-aliasing values
  let delta_per_source_pixel = 0.5 / font_info.spread;
  let delta_per_dest_pixel = delta_per_source_pixel / avg_scale_combined;
  let value = vec4(
    1 / delta_per_dest_pixel, // AA Mult and Outline Mult
    -0.5 / delta_per_dest_pixel + 0.5, // AA Add
    // Outline Add
    -0.5 / delta_per_dest_pixel + 0.5 + applied_style.outline_width*font_texel_scale*avg_scale_combined,
    0, // Unused
  );
  if (value[2] > 0) {
    value[2] = 0;
  }
  let padding1 = max(0, applied_style.outline_width*font_texel_scale*avg_scale_font);
  let padding4 = vec4();
  const outer_scaled = applied_style.glow_outer*font_texel_scale;
  padding4[0] = max(outer_scaled*xsc - applied_style.glow_xoffs*font_texel_scale*xsc, padding1);
  padding4[2] = max(outer_scaled*xsc + applied_style.glow_xoffs*font_texel_scale*xsc, padding1);
  padding4[1] = max(outer_scaled*ysc - applied_style.glow_yoffs*font_texel_scale*ysc, padding1);
  padding4[3] = max(outer_scaled*ysc + applied_style.glow_yoffs*font_texel_scale*ysc, padding1);

  techParamsSet('param0', value);
  let value2 = vec4(
    0, // filled later
    0, // filled later
    // Glow mult
    1 / ((applied_style.glow_outer - applied_style.glow_inner) * delta_per_source_pixel * font_texel_scale),
    -(0.5 - applied_style.glow_outer * delta_per_source_pixel * font_texel_scale) / ((applied_style.glow_outer -
      applied_style.glow_inner) * delta_per_source_pixel * font_texel_scale)
  );
  if (value2[3] > 0) {
    value2[3] = 0;
  }

  let padding_in_font_space = vec4();
  v4scale(padding_in_font_space, padding4, 1 / avg_scale_font);
  for (let ii = 0; ii < 4; ++ii) {
    if (padding_in_font_space[ii] > font_info.spread) {
      // Not enough buffer
      let sc = font_info.spread / padding_in_font_space[ii];
      padding4[ii] *= sc;
      padding_in_font_space[ii] *= sc;
    }
  }

  // Choose appropriate z advance so that character are drawn left to right (or RTL if the glow is on the other side)
  // same Z should be drawn in queue order, so not needed
  const z_advance = applied_style.glow_xoffs < 0 ? -0.0001 : 0; // 0.0001;


  // For non-1:1 aspect ration rendering, need to scale our coordinates' padding differently in each axis
  let rel_x_scale = xsc / avg_scale_font;
  let rel_y_scale = ysc / avg_scale_font;

  let sort_y = (y - camera2d.data[1]) * camera2d.data[5];

  for (let i=0; i<len; i++) {
    const c = text.charCodeAt(i);
    if (c === 9) { // '\t'.charCodeAt(0)) {
      let tabsize = xsc * font_info.font_size * 4;
      x = ((((x - _x) / tabsize) | 0) + 1) * tabsize + _x;
    } else {
      let char_info = this.infoFromChar(c);
      if (char_info) {
        let char_scale = char_info.scale;
        let xsc2 = xsc * char_scale;
        if (char_info.w) {
          let ysc2 = ysc * char_scale;
          let pad_scale = 1 / char_scale;
          let tile_width = this.tex_w;
          let tile_height = this.tex_h;
          // Lazy update params here
          if (char_scale !== tile_state) {
            value2[0] = -applied_style.glow_xoffs * font_texel_scale * pad_scale / tile_width;
            value2[1] = -applied_style.glow_yoffs * font_texel_scale * pad_scale / tile_height;
            techParamsSet('glow_params', value2);
            tile_state = char_scale;
          }

          let u0 = (char_info.x0 - padding_in_font_space[0] * pad_scale) / tile_width;
          let u1 = (char_info.x0 + char_info.w + padding_in_font_space[2] * pad_scale) / tile_width;
          let v0 = (char_info.y0 - padding_in_font_space[1] * pad_scale) / tile_height;
          let v1 = (char_info.y0 + char_info.h + padding_in_font_space[3] * pad_scale) / tile_height;

          let w = char_info.w * xsc2 + (padding4[0] + padding4[2]) * rel_x_scale;
          let h = char_info.h * ysc2 + (padding4[1] + padding4[3]) * rel_y_scale;

          let elem = sprites.queueraw(
            texs,
            x - rel_x_scale * padding4[0], y - rel_y_scale * padding4[2] + char_info.yoffs * ysc2,
            z + z_advance * i, w, h,
            u0, v0, u1, v1,
            applied_style.color_vec4,
            this.shader, techParamsGet(), blend_mode);
          elem.y = sort_y;

          // require('./ui.js').drawRect(x - rel_x_scale * padding4[0],
          //   y - rel_y_scale * padding4[2] + char_info.yoffs * ysc2,
          //   w + x - rel_x_scale * padding4[0],
          //   h + y - rel_y_scale * padding4[2] + char_info.yoffs * ysc2,
          //   1000, [i & 1, (i & 2)>>1, (i & 4)>>2, 0.5]);
        }

        x += (char_info.w + char_info.xpad) * xsc2 + x_advance;
      }
    }
  }
  return x - _x;
};

GlovFont.prototype.determineShader = function () {
  let outline = this.applied_style.outline_width && (this.applied_style.outline_color & 0xff);
  let glow = this.applied_style.glow_outer > 0 && (this.applied_style.glow_color & 0xff);
  if (outline) {
    if (glow) {
      this.shader = font_shaders.font_aa_outline_glow;
    } else {
      this.shader = font_shaders.font_aa_outline;
    }
  } else if (glow) {
    this.shader = font_shaders.font_aa_glow;
  } else {
    this.shader = font_shaders.font_aa;
  }
};

GlovFont.prototype.applyStyle = function (style) {
  if (!style) {
    style = this.default_style;
  }
  if (engine.defines.NOPREMUL) {
    // outline
    vec4ColorFromIntColor(temp_color, style.outline_color);
    techParamsSet('outline_color', temp_color);

    // glow
    vec4ColorFromIntColor(temp_color, style.glow_color);
    techParamsSet('glow_color', temp_color);
  } else {
    // outline
    vec4ColorFromIntColorPreMultiplied(temp_color, style.outline_color);
    techParamsSet('outline_color', temp_color);

    // glow
    vec4ColorFromIntColorPreMultiplied(temp_color, style.glow_color);
    techParamsSet('glow_color', temp_color);
  }

  // everything else
  this.applied_style.outline_width = style.outline_width;
  this.applied_style.outline_color = style.outline_color;
  this.applied_style.glow_xoffs = style.glow_xoffs;
  this.applied_style.glow_yoffs = style.glow_yoffs;
  this.applied_style.glow_inner = style.glow_inner;
  this.applied_style.glow_outer = style.glow_outer;
  this.applied_style.glow_color = style.glow_color;
  this.applied_style.color = style.color;
  if (engine.defines.NOPREMUL) {
    v4copy(this.applied_style.color_vec4, style.color_vec4);
  } else {
    let alpha = this.applied_style.color_vec4[3] = style.color_vec4[3];
    v3scale(this.applied_style.color_vec4, style.color_vec4, alpha);
  }
  // this.applied_style.colorUR = style.colorUR;
  // this.applied_style.colorLR = style.colorLR;
  // this.applied_style.colorLL = style.colorLL;
  // this.applied_style.color_mode = style.color_mode;

  // if (this.applied_style.color_mode === COLOR_MODE.SINGLE) {
  //   this.applied_style.colorUR = this.applied_style.colorLL = this.applied_style.colorLR = this.applied_style.color;
  // }

  this.determineShader();
};

// Replicate constants and utility functions on all font instances as well
// GlovFont.prototype.COLOR_MODE = COLOR_MODE;
GlovFont.prototype.ALIGN = ALIGN;
GlovFont.prototype.style = style;
GlovFont.prototype.styleAlpha = styleAlpha;
GlovFont.prototype.styleColored = styleColored;

function fontShadersInit() {
  if (font_shaders.font_aa) {
    return;
  }
  font_shaders.font_aa = shaders.create('shaders/font_aa.fp');
  font_shaders.font_aa_glow = shaders.create('shaders/font_aa_glow.fp');
  font_shaders.font_aa_outline = shaders.create('shaders/font_aa_outline.fp');
  font_shaders.font_aa_outline_glow = shaders.create('shaders/font_aa_outline_glow.fp');
  shaders.prelink(sprites.sprite_vshader, font_shaders.font_aa);
  shaders.prelink(sprites.sprite_vshader, font_shaders.font_aa_glow);
  shaders.prelink(sprites.sprite_vshader, font_shaders.font_aa_outline);
  shaders.prelink(sprites.sprite_vshader, font_shaders.font_aa_outline_glow);
}

export function create(font_info, texture_name) {
  fontShadersInit();
  return new GlovFont(font_info, texture_name);
}
