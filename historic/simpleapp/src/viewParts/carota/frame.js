import { Node } from './node.js';
import wrap from './wrap.js';
import rect from './rect.js';

class Frame extends Node {

  get type() { return 'frame'; }

  constructor(lines, parent, ordinal) {
    super();
    this.lines = lines;
    this._parent = parent;
    this.ordinal = ordinal;
  }

  bounds() {
    if (!this._bounds) {
      var left = 0, top = 0, right = 0, bottom = 0;
      if (this.lines.length) {
        var first = this.lines[0].bounds();
        left = first.l;
        top = first.t;
        this.lines.forEach(function(line) {
          var b = line.bounds();
          right = Math.max(right, b.l + b.w);
          bottom = Math.max(bottom, b.t + b.h);
        });
      }
      this._bounds = rect(left, top, right - left, this.height || bottom - top);
    }
    return this._bounds;
  }

  actualWidth() {
    if (!this._actualWidth) {
      var result = 0;
      this.lines.forEach(function(line) {
        if (typeof line.actualWidth === 'number') {
          result = Math.max(result, line.actualWidth);
        }
      });
      this._actualWidth = result;
    }
    return this._actualWidth;
  }

  children() { return this.lines; }

  parent() { return this._parent; }

  draw(ctx, viewPort) {
    var top = viewPort ? viewPort.t : 0;
    var bottom = viewPort ? (viewPort.t + viewPort.h) : Number.MAX_VALUE;
    this.lines.some(function(line) {
      var b = line.bounds();
      if (b.t + b.h < top) {
        return false;
      }
      if (b.t > bottom) {
        return true;
      }
      line.draw(ctx, viewPort);
    });
  }

}

export default function frame(left, top, width, ordinal, parent,
  includeTerminator, initialAscent, initialDescent, margins) {
  var lines = [];
  var frame = new Frame(lines, parent, ordinal);
  var wrapper = wrap(left + (margins&&margins.left || 0),
                                     top + (margins&&margins.top || 0), 
                                     width - (margins&&margins.left || 0) - (margins&&margins.right || 0), 
                                     ordinal, frame, includeTerminator, initialAscent, initialDescent, margins);
  var length = 0, height = 0;
  return function(emit, word) {
    if (wrapper(function(line) {
      if (typeof line === 'number') {
        height = line;
      } else {
        length = (line.ordinal + line.length) - ordinal;
        lines.push(line);
      }
    }, word)) {
      Object.defineProperty(frame, 'length', { value: length });
      Object.defineProperty(frame, 'height', { value: height });
      emit(frame);
      return true;
    }
  };
};
