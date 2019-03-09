import per from './per.js';
import { format, defaultFormatting, merge, consolidate, getPlainText } from './runs.js';

class Range {
  constructor(doc, start, end) {
    this.doc = doc;
    this.start = start;
    this.end = end;
    if (start > end) {
      this.start = end;
      this.end = start;
    }
  }

  parts(emit, list) {
    list = list || this.doc.children();
    var self = this;
  
    list.some(function(item) {
      if (item.ordinal + item.length <= self.start) {
        return false;
      }
      if (item.ordinal >= self.end) {
        return true;
      }
      if (item.ordinal >= self.start &&
          item.ordinal + item.length <= self.end) {
        emit(item);
      } else {
        self.parts(emit, item.children());
      }
    });
  }

  clear() {
    return this.setText([]);
  }

  setText(text) {
    return this.doc.splice(this.start, this.end, text);
  }

  runs(emit) {
    this.doc.runs(emit, this);
  }

  plainText() {
    return per(this.runs, this).map(getPlainText).all().join('');
  }

  save() {
    return per(this.runs, this).per(consolidate()).all();
  }

  getFormatting() {
    var range = this;
    if (range.start === range.end) {
      var pos = range.start;
      // take formatting of character before, if any, because that's
      // where plain text picks up formatting when inserted
      if (pos > 0) {
        pos--;
      }
      range.start = pos;
      range.end = pos + 1;
    }
    return per(range.runs, range).reduce(merge).last() || defaultFormatting;
  }

  setFormatting(attribute, value) {
    var range = this;
    if (attribute === 'align') {
      // Special case: expand selection to surrounding paragraphs
      range = range.doc.paragraphRange(range.start, range.end);
    }
    if (range.start === range.end) {
      range.doc.modifyInsertFormatting(attribute, value);
    } else {
      var saved = range.save();
      var template = {};
      template[attribute] = value;
      format(saved, template);
      range.setText(saved);
    }
  }
}

export default function range(doc, start, end) {
  return new Range(doc, start, end);
};
