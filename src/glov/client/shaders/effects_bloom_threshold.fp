#pragma WebGL2

precision highp float;
precision highp int;

varying vec2 interp_texcoord;

vec4 _ret_0;
float _TMP1;
float _TMP0;
float _a0025;
float _x0027;
uniform float bloomThreshold;
uniform float thresholdCutoff;
uniform sampler2D inputTexture0;

void main()
{
vec4 _col;
float _luminance;
float _x;
float _cut;
_col = texture2D(inputTexture0, interp_texcoord);
_luminance = dot(_col.xyz, vec3(2.12599993E-01, 7.15200007E-01, 7.22000003E-02));
_x = float((_luminance >= bloomThreshold));
_a0025 = 3.14159274 * (_luminance / bloomThreshold - 0.5);
_TMP0 = sin(_a0025);
_x0027 = 0.5 * (1.0 + _TMP0);
_TMP1 = pow(_x0027, thresholdCutoff);
_cut = bloomThreshold * _TMP1;
_ret_0 = (_x + (1.0 - _x) * _cut) * _col;
gl_FragColor = _ret_0;
}
