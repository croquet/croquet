import * as THREE from "three";

var X_HEIGHTS = ['x', 'e', 'a', 'o', 'n', 's', 'r', 'c', 'u', 'm', 'v', 'w', 'z']
var M_WIDTHS = ['m', 'w']
var CAP_HEIGHTS = ['H', 'I', 'N', 'E', 'F', 'K', 'L', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']

var TAB_ID = '\t'.charCodeAt(0)
var SPACE_ID = ' '.charCodeAt(0)
var NB_SPACE_ID = '\xa0'.charCodeAt(0)
var ALIGN_LEFT = 0,
    ALIGN_CENTER = 1,
    ALIGN_RIGHT = 2

function number(a, b) {
    if (a === 0 || a) {return a}
    return b;
}

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                target[key] = source[key]
            }
        }
    }
    return target
}

export class GlyphLayout {
    constructor(opt) {
        this.glyphs = []
        //this._measure = this.computeMetrics.bind(this)
        opt.tabSize = opt.tabSize || 4
        this._opt = opt
        this.setupSpaceGlyphs(opt.font)
        //this.update(opt)
    }

    setupSpaceGlyphs(font) {
        //These are fallbacks, when the font doesn't include
        //' ' or '\t' or &nbsp; glyphs
        this._fallbackSpaceGlyph = null
        this._fallbackNBSpaceGlyph = null
        this._fallbackTabGlyph = null

        if (!font.chars || font.chars.length === 0)
            return

        //try to get space glyph
        //then fall back to the 'm' or 'w' glyphs
        //then fall back to the first glyph available
        var space = getGlyphById(font, SPACE_ID)
            || getMGlyph(font)
            || font.chars[0]

        //and create a fallback for tab
        var tabWidth = this._opt.tabSize * space.xadvance
        this._fallbackSpaceGlyph = space
        this._fallbackNBSpaceGlyph = space
        this._fallbackTabGlyph = extend(space, {
            x: 0, y: 0, xadvance: tabWidth, id: TAB_ID,
            xoffset: 0, yoffset: 0, width: 0, height: 0
        })
    }

    getGlyph(font, id) {
        var glyph = getGlyphById(font, id)
        if (glyph)
            return glyph
        else if (id === TAB_ID)
            return this._fallbackTabGlyph
        else if (id === SPACE_ID || NB_SPACE_ID)
            return this._fallbackSpaceGlyph
        return null
    }

    measureText(text, scale) {
        var letterSpacing = this._opt.letterSpacing || 0
        var font = this._opt.font
        var curPen = 0
        var curWidth = 0
        var count = 0
        var glyph
        var lastGlyph
        var height = 0;

        for (var i=0; i < text.length; i++) {
            var id = text.charCodeAt(i)
            var glyph = this.getGlyph(font, id)

            if (glyph) {
                //move pen forward
                var xoff = glyph.xoffset
                var kern = lastGlyph ? getKerning(font, lastGlyph.id, glyph.id) : 0
                curPen += kern

                curPen = curPen + glyph.xadvance + letterSpacing
                curWidth = curPen// + glyph.width
                height = Math.max(height, glyph.height);
                lastGlyph = glyph
            }
            count++
        }

        let result = {}
        result.ascent = font.common.base
        result.height = font.common.lineHeight
        result.descent = result.height - result.ascent
        result.width = curWidth
        return result
    }

    computeGlyphs(opt) {
        let glyphs = []

        let drawnStrings = opt.drawnStrings

        if (!opt.font)
            throw Error(('must provide a valid bitmap font')

        let font = opt.font

        //the pen position
        var lineHeight = number(opt.lineHeight, font.common.lineHeight)
        var baseline = font.common.base
        var descender = lineHeight - baseline
        var letterSpacing = opt.letterSpacing || 0
        var height = lineHeight - descender
        var align = getAlignType(this._opt.align)
        var offsetY = opt.offsetY || 0

        //the metrics for this text layout
        this._height = height
        this._descender = lineHeight - baseline
        this._baseline = baseline
        this._xHeight = getXHeight(font)
        this._capHeight = getCapHeight(font)
        this._lineHeight = lineHeight
        this._ascender = lineHeight - descender - this._xHeight


        drawnStrings.forEach((drawnString) => {
            var x = drawnString.x
            var y = drawnString.y
            var style = drawnString.style

            //draw text along baseline
            y -= height - offsetY

            //layout each glyph
            var lastGlyph
            var lastStyle
            var color
            var self = this
            for (var i = 0; i < drawnString.string.length; i++) {
                var id = drawnString.string.charCodeAt(i)
                var glyph = self.getGlyph(font, id)
                if (glyph) {
                    if (lastGlyph)
                        x += getKerning(font, lastGlyph.id, glyph.id)

                    if (style === 'black') {
                        color = null
                        lastStyle = 'black'
                    } else if (lastStyle !== style) {
                        color = THREE.Color(style);
                        lastStyle == style
                    }
                    glyphs.push({
                        position: [x, y],
                        data: glyph,
                        index: i,
                        color: color
                    })

                    //move pen forward
                    x += glyph.xadvance + letterSpacing
                    lastGlyph = glyph
                }
            }
        })
        return glyphs
    }
}

//getters for the private vars
;['width', 'height',
  'descender', 'ascender',
  'xHeight', 'baseline',
  'capHeight',
  'lineHeight' ].forEach(addGetter)

function addGetter(name) {
  Object.defineProperty(GlyphLayout.prototype, name, {
    get: wrapper(name),
    configurable: true
  })
}

//create lookups for private vars
function wrapper(name) {
  return (new Function([
    'return function '+name+'() {',
    '  return this._'+name,
    '}'
  ].join('\n')))()
}

function getGlyphById(font, id) {
  if (!font.chars || font.chars.length === 0)
    return null

  var glyphIdx = findChar(font.chars, id)
  if (glyphIdx >= 0)
    return font.chars[glyphIdx]
  return null
}

function getXHeight(font) {
  for (var i=0; i<X_HEIGHTS.length; i++) {
    var id = X_HEIGHTS[i].charCodeAt(0)
    var idx = findChar(font.chars, id)
    if (idx >= 0)
      return font.chars[idx].height
  }
  return 0
}

function getMGlyph(font) {
  for (var i=0; i<M_WIDTHS.length; i++) {
    var id = M_WIDTHS[i].charCodeAt(0)
    var idx = findChar(font.chars, id)
    if (idx >= 0)
      return font.chars[idx]
  }
  return 0
}

function getCapHeight(font) {
  for (var i=0; i<CAP_HEIGHTS.length; i++) {
    var id = CAP_HEIGHTS[i].charCodeAt(0)
    var idx = findChar(font.chars, id)
    if (idx >= 0)
      return font.chars[idx].height
  }
  return 0
}

function getKerning(font, left, right) {
  if (!font.kernings || font.kernings.length === 0)
    return 0

  var table = font.kernings
  for (var i=0; i<table.length; i++) {
    var kern = table[i]
    if (kern.first === left && kern.second === right)
      return kern.amount
  }
  return 0
}

function getAlignType(align) {
  if (align === 'center')
    return ALIGN_CENTER
  else if (align === 'right')
    return ALIGN_RIGHT
  return ALIGN_LEFT
}

function findChar (array, value, start) {
  start = start || 0
  for (var i = start; i < array.length; i++) {
    if (array[i].id === value) {
      return i
    }
  }
  return -1
}
