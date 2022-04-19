#pragma WebGL2

precision highp float;
precision highp int;

varying vec2 interp_texcoord;

vec4 _ret_0;
vec4 _TMP3;
vec4 _TMP5;
float _TMP2;
vec4 _TMP1;
float _TMP0;
vec4 _TMP36;
uniform float bloomSaturation;
uniform float originalSaturation;
uniform float bloomIntensity;
uniform float originalIntensity;
uniform sampler2D inputTexture0;
uniform sampler2D inputTexture1;

void main()
{
vec4 _orig;
vec4 _bloom;
_orig = texture2D(inputTexture0, interp_texcoord);
_bloom = texture2D(inputTexture1, interp_texcoord);
_TMP0 = dot(_bloom.xyz, vec3(2.12599993E-01, 7.15200007E-01, 7.22000003E-02));
_TMP1 = vec4(_TMP0, _TMP0, _TMP0, _TMP0) + bloomSaturation * (_bloom - vec4(_TMP0, _TMP0, _TMP0, _TMP0));
_bloom = _TMP1 * bloomIntensity;
_TMP2 = dot(_orig.xyz, vec3(2.12599993E-01, 7.15200007E-01, 7.22000003E-02));
_TMP3 = vec4(_TMP2, _TMP2, _TMP2, _TMP2) + originalSaturation * (_orig - vec4(_TMP2, _TMP2, _TMP2, _TMP2));
_TMP5 = min(vec4(1.0, 1.0, 1.0, 1.0), _bloom);
_TMP36 = max(vec4(0.0, 0.0, 0.0, 0.0), _TMP5);
_orig = (_TMP3 * (1.0 - _TMP36)) * originalIntensity;
_ret_0 = _bloom + _orig;
gl_FragColor = _ret_0;
}
