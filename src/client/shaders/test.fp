#pragma WebGL2
precision mediump float;
precision mediump int;

varying lowp vec4 interp_color;
varying highp vec2 interp_texcoord;
uniform vec4 params;

// Partially From: https://www.shadertoy.com/view/lsl3RH
// Created by inigo quilez - iq/2013
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
// See here for a tutorial on how to make this: http://www.iquilezles.org/www/articles/warp/warp.htm

const mat2 m = mat2( 0.80,  0.60, -0.60,  0.80 );

float noise( in vec2 x )
{
  return sin(1.5*x.x)*sin(1.5*x.y);
}

float fbm4( vec2 p )
{
  float f = 0.0;
  f += 0.5000*noise( p ); p = m*p*2.02;
  f += 0.2500*noise( p ); p = m*p*2.03;
  f += 0.1250*noise( p ); p = m*p*2.01;
  f += 0.0625*noise( p );
  return f/0.9375;
}

float fbm6( vec2 p )
{
  float f = 0.0;
  f += 0.500000*(0.5+0.5*noise( p )); p = m*p*2.02;
  f += 0.250000*(0.5+0.5*noise( p )); p = m*p*2.03;
  f += 0.125000*(0.5+0.5*noise( p )); p = m*p*2.01;
  f += 0.062500*(0.5+0.5*noise( p )); p = m*p*2.04;
  f += 0.031250*(0.5+0.5*noise( p )); p = m*p*2.01;
  f += 0.015625*(0.5+0.5*noise( p ));
  return f/0.96875;
}


float func( vec2 q )
{
  float iTime = params.w;
  float ql = length( q );
  q.x += 0.05*sin(0.27*iTime+ql*4.1);
  q.y += 0.05*sin(0.23*iTime+ql*4.3);
  q *= 0.5;

  vec2 o = vec2(0.0);
  o.x = 0.5 + 0.5*fbm4( vec2(2.0*q          )  );
  o.y = 0.5 + 0.5*fbm4( vec2(2.0*q+vec2(5.2))  );

  float ol = length( o );
  o.x += 0.02*sin(0.12*iTime+ol)/ol;
  o.y += 0.02*sin(0.14*iTime+ol)/ol;

  vec2 n;
  n.x = fbm6( vec2(4.0*o+vec2(9.2))  );
  n.y = fbm6( vec2(4.0*o+vec2(5.7))  );

  vec2 p = 4.0*q + 4.0*n;

  float f = 0.5 + 0.5*fbm4( p );

  f = mix( f, f*f*f*3.5, f*abs(n.x) );

  float g = 0.5 + 0.5*sin(4.0*p.x)*sin(4.0*p.y);
  f *= 1.0-0.5*pow( g, 8.0 );

  return f;
}



vec3 doMagic(vec2 p)
{
  vec2 q = p*5.0;

  float f = func(q);

  vec3 col = mix(interp_color.rgb, params.rgb, f );
  return col;
}

void main()
{
  gl_FragColor = vec4( doMagic( interp_texcoord ), 1.0 );
}
