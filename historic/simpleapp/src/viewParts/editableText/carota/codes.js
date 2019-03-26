import { measure, draw } from './text.js';
import frame from './frame.js';
import rect from './rect.js';
import { Node, GenericNode } from './node.js';
import { derive as _derive } from './util.js';

class InlineNode extends Node {

  constructor(inline, parent, ordinal, length, formatting, measured) {
    super();
    this.inline = inline;
    this._parent = parent;
    this.ordinal = ordinal;
    this.length = length;
    this.formatting = formatting;
    this.measured = measured;
  }

  parent() { return this._parent; }
  draw(ctx) {
    this.inline.draw(ctx,
      this.left,
      this.baseline,
      this.measured.width,
      this.measured.ascent,
      this.measured.descent,
      this.formatting);
  }
  position(left, baseline, bounds) {
    this.left = left;
    this.baseline = baseline;
    if (bounds) {
      this._bounds = bounds;
    }
  }
  bounds() {
    return this._bounds || rect(this.left, this.baseline - this.measured.ascent,
      this.measured.width, this.measured.ascent + this.measured.descent);
  }
  byCoordinate(x, y) {
    if (x <= this.bounds().center().x) {
      return this;
    }
    return this.next();
  }
}

function inlineNode(inline, parent, ordinal, length, formatting) {
  if (!inline.draw || !inline.measure) {
    throw new Error();
  }
  return new InlineNode(inline, parent, ordinal, length, formatting, inline.measure(formatting))
};

var codes = codes || {
  number(obj, number) {
    var formattedNumber = (number + 1) + '.';
    return {
      measure: function(formatting) {
        return measure(formattedNumber, formatting);
      },
      draw: function(ctx, x, y, width, ascent, descent, formatting) {
        draw(ctx, formattedNumber, formatting, x, y, width, ascent, descent);
      }
    };
  }
};


function listTerminator(obj) {
  return _derive(obj, {
    eof: true,
    measure: function(formatting) {
      return { width: 18, ascent: 0, descent: 0 }; // text.measure(text.enter, formatting);
    },
    draw: function(ctx, x, y) {
      // ctx.fillText(text.enter, x, y);
    }
  });
};

codes.listNext = codes.listEnd = listTerminator;

codes.listStart = function(obj, data, allCodes) {
  return _derive(obj, {
    block: function(left, top, width, ordinal, parent, formatting) {
      var list = new GenericNode('list', parent, left, top),
          itemNode,
          itemFrame,
          itemMarker;

      var indent = 50, spacing = 10;

      var startItem = function(code, formatting) {
        itemNode = new GenericNode('item', list);
        var marker = allCodes(code.marker || { $: 'number' }, list.children().length);
        itemMarker = inlineNode(marker, itemNode, ordinal, 1, formatting);
        itemMarker.block = true;
        itemFrame = frame(
        left + indent, top, width - indent, ordinal + 1, itemNode,
          function(terminatorCode) {
            return terminatorCode.$ === 'listEnd';
          },
          itemMarker.measured.ascent
        );
      };

      startItem(obj, formatting);

      return function(inputWord) {
        if (itemFrame) {
          itemFrame(function(finishedFrame) {
            ordinal = finishedFrame.ordinal + finishedFrame.length;
            var frameBounds = finishedFrame.bounds();

            // get first line and position marker
            var firstLine = finishedFrame.first();
            var markerLeft = left + indent - spacing - itemMarker.measured.width;
            var markerBounds = rect(left, top, indent, frameBounds.h);
            if ('baseline' in firstLine) {
              itemMarker.position(markerLeft, firstLine.baseline, markerBounds);
            } else {
              itemMarker.position(markerLeft, top + itemMarker.measured.ascent, markerBounds);
            }

            top = frameBounds.t + frameBounds.h;

            itemNode.children().push(itemMarker);
            itemNode.children().push(finishedFrame);
            itemNode.finalize();

            list.children().push(itemNode);
            itemNode = itemFrame = itemMarker = null;
          }, inputWord);
        } else {
          ordinal++;
        }

        if (!itemFrame) {
          var i = inputWord.code();
          if (i) {
            if (i.$ == 'listEnd') {
              list.finalize();
              return list;
            }
            if (i.$ == 'listNext') {
              startItem(i, inputWord.codeFormatting());
            }
          }
        }
      };
    }
  });
};

export default function(obj, number, allCodes) {
  var impl = codes[obj.$];
  return impl && impl(obj, number, allCodes);
};

export function editFilter(doc) {
  var balance = 0;

  if (!doc.words.some(function(word, i) {
    var code = word.code();
    if (code) {
      switch (code.$) {
        case 'listStart':
          balance++;
          break;
        case 'listNext':
          if (balance === 0) {
            doc.spliceWordsWithRuns(i, 1, [_derive(word.codeFormatting(), {
              text: {
                $: 'listStart',
                marker: code.marker
              }
            })]);
            return true;
          }
          break;
        case 'listEnd':
          if (balance === 0) {
            doc.spliceWordsWithRuns(i, 1, []);
          }
          balance--;
          break;
      }
    }
  })) {
    if (balance > 0) {
      var ending = [];
      while (balance > 0) {
        balance--;
        ending.push({
          text: { $: 'listEnd' }
        });
      }
      doc.spliceWordsWithRuns(doc.words.length - 1, 0, ending);
    }
  }
};
