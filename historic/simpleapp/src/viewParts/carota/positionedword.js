import rect from './rect.js';
import part from './part.js';
import { measure, enter } from './text.js';
import { Node } from './node.js';
import { pieceCharacters } from './runs.js';


function newLineWidth(run) {
  return measure(enter, run).width;
};

class PositionedChar extends Node {

  constructor(left, part, word, ordinal) {
    super();
    this.ordinal = ordinal
    this.word = word
    this.part = part
    this.left = left
  }

  get type() { return 'character'; }

  get length() { return 1; }

  bounds() {
    var wb = this.word.bounds();
    var width = this.word.word.isNewLine()
              ? newLineWidth(this.word.word.run)
              : this.width || this.part.width;
    return rect(wb.l + this.left, wb.t, width, wb.h);
  }

  parent() { return this.word; }
  byOrdinal() { return this; }
  byCoordinate(x, y) { return x <= this.bounds().center().x ? this : this.next(); }
}

/*  A positionedWord is just a realised Word plus a reference back to the containing Line and
the left coordinate (x coordinate of the left edge of the word).

It has methods:

draw(ctx, x, y)
- Draw the word within its containing line, applying the specified (x, y)
offset.
bounds()
- Returns a rect for the bounding box.
*/

export default class PositionedWord extends Node {

  constructor(word, line, left, ordinal, width) {
    super();
    this.word = word;
    this.line = line;
    this.left = left;
    this.width = width; // can be different to word.width if (align == 'justify')
    this.ordinal = ordinal;
    this.length = word.text.length + word.space.length;
  }

  get type() { return "word"; }

  draw(ctx) {
    this.word.draw(ctx, this.line.left + this.left, this.line.baseline);

    // Handy for showing how word boundaries work
    // var b = this.bounds();
    // ctx.strokeRect(b.l, b.t, b.w, b.h);
  }

  bounds() {
    return rect(
    this.line.left + this.left,
      this.line.baseline - this.line.ascent,
      this.word.isNewLine() ? newLineWidth(this.word.run) : this.width,
      this.line.ascent + this.line.descent);
  }

  parts(eachPart) {
    this.word.text.parts.some(eachPart) ||
      this.word.space.parts.some(eachPart);
  }

  realiseCharacters() {
    if (!this._characters) {
      var cache = [];
      var x = 0, self = this, ordinal = this.ordinal,
          codes = this.parentOfType('document').codes;
      this.parts(function(wordPart) {
        pieceCharacters(function(char) {
          var charRun = Object.create(wordPart.run);
          charRun.text = char;
          var p = part(charRun, codes);
          cache.push(new PositionedChar(x, p, self, ordinal));
          x += p.width;
          ordinal++;
        }, wordPart.run.text);
      });
      // Last character is artificially widened to match the length of the
      // word taking into account (align === 'justify')
      var lastChar = cache[cache.length - 1];
      if (lastChar) {
        Object.defineProperty(lastChar, 'width',
          { value: this.width - lastChar.left });
        if (this.word.isNewLine() || (this.word.code() && this.word.code().eof)) {
          Object.defineProperty(lastChar, 'newLine', { value: true });
        }
      }
      this._characters = cache;
    }
  }

  children() {
    this.realiseCharacters();
    return this._characters;
  }

  parent() { return this.line; }
}
