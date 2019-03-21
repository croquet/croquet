var formattingKeys = [
  "bold",
  "italic",
  "underline",
  "strikeout",
  "color",
  "font",
  "size",
  "align",
  "script"
];

var defaultFormatting = {
  size: 10,
  font: 'Roboto',
  color: 'black',
  bold: false,
  italic: false,
  underline: false,
  strikeout: false,
  align: 'left',
  script: 'normal'
};

function sameFormatting(run1, run2) {
  return formattingKeys.every(function(key) {
    return run1[key] === run2[key];
  })
};

function clone(run) {
  var result = { text: run.text };
  formattingKeys.forEach(function(key) {
    var val = run[key];
    if (val && val != defaultFormatting[key]) {
      result[key] = val;
    }
  });
  return result;
};

var multipleValues = {};

function merge(run1, run2) {
  if (arguments.length === 1) {
    return Array.isArray(run1) ? run1.reduce(merge) : run1;
  }
  if (arguments.length > 2) {
    return merge(Array.prototype.slice.call(arguments, 0));
  }
  var merged = {};
  formattingKeys.forEach(function(key) {
    if (key in run1 || key in run2) {
      if (run1[key] === run2[key]) {
        merged[key] = run1[key];
      } else {
        merged[key] = multipleValues;
      }
    }
  });
  return merged;
};

function format(run, template) {
  if (Array.isArray(run)) {
    run.forEach(function(r) {
      format(r, template);
    });
  } else {
    Object.keys(template).forEach(function(key) {
      if (template[key] !== multipleValues) {
        run[key] = template[key];
      }
    });
  }
};

function consolidate() {
  var current;
  return function (emit, run) {
    if (!current || !sameFormatting(current, run) ||
        (typeof current.text != 'string') ||
        (typeof run.text != 'string')) {
      current = clone(run);
      emit(current);
    } else {
      current.text += run.text;
    }
  };
};

function getPlainText(run) {
  if (typeof run.text === 'string') {
    return run.text;
  }
  if (Array.isArray(run.text)) {
    var str = [];
    run.text.forEach(function(piece) {
      str.push(getPiecePlainText(piece));
    });
    return str.join('');
  }
  return '_';
};

/*  The text property of a run can be an ordinary string, or a "character object",
or it can be an array containing strings and "character objects".

A character object is not a string, but is treated as a single character.

We abstract over this to provide the same string-like operations regardless.
*/
function getPieceLength(piece) {
  return piece.length || 1; // either a string or something like a character
};

function getPiecePlainText(piece) {
  return piece.length ? piece : '_';
};

function getTextLength(text) {
  if (typeof text === 'string') {
    return text.length;
  }
  if (Array.isArray(text)) {
    var length = 0;
    text.forEach(function(piece) {
      length += getPieceLength(piece);
    });
    return length;
  }
  return 1;
};

function getSubText(emit, text, start, count) {
  if (count === 0) {
    return;
  }
  if (typeof text === 'string') {
    emit(text.substr(start, count));
    return;
  }
  if (Array.isArray(text)) {
    var pos = 0;
    text.some(function(piece) {
      if (count <= 0) {
        return true;
      }
      var pieceLength = getPieceLength(piece);
      if (pos + pieceLength > start) {
        if (pieceLength === 1) {
          emit(piece);
          count -= 1;
        } else {
          var str = piece.substr(Math.max(0, start - pos), count);
          emit(str);
          count -= str.length;
        }
      }
      pos += pieceLength;
    });
    return;
  }
  emit(text);
};

function getTextChar(text, offset) {
  var result;
  getSubText(function(c) { result = c }, text, offset, 1);
  return result;
};

function pieceCharacters(each, piece) {
  if (typeof piece === 'string') {
    for (var c = 0; c < piece.length; c++) {
      each(piece[c]);
    }
  } else {
    each(piece);
  }
};



export {
  formattingKeys,
  defaultFormatting,
  sameFormatting,
  clone,
  multipleValues,
  merge,
  format,
  consolidate,
  getPlainText,
  getPiecePlainText,
  getPieceLength,
  getTextLength,
  getSubText,
  getTextChar,
  pieceCharacters
}
