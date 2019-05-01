global.THREE = require('three')

// some mesh primitives from npm
var createSphere = require('primitive-sphere')
var createTorus = require('primitive-torus')
var createQuad = require('primitive-quad')

// utility function to set a BufferGeometry to a primitive
var setToPrimitive = require('./three-primitive')
var baboon = require('baboon-image-uri')
var loadImage = require('img')

var createOrbitViewer = require('three-orbit-viewer')(THREE)
var app = createOrbitViewer({
  clearColor: 0x000000,
  clearAlpha: 1.0,
  fov: 65,
  position: new THREE.Vector3(1, 1, -2)
})

var primitives = [
  createQuad(), createSphere(), createTorus()
]

var tick = 0
var geometry = new THREE.BufferGeometry()
var material = new THREE.MeshBasicMaterial({
  map: new THREE.Texture(),
  side: THREE.DoubleSide
})
var mesh = new THREE.Mesh(geometry, material)
app.scene.add(mesh)

// test mesh primitive UVs
loadImage(baboon, function (err, image) {
  if (err) throw err
  var tex = material.map
  tex.image = image
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.flipY = false
  tex.needsUpdate = true
  tex.repeat.set(5, 5)
})

next()
setInterval(next, 1000)

function next () {
  var newMesh = primitives[tick++ % primitives.length]
  setToPrimitive(geometry, newMesh)
}
