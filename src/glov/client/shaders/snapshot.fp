#pragma WebGL2

precision lowp float;

uniform sampler2D tex0;
uniform sampler2D tex1;
uniform lowp vec4 color1;

varying lowp vec4 interp_color;
varying vec2 interp_texcoord;

void main(void) {
  vec3 texA = texture2D(tex0,interp_texcoord).rgb;
  float texB = texture2D(tex1,interp_texcoord).r;
  float alpha = texA.r - texB + 1.0;
  // TODO: (perf?) (quality?) better to output pre-multiplied alpha (texA) and change state?
  vec3 orig_rgb = texA / max(0.01, alpha);
  gl_FragColor = vec4(orig_rgb, alpha * interp_color.a);
}
