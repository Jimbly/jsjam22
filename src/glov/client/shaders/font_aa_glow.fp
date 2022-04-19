// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
#pragma WebGL2

precision lowp float;

varying vec2 interp_texcoord;
varying lowp vec4 interp_color;
uniform sampler2D tex0;
uniform mediump vec4 param0;
uniform vec4 glow_color;
uniform mediump vec4 glow_params;
void main()
{
  // Body
  float sdf = texture2D(tex0, interp_texcoord).r;
  float blend_t = clamp(sdf * param0.x + param0.y, 0.0, 1.0);
  // Glow
  vec2 glow_coord = interp_texcoord + glow_params.xy;
  float sdf_glow = texture2D(tex0, glow_coord).r;
  float glow_t = clamp(sdf_glow * glow_params.z + glow_params.w, 0.0, 1.0);
  // Composite
  #ifdef NOPREMUL
  vec4 my_glow_color = vec4(glow_color.xyz, glow_t * glow_color.w);
  gl_FragColor = mix(my_glow_color, interp_color, blend_t);
  #else
  vec4 my_glow_color = glow_color * glow_t;
  gl_FragColor = mix(my_glow_color, interp_color, blend_t);
  #endif
}
