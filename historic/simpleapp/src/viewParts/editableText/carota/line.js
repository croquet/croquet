import PositionedWord from './positionedword.js';
import rect from './rect.js';
import { Node } from './node.js'

/*  A Line is returned by the wrap function. It contains an array of PositionedWord objects that are
all on the same physical line in the wrapped text.

It has a width (which is actually the same for all lines returned by the same wrap). It also has
coordinates for baseline, ascent and descent. The ascent and descent have the maximum values of
the individual words' ascent and descent coordinates.

It has methods:

draw(ctx, x, y)
- Draw all the words in the line applying the specified (x, y) offset.
bounds()
- Returns a Rect for the bounding box.
*/

export default class Line extends Node {

  get type() { return 'line'; }

  constructor(doc, left, width, baseline, ascent, descent, words, ordinal) {
    super();
    this.doc = doc; // should be called frame, or else switch to using parent on all nodes
    this.left = left;
    this.width = width;
    this.baseline = baseline;
    this.ascent = ascent;
    this.descent = descent;
    this.ordinal = ordinal;
    
    var align = this.align = words[0].align(),
        actualWidth = 0;
    words.forEach(word => actualWidth += word.width);
    actualWidth -= words[words.length - 1].space.width;

    var x = 0, spacing = 0;
    if (actualWidth < width) {
      switch (align) {
        case 'right':
          x = width - actualWidth;
          break;
        case 'center':
          x = (width - actualWidth) / 2;
          break;
        case 'justify':
          if (words.length > 1 && !words[words.length - 1].isNewLine()) {
            spacing = (width - actualWidth) / (words.length - 1);
          }
          break;
      }
    }

    this.positionedWords = words.map(word => {
      var wordLeft = x;
      x += (word.width + spacing);
      var wordOrdinal = ordinal;
      ordinal += (word.text.length + word.space.length);
      return new PositionedWord(word, this, wordLeft, wordOrdinal, word.width + spacing);
    });

    this.actualWidth = actualWidth;
    this.length = ordinal - this.ordinal;
  }

  bounds(minimal) {
    if (minimal) {
      var firstWord = this.first().bounds(),
          lastWord = this.last().bounds();
      return rect(
      firstWord.l,
        this.baseline - this.ascent,
        (lastWord.l + lastWord.w) - firstWord.l,
        this.ascent + this.descent);
    }
    return rect(this.left, this.baseline - this.ascent,
      this.width, this.ascent + this.descent);
  }

  parent() { return this.doc; }
  children() { return this.positionedWords; }
}
