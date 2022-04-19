#pragma WebGL2

precision lowp float;

varying vec2 interp_texcoord;

uniform vec4 colorMatrix[3];
uniform sampler2D tex0;

void main()
{
  vec4 _color;
  vec4 _mutc;
  _color = texture2D(tex0, interp_texcoord);
  _mutc = _color;
  _mutc.w = 1.0;
  vec3 _r0019;
  _r0019.x = dot(colorMatrix[0], _mutc);
  _r0019.y = dot(colorMatrix[1], _mutc);
  _r0019.z = dot(colorMatrix[2], _mutc);
  _mutc.xyz = _r0019;
  _mutc.w = _color.w;
  gl_FragColor = _mutc;
}