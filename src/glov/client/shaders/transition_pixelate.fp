#pragma WebGL2

precision lowp float;

varying highp vec2 interp_texcoord;

uniform sampler2D tex0;
uniform vec4 param0;
uniform vec4 param1;

void main(void)
{
  vec2 interp_uvs = interp_texcoord;
  // TODO: for best look, should generate an appropriate mipmap and sample from that/just render it w/ nearest neighbor
  // result = texture2D(tex0, min(floor(interp_uvs.xy * param0.xy + 0.5) * param0.zw - param1.xy, param1.zw) );

  // Unlike ARBfp version, shift RGB channels separately (3x slowdown)
  vec4 texture0r = texture2D(tex0, min(floor(interp_uvs.xy * param0.xy + vec2(0.58, 0.5)) * param0.zw - param1.xy, param1.zw) );
  vec4 texture0g = texture2D(tex0, min(floor(interp_uvs.xy * param0.xy + vec2(0.5, 0.48)) * param0.zw - param1.xy, param1.zw) );
  vec4 texture0b = texture2D(tex0, min(floor(interp_uvs.xy * param0.xy + vec2(0.42, 0.5)) * param0.zw - param1.xy, param1.zw) );
  gl_FragColor = vec4(texture0r.r, texture0g.g, texture0b.b, 1);
}
