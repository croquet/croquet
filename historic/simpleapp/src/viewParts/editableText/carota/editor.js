import per from './per.js';
import Doc from './doc.js';
import rect from './rect.js';
import MockContext from './MockContext.js';
import {cachedMeasureText, setCachedMeasureText} from './text.js';

// This was a pretty brutal reorganization of the beautiful Carota system so
// that I could have a basic text editor in 3D.
// I plan to add many of the things I removed here once I have more time, but
// at the moment - I just need to make it work.
// Croqueteer

function exhausted(doc, ordinal, direction) {
  return direction < 0 ? ordinal <= 0 : ordinal >= doc.frame.length - 1;
}

function differentLine(caret1, caret2) {
  return (caret1.b <= caret2.t) ||
    (caret2.b <= caret1.t);
}

export class Carota extends Doc {
    static setCachedMeasureText(func) {
	setCachedMeasureText(func);
    }

  constructor(width, height, numLines) {
    super();

    this.useMockContext = true;

    this.selectionChanged((getformatting, takeFocus) => {
      this.scrollRangeIntoView(this.selection);
      this.paint();
      if (!this.selectDragStart) {
        if (takeFocus !== false) {
          this.updateTextArea();
        }
      }
    });

    this.resize(width, height);

    // editor state
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.relativeScrollBarWidth = 0.02;
    this._showsScrollbar = true;
    this._isScrollable = true;

    this.keyboardX = null;
    this.nextKeyboardX = null;
    this.keyboardSelect = 0;
    this.selectDragStart = null;
    this.focusChar = null;
    this.richClipboard = null;
    this.plainClipboard = null;

    this.debug = false;
    this.hasFocus = false;
    this.resizeToNumLines(numLines);

    return this;
  }

  setSubscribers(callback) {
      this.selectionChanged(this.paint.bind(this));
      this.contentChanged(this.paint.bind(this));
      this.contentChanged(callback);
  }

  get showsScrollbar() { return this._showsScrollbar; }
  set showsScrollbar(val) { this._showsScrollbar = val; this.paint(); }
  get_isScrollable() { return this._isScrollable; }
  set_isScrollable(val) {
    this._isScrollable = val;
    if (!val) this.setScroll(0, 0);
  }

  changeLine(ordinal, direction) {

    var originalCaret = this.getCaretCoords(ordinal), newCaret;
    this.nextKeyboardX = (this.keyboardX !== null) ? this.keyboardX : originalCaret.l;

    while (!exhausted(this, ordinal, direction)) {
      ordinal += direction;
      newCaret = this.getCaretCoords(ordinal);
      if (differentLine(newCaret, originalCaret)) {
        break;
      }
    }

    originalCaret = newCaret;
    while (!exhausted(this, ordinal, direction)) {
      if ((direction > 0 && newCaret.l >= this.nextKeyboardX) ||
          (direction < 0 && newCaret.l <= this.nextKeyboardX)) {
        break;
      }

      ordinal += direction;
      newCaret = this.getCaretCoords(ordinal);
      if (differentLine(newCaret, originalCaret)) {
        ordinal -= direction;
        break;
      }
    }

    return ordinal;
  }

  endOfline(ordinal, direction) {
    var originalCaret = this.getCaretCoords(ordinal), newCaret;
    while (!exhausted(this, ordinal, direction)) {
      ordinal += direction;
      newCaret = this.getCaretCoords(ordinal);
      if (differentLine(newCaret, originalCaret)) {
        ordinal -= direction;
        break;
      }
    }
    return ordinal;
  }


  resize(width, height) {
      this.screenWidth = width;
      this.screenHeight = height;
      this.contentChanged.fire();
  }

  resizeToNumLines(numLines) {
      let m = cachedMeasureText('m', {})
      let neededPixels = m.descent * 2 /* ?? */ + m.height * numLines
      this.scaleY = neededPixels;
      let scale = neededPixels / this.screenHeight;
      this.scaleX = this.screenWidth * scale;

      if (this.scaleX * this.relativeScrollBarWidth <= 30) {
          this.relativeScrollBarWidth = 30 /this.scaleX;
      }

      this.width(this.scaleX * (1.0 - this.relativeScrollBarWidth));
      this.lineHeight = m.height / scale;
      this.contentChanged.fire();
  }

  paint() {
    // logicalWidth = Math.max(this.frame.actualWidth(), screenWidth),
    let {
          resolution,
          screenWidth,
          screenHeight,
          scrollLeft,
          scrollTop,
          scaleY, scaleX,
          selectDragStart
        } = this,
        docHeight = this.frame.height,
        absScrollLeft = scrollLeft*this.scaleX,
        absScrollTop = scrollTop*docHeight,
        absWidth = screenWidth*scaleX,
        absHeight = screenHeight*scaleY

    let ctx, canvas;
    ctx = new MockContext();
    canvas = {width: this.scaleX, height: this.scaleY}

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(0, -absScrollTop);

    this.draw(ctx, rect(absScrollLeft, absScrollTop, this.scaleX, this.scaleY));
    this.drawSelection(ctx, selectDragStart);

    if (this.showsScrollbar) this.drawScrollbar(ctx);

    ctx.restore();
    if (this.mockCallback) {
        this.mockCallback(ctx);
    }
  }

  getMockContext() {
      return this.MockContext;
  }

  drawScrollbar(ctx) {
    let {screenHeight, scaleY, scaleX, scrollTop} = this,
        {l, t, h, w, r, b} = this.scrollbarBounds();
    ctx.save();
    ctx.fillStyle = "scroll bar"
    ctx.fillRect(l, 0, w, scaleY);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "gray";
    ctx.fillStyle = "scroll knob";
    ctx.fillRect(l+3, t, w, h);
    ctx.restore()
  }

  scrollbarBounds() {
    // rk 2017-09-16: Currently only vertical scroll (bar) support!
    // Given a document height, screen height, and current scroll value,
    // compute the bounds of a rectangle that fits into the current screen at a
    // position that is relative to the scrollTop value and with a height that
    // indicates the scroll ration (screen height / doc height).
    // Note that all values are in absolute document coordinates.

      var {
          scaleX, // now means pixel count x
          scaleY, // now means pixel count y
          scrollTop: scrollT, // ratio into area
          relativeScrollBarWidth: relWidth,
          frame
        } = this;
        var docH = frame.height
        var scrollVRatio = scaleY / docH
        var barW = scaleX * 0.02
        var barLeft = scaleX - barW - 6
        var barTop = scrollT * scaleY
        var minHeight = scaleY / 100 * 5
        var barHeight = scrollVRatio > 1.0 ? scaleY - 3 : Math.max(minHeight, scaleY * scrollVRatio - 6)
    return rect(barLeft, barTop, barW, barHeight);
  }

  scrollBy(deltaX, deltay) {
    this.setScroll(this.scrollLeft = deltaX, this.scrollTop + deltay);
  }

  setScroll(scrollLeft, scrollTop) {
    let {screenHeight, scaleY} = this,
        docHeight = this.frame.height
    // this.scrollLeft = ...
      let max = 1.0 - scaleY / docHeight
      this.scrollTop = Math.max(0, Math.min(max, scrollTop));
    this.contentChanged.fire();
  }

  scrollRangeIntoView({start, end}) {
    if (!this.isScrollable) return;
    let {scaleY} = this,
        t = this.getCaretCoords(start).t,
        b = this.getCaretCoords(end).b
    let vBounds = this.visibleBounds(),
        deltaY = 0;
    //  This fits the bottom first and then the top, which is usually best
    //  It does not move the anchor when drawing out a selection
    if (b > vBounds.b && this.extendingSelection != 'top') deltaY = b - vBounds.b;
    if (t < vBounds.t && this.extendingSelection != 'bottom') deltaY = t - vBounds.t;
    if (deltaY != 0 && this.margins && this.margins.top) deltaY += this.margins.top;
    deltaY /= this.frame.height;
    if (deltaY !== 0) {
      this.scrollBy(0, deltaY);
    }
  }

  scrollCursorIntoView() {
    this.scrollRangeIntoView(this.selection);
  }

  visibleBounds() {
      var docH = this.frame.height
    return rect(this.scrollLeft * this.scaleX, this.scrollTop * docH, this.scaleX, this.scaleY)
  }

  visibleTextBounds() {
    let r = this.visibleBounds()
    return rect(r.l, r.t, r.w * (1.0 - this.relativeScrollBarWidth), r.h)
  }

  updateTextArea() {
    this.focusChar = this.focusChar === null ? this.selection.end : this.focusChar;
    var endChar = this.byOrdinal(this.focusChar);
    this.focusChar = null;
  }

  isScrollbarClick(x,y) {
    let {screenWidth, scaleX, relativeScrollBarWidth, showsScrollbar} = this,
        scrollBarWidth = relativeScrollBarWidth * scaleX,
        scrollBarLeft = scaleX - scrollBarWidth - 3;
    return showsScrollbar && x >= scrollBarLeft;
  }

  mouseDown(x,y, realY) {
    if (this.isScrollbarClick(x, y)) {
      this.scrollBarClick = {
        type: "clicked",
        scrollBarVOffset: y - this.scrollbarBounds().t,
        scrollBarTopOnDown: this.scrollTop,
        realStartY: realY,
        startX: x, startY: y
      };
    } else {
      var node = this.byCoordinate(x, y);
      this.extendingSelection = null;
      this.selectDragStart = node.ordinal;
      this.select(node.ordinal, node.ordinal);
    }
    this.keyboardX = null;
  }

  mouseMove(x,y, realY) {
    if (this.selectDragStart !== null) {
      var node = this.byCoordinate(x, y);
      if (node) {
        this.focusChar = node.ordinal;
        if (this.selectDragStart > node.ordinal) {
          this.extendingSelection = 'top';
          this.select(node.ordinal, this.selectDragStart);
        } else {
          this.extendingSelection = 'bottom';
          this.select(this.selectDragStart, node.ordinal);
        }
      }
    }

    if (this.scrollBarClick) {
      let {realStartY, scrollBarTopOnDown} = this.scrollBarClick;
      let docHeight = this.frame.bounds().h;
      let newPos = ((realY - realStartY) // movement
            * Math.max(1, docHeight / this.scaleY) // how many pixels it means relative to doc height
            / docHeight   // ratio in doc height
            + scrollBarTopOnDown)  // make it the new value
      this.scrollBarClick.type = "move";
      this.setScroll(0, newPos);
      this.paint();
    }
  }

  mouseUp(x,y, realY) {
    if (this.scrollBarClick) {
      if (this.scrollBarClick.type === "clicked") {
        var yToUse, scrollAmount;
            // We just need the right y here to compare with scrollbarBounds
            yToUse = realY;
            scrollAmount = 0.9*(this.scaleY/this.frame.height);
        let {t, b} = this.scrollbarBounds();
        if (yToUse < t) this.scrollBy(0, -scrollAmount);
        else if (yToUse > b) this.scrollBy(0, scrollAmount);
        this.paint();
      }
      this.scrollBarClick = null;
      this.wasScrollBarClick = true;
    } else {
      this.wasScrollBarClick = false;
    }
    this.selectDragStart = null;
    this.keyboardX = null;
    this.updateTextArea();
  }
}

// doc.sendKey = handleKey;

Carota.prototype.keyDown = function(event) {
  return handleKey(event.which || event.keyCode, event.shiftKey, event.ctrlKey|| event.metaKey);
};

Carota.prototype.keyPress = function(event, onFilter) {
  if(event.charCode === 13)doc.insert('\n')
  else if(!(event.ctrlKey || event.metaKey))doc.insert(String.fromCharCode(event.charCode));
}

Carota.prototype.handleKey = function(key, selecting, ctrlKey) {
   return handleKey(this, key, selecting, ctrlKey);
}

var toggles = {
  66: 'bold',
  73: 'italic',
  85: 'underline',
  83: 'strikeout'
};

let handleKey = function(doc, key, selecting, ctrlKey) {
      let start = doc.selection.start,
          end = doc.selection.end,
          length = doc.frame.length - 1,
          handled = false;

      doc.nextKeyboardX = null;

      if (!selecting) {
        doc.keyboardSelect = 0;
      } else if (!doc.keyboardSelect) {
        switch (key) {
          case 37: // left arrow
          case 38: // up - find character above
          case 36: // start of line
          case 33: // page up
            doc.keyboardSelect = -1;
            break;
          case 39: // right arrow
          case 40: // down arrow - find character below
          case 35: // end of line
          case 34: // page down
            doc.keyboardSelect = 1;
            break;
        }
      }

      let ordinal = doc.keyboardSelect === 1 ? end : start;

      let changingCaret = false;
      switch (key) {
        case 37: // left arrow
          if (!selecting && start !== end) {
            ordinal = start;
          } else {
            if (ordinal > 0) {
              if (ctrlKey) {
                let wordInfo = doc.wordContainingOrdinal(ordinal);
                if (wordInfo.ordinal === ordinal) {
                  ordinal = wordInfo.index > 0 ? doc.wordOrdinal(wordInfo.index - 1) : 0;
                } else {
                  ordinal = wordInfo.ordinal;
                }
              } else {
                ordinal--;
              }
            }
          }
          changingCaret = true;
          break;
        case 39: // right arrow
          if (!selecting && start !== end) {
            ordinal = end;
          } else {
            if (ordinal < length) {
              if (ctrlKey) {
                let wordInfo = doc.wordContainingOrdinal(ordinal);
                ordinal = wordInfo.ordinal + wordInfo.word.length;
              } else {
                ordinal++;
              }
            }
          }
          changingCaret = true;
          break;
        case 40: // down arrow - find character below
          ordinal = doc.changeLine(ordinal, 1);
          changingCaret = true;
          break;
        case 38: // up - find character above
          ordinal = doc.changeLine(ordinal, -1);
          changingCaret = true;
          break;
        case 36: // start of line
          ordinal = doc.endOfline(ordinal, -1);
          changingCaret = true;
          break;
        case 35: // end of line
          ordinal = doc.endOfline(ordinal, 1);
          changingCaret = true;
          break;
        case 33: // page up
          ordinal = 0;
          changingCaret = true;
          break;
        case 34: // page down
          ordinal = length;
          changingCaret = true;
          break;
        case 8: // backspace
          if (start === end && start > 0) {
            doc.range(start - 1, start).clear();
            doc.focusChar = start - 1;
            doc.select(doc.focusChar, doc.focusChar);
          } else {
            doc.insert("");
          }
          handled = true;
          break;
        case 46: // del
          if (start === end && start < length) {
            doc.range(start, start + 1).clear();
            handled = true;
          }
          break;
        case 90: // Z undo
          if (ctrlKey) {
            handled = true;
            doc.performUndo();
          }
          break;
        case 89: // Y undo
          if (ctrlKey) {
            handled = true;
            doc.performUndo(true);
          }
          break;
        case 65: // A select all
          if (ctrlKey) {
            handled = true;
            doc.select(0, length);
          }
          break;
        // case 67: // C - copy to clipboard
        // case 88: // X - cut to clipboard
        //   if (ctrlKey) {
        //     // Allow standard handling to take place as well
        //     richClipboard = doc.selectedRange().save();
        //     plainClipboard = doc.selectedRange().plainText();
        //   }
        //   break;
      }

      let toggle = toggles[key];
      if (ctrlKey && toggle) {
        var selRange = doc.selectedRange();
        selRange.setFormatting(toggle, selRange.getFormatting()[toggle] !== true);
        //doc.paint();
        handled = true;
      }

      if (changingCaret) {
        switch (doc.keyboardSelect) {
          case 0:
            start = end = ordinal;
            break;
          case -1:
            start = ordinal;
            break;
          case 1:
            end = ordinal;
            break;
        }

        if (start === end) {
          doc.keyboardSelect = 0;
        } else {
          if (start > end) {
            doc.keyboardSelect = -doc.keyboardSelect;
            var t = end;
            end = start;
            start = t;
          }
        }
        doc.focusChar = ordinal;
        doc.select(start, end);
        handled = true;
      }

      doc.keyboardX = doc.nextKeyboardX;
      return handled;
};
