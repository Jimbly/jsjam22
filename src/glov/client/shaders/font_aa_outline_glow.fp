// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
#pragma WebGL2

precision lowp float;

varying highp vec2 interp_texcoord;
varying lowp vec4 interp_color;
uniform sampler2D tex0;
uniform mediump vec4 param0;
uniform vec4 outline_color;
uniform vec4 glow_color;
uniform mediump vec4 glow_params;

void main()
{
  // Body
  float sdf = texture2D(tex0, interp_texcoord).r;
  float blend_t = clamp(sdf * param0.x + param0.y, 0.0, 1.0);
  // Outline
  float outline_t = clamp(sdf * param0.x + param0.z, 0.0, 1.0);
  // Glow
  vec2 glow_coord = interp_texcoord + glow_params.xy;
  float sdf_glow = texture2D(tex0, glow_coord).r;
  float glow_t = clamp(sdf_glow * glow_params.z + glow_params.w, 0.0, 1.0);

  // Composite
  #ifdef NOPREMUL
  // Outline on top of glow
  vec4 my_glow_color = vec4(glow_color.xyz, glow_t * glow_color.w);
  // Previously had the following (blends better with soft outline on hard glow, but breaks alpha-fade of whole style, see below)
  // outline_t = outline_t * outline_color.w;
  vec4 outcolor = mix(my_glow_color, outline_color, outline_t);
  // Body on top of that
  gl_FragColor = mix(outcolor, interp_color, blend_t);
  #else
  // Outline on top of glow
  vec4 my_glow_color = glow_color * glow_t;

  // This allows a soft outline to blend well through to a glow underneath, but
  //   causes the colors to bleed when the whole style is faded:
  // vec4 my_outline_color = outline_color * outline_t;
  // vec4 outcolor = my_outline_color + (1.0 - my_outline_color.a) * my_glow_color; // Equivalent to glBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  // Instead, this allows fading of the entire color by an alpha to keep the relative colors:
  // vec4 outcolor = my_outline_color + (1.0 - outline_t) * my_glow_color;
  vec4 outcolor = mix(my_glow_color, outline_color, outline_t);

  // Body on top of that
  gl_FragColor = mix(outcolor, interp_color, blend_t);
  #endif
}
