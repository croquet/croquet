var THREE = require('three')

export function createHybridMSDFShader (opt) {
  opt = opt || {};
  var opacity = typeof opt.opacity === 'number' ? opt.opacity : 1;
  var alphaTest = typeof opt.alphaTest === 'number' ? opt.alphaTest : 0.0001;
   // to make the appearance between methods match better and improve legibility when afar (derived empirically)
  var alphaMatchMultiplier = typeof opt.alphaMatchMultiplier === 'number' ? opt.alphaMatchMultiplier : 1.2;
  var precision = opt.precision || 'highp';
  var color = opt.color;
  var map = opt.map;
  var negate = typeof opt.negate === 'boolean' ? opt.negate : true;

  var version = opt.version || '300';

  // remove to satisfy r73
  delete opt.map;
  delete opt.color;
  delete opt.precision;
  delete opt.opacity;
  delete opt.negate;
  delete opt.textureSize;
  delete opt.version;

  var vert300 = `#version 300 es
in vec2 uv;
in vec4 position;
in vec3 color;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
out vec2 vUv;
out vec3 outColor;
out vec2 origXY;
void main() {
  vUv = uv;
  outColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * position;
  origXY = position.xy;
}`;

  var vert100 = `
attribute vec2 uv;
attribute vec4 position;
attribute vec3 color;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;

varying vec2 vUv;
varying vec3 outColor;
varying vec2 origXY;

void main() {
  vUv = uv;
  outColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * position;
  origXY = position.xy;
}`;

  var frag300 = `#version 300 es
precision ${precision} float;
uniform float opacity;
uniform vec4 corners; // [x: left(0), y: top(0), z: right, w: bottom]
uniform float textureWidth; // 512.0, or the width of the map texture
uniform sampler2D map;

in vec3 outColor;
in vec2 origXY;
in vec2 vUv;
out vec4 glFragColor;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

bool inside(vec4 corners, vec2 origXY) {
  return corners.x <= origXY.x &&
         origXY.x < corners.z &&
         corners.y <= origXY.y &&
         origXY.y < corners.w;
}
void main() {
  float alpha;
  if (!inside(corners, origXY)) discard;
  vec4 tex = ${negate ? '1.0 - ' : ''} texture(map, vUv);
  float delta = fwidth(vUv.x) * textureWidth;
  if (delta < 1.0) { // if magnified, use MSDF
    float sigDist = median(tex.r, tex.g, tex.b) - 0.5;
    alpha = clamp(sigDist/fwidth(sigDist) + 0.5, 0.0, 1.0);
  } else {
    alpha = tex.a * ${alphaMatchMultiplier};  // if minified, use mipmap
  }
  glFragColor = vec4(outColor.rgb, alpha * opacity);
  if (glFragColor.a < ${alphaTest}) discard;
}`;

  var frag100 = `
#ifdef GL_OES_standard_derivatives
#  extension GL_OES_standard_derivatives : enable
#endif
precision ${precision} float;
uniform float opacity;
uniform vec4 corners; // [x: left(0), y: top(0), z: right, w: bottom]
uniform float textureWidth; // 512.0, or the width of the map texture
uniform sampler2D map;

varying vec3 outColor;
varying vec2 origXY;
varying vec2 vUv;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

bool inside(vec4 corners, vec2 origXY) {
  return corners.x <= origXY.x &&
         origXY.x < corners.z &&
         corners.y <= origXY.y &&
         origXY.y < corners.w;
}
void main() {
  float alpha;
  if (!inside(corners, origXY)) discard;
  vec4 tex = ${negate ? '1.0 - ' : ''} texture2D(map, vUv);
  float delta = fwidth(vUv.x) * textureWidth;
  if (delta < 1.0) { // if magnified, use MSDF
    float sigDist = median(tex.r, tex.g, tex.b) - 0.5;
    alpha = clamp(sigDist/fwidth(sigDist) + 0.5, 0.0, 1.0);
  } else {
    alpha = tex.a * ${alphaMatchMultiplier};  // if minified, use mipmap
  }
  gl_FragColor = vec4(outColor.rgb, alpha * opacity);
  if (gl_FragColor.a < ${alphaTest}) discard;
}`;

  return Object.assign({
    uniforms: {
      opacity: { type: 'f', value: opacity },
      map: { type: 't', value: map || new THREE.Texture() },
      corners: {value: new THREE.Vector4(0, 0, 100, 100)},
      textureWidth: {value: 512},
    },
    vertexShader: version === '300' ? vert300 : vert100,
    fragmentShader: version === '300' ? frag300 : frag100
  }, opt);
};
