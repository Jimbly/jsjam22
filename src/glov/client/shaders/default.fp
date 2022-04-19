// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
#pragma WebGL

precision lowp float;

uniform sampler2D tex0; // source

uniform vec3 light_diffuse;
uniform vec3 light_dir_vs;
uniform vec3 ambient;

varying vec4 interp_color;
varying vec2 interp_texcoord;
varying vec3 interp_normal_vs;

void main(void) {
  vec4 texture0 = texture2D(tex0, interp_texcoord.xy);
#ifndef NOGAMMA
  texture0.rgb = texture0.rgb * texture0.rgb; // pow(2)
#endif
  vec4 albedo = texture0 * interp_color;
  if (albedo.a < 0.01) // TODO: Probably don't want this, but makes hacking transparent things together easier for now
    discard;

  vec3 normal_vs = normalize(interp_normal_vs);
  float diffuse = max(0.0, 0.5 + 0.5 * dot(normal_vs, -light_dir_vs.rgb));

  vec3 light_color = diffuse * light_diffuse.rgb + ambient.rgb;
  gl_FragColor = vec4(light_color * albedo.rgb, albedo.a);

#ifndef NOGAMMA
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0/2.0));
#endif
}