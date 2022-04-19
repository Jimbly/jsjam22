// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
#pragma WebGL2

precision lowp float;

varying vec2 interp_texcoord;
varying lowp vec4 interp_color;
uniform sampler2D tex0;
uniform mediump vec4 param0;
void main()
{
  // Body
  float sdf = texture2D(tex0,interp_texcoord).r;
  float blend_t = clamp(sdf * param0.x + param0.y, 0.0, 1.0);
  #ifdef NOPREMUL
  gl_FragColor = vec4(interp_color.rgb, interp_color.a * blend_t);
  #else
  gl_FragColor = interp_color * blend_t;
  #endif
}
