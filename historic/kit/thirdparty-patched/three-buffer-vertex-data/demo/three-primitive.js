var buffer = require('../')

module.exports = setPrimitive
function setPrimitive (geometry, data) {
  if (!data.cells || !data.positions) {
    throw new TypeError('expected at least { cells, positions }')
  }

  buffer.index(geometry, data.cells)
  buffer.attr(geometry, 'position', data.positions, 3)

  if (data.uvs) buffer.attr(geometry, 'uv', data.uvs, 2)
  else geometry.removeAttribute('uv')

  if (data.normals) buffer.attr(geometry, 'normal', data.normals, 3)
  else geometry.removeAttribute('normal')
}
