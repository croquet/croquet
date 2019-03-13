import rect from './rect.js';

export class Node {
 
  children() { return []; }

  parent() { return null; }

  first() { return this.children()[0]; }

  last() { return this.children()[this.children().length - 1]; }

  next() {
    var self = this;
    for (;;) {
      var parent = self.parent();
      if (!parent) {
        return null;
      }
      var siblings = parent.children();
      var next = siblings[siblings.indexOf(self) + 1];
      if (next) {
        for (;;)  {
          var first = next.first();
          if (!first) {
            break;
          }
          next = first;
        }
        return next;
      }
      self = parent;
    }
  }

  previous() {
    var parent = this.parent();
    if (!parent) {
      return null;
    }
    var siblings = parent.children();
    var prev = siblings[siblings.indexOf(this) - 1];
    if (prev) {
      return prev;
    }
    var prevParent = parent.previous();
    return !prevParent ? null : prevParent.last();
  }

  byOrdinal(index) {
    var found = null;
    if (this.children().some(function(child) {
      if (index >= child.ordinal && index < child.ordinal + child.length) {
        found = child.byOrdinal(index);
        if (found) {
          return true;
        }
      }
    })) {
      return found;
    }
    return this;
  }

  byCoordinate(x, y) {
    var found;
    this.children().some(function(child) {
      var b = child.bounds();
      if (b.contains(x, y)) {
        found = child.byCoordinate(x, y);
        if (found) {
          return true;
        }
      }
    });
    if (!found) {
      found = this.last();
      while (found) {
        var next = found.last();
        if (!next) {
          break;
        }
        found = next;
      }
      var foundNext = found.next();
      if (foundNext && foundNext.block) {
        found = foundNext;
      }
    }
    return found;
  }

  draw(ctx, viewPort) {
    this.children().forEach(function(child) {
      child.draw(ctx, viewPort);
    });
  }

  parentOfType(type) {
    var p = this.parent();
    return p && (p.type === type ? p : p.parentOfType(type));
  }

  bounds() {
    var l = this._left, t = this._top, r = 0, b = 0;
    this.children().forEach(function(child) {
      var cb = child.bounds();
      l = Math.min(l, cb.l);
      t = Math.min(t, cb.t);
      r = Math.max(r, cb.l + cb.w);
      b = Math.max(b, cb.t + cb.h);
    });
    return rect(l, t, r - l, b - t);
  }
}


export class GenericNode extends Node {

  constructor(type, parent, left, top) {
    this.type = type;
    this._children = [];
    this._parent = parent;
    this._left = typeof left === 'number' ? left : Number.MAX_VALUE;
    this._top = typeof top === 'number' ? top : Number.MAX_VALUE;
  }

  children() { return this._children; }

  parent() { return this._parent; }

  finalize(startDecrement, lengthIncrement) {
    var start = Number.MAX_VALUE, end = 0;
    this._children.forEach(function(child) {
      start = Math.min(start, child.ordinal);
      end = Math.max(end, child.ordinal + child.length);
    });
    Object.defineProperty(this, 'ordinal', { value: start - (startDecrement || 0) });
    Object.defineProperty(this, 'length', { value: (lengthIncrement || 0) + end - start });
  }
}
