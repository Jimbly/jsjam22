#pragma WebGL2

precision lowp float;

varying vec2 interp_texcoord;

uniform sampler2D inputTexture0;
void main()
{
  gl_FragColor = texture2D(inputTexture0, interp_texcoord);
}
