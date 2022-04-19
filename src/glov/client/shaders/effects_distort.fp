#pragma WebGL2

precision highp float;
precision highp int;

varying vec2 interp_texcoord;

vec4 _ret_0;
vec2 _UV1;
vec4 _TMP1;
vec2 _r0020;
vec2 _r0028;
vec2 _v0028;
uniform vec2 strength;
uniform vec3 transform[2];
uniform vec2 invTransform[2];
uniform sampler2D inputTexture0;
uniform sampler2D distortTexture;

void main()
{
vec3 _uvt;
_uvt = vec3(interp_texcoord.x, interp_texcoord.y, 1.0);
_r0020.x = dot(transform[0], _uvt);
_r0020.y = dot(transform[1], _uvt);
_TMP1 = texture2D(distortTexture, _r0020);
_v0028 = _TMP1.xy - 0.5;
_r0028.x = dot(invTransform[0], _v0028);
_r0028.y = dot(invTransform[1], _v0028);
_UV1 = interp_texcoord + _r0028 * strength;
_ret_0 = texture2D(inputTexture0, _UV1);
gl_FragColor = _ret_0;
}
