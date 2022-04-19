// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
#pragma WebGL2

precision lowp float;

varying highp vec2 interp_texcoord;
varying lowp vec4 interp_color;
uniform sampler2D tex0;
uniform mediump vec4 param0;
uniform vec4 outline_color;
void main()
{
  // Body
  float sdf = texture2D(tex0, interp_texcoord).r;
  float blend_t = clamp(sdf * param0.x + param0.y, 0.0, 1.0);
  // Outline
  float outline_t = clamp(sdf * param0.x + param0.z, 0.0, 1.0);
  // Composite
  #ifdef NOPREMUL
  outline_t = outline_t * outline_color.w;
  vec4 outcolor = vec4(outline_color.xyz, outline_t);
  gl_FragColor = mix(outcolor, interp_color, blend_t);
  #else
  vec4 my_outline_color = outline_color * outline_t;
  gl_FragColor = mix(my_outline_color, interp_color, blend_t);
  #endif
}
