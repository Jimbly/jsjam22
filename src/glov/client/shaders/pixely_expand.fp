// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
#pragma WebGL2

precision mediump float;
precision mediump int;

varying highp vec2 interp_texcoord;
uniform sampler2D inputTexture0; // source
uniform sampler2D inputTexture1; // hblur
uniform sampler2D inputTexture2; // hblur+vblur
uniform vec4 orig_pixel_size;

// 1D Gaussian.
float Gaus(float pos, float scale) {
  return exp2(scale*pos*pos);
}

const float SHADE = 0.75;
const float EASING = 1.25;

#define DO_WARP
#ifdef DO_WARP
const float VIGNETTE = 0.5;
// Display warp.
// 0.0 = none
// 1.0/8.0 = extreme
const vec2 WARP=vec2(1.0/32.0,1.0/24.0);

// Distortion of scanlines, and end of screen alpha.
vec2 Warp(vec2 pos){
  pos=pos*2.0-1.0;
  pos*=vec2(1.0+(pos.y*pos.y)*WARP.x,1.0+(pos.x*pos.x)*WARP.y);
  return pos*0.5+0.5;
}
#else
#define Warp(v) v
#endif

float easeInOut(float v) {
  float va = pow(v, EASING);
  return va / (va + pow((1.0 - v), EASING));
}

float easeIn(float v) {
  return 2.0 * easeInOut(0.5 * v);
}

float easeOut(float v) {
  return 2.0 * easeInOut(0.5 + 0.5 * v) - 1.0;
}

void main()
{
  vec2 texcoords = Warp(interp_texcoord);
  vec2 intcoords = (floor(texcoords.xy * orig_pixel_size.xy) + 0.5) * orig_pixel_size.zw;
  vec2 deltacoords = (texcoords.xy - intcoords) * orig_pixel_size.xy; // -0.5 ... 0.5
  // for horizontal sampling, map [-0.5 .. -A .. A .. 0.5] -> [-0.5 .. 0 .. 0 .. 0.5];
  float A = 0.25;
  float Ainv = (0.5 - A) * 2.0;
  float uoffs = clamp((abs(deltacoords.x) - A) / Ainv, 0.0, 1.0) * orig_pixel_size.z;
  uoffs *= sign(deltacoords.x);
  vec2 sample_coords = vec2(intcoords.x + uoffs, intcoords.y);
  // sample_coords = intcoords;
  vec3 color = texture2D(inputTexture1, sample_coords).rgb;
  vec3 color_scanline = texture2D(inputTexture2, texcoords.xy + vec2(0.0, 0.5 * orig_pixel_size.w)).rgb * SHADE;
  // color_scanline = vec3(0);

  // float mask = Gaus(deltacoords.y, -12.0);
  float mask = easeOut(2.0*(0.5 - abs(deltacoords.y)));
  // float mask = abs(deltacoords.y) > 0.25 ? 0.0 : 1.0;
  color = mix(color_scanline, color, mask);
  // color = vec3(mask);

#ifdef DO_WARP
  // vignette
  float dist = min(1.0, 100.0 * min(0.5 - abs(texcoords.x - 0.5), 0.5 - abs(texcoords.y - 0.5)));
  color *= (1.0 - VIGNETTE) + VIGNETTE * dist;
#endif

  gl_FragColor = vec4(color, 1.0);
  // gl_FragColor = vec4(color_scanline, 1.0);
  // gl_FragColor = vec4(sample_coords, 0.0, 1.0);
}
