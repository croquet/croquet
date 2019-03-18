// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// helper

function comparePosition(pos1, pos2) {
  // pos1.row < pos2.row = -2
  // pos1.row = pos2.row and pos1.column < pos2.column  = -1
  // pos1 = pos2  = 0
  // pos1.row = pos2.row and pos1.column > pos2.column  = 1
  // pos1.row > pos2.row = 2
  let {row, column} = pos1,
      {row: row2, column: column2} = pos2;
  if (row < row2) return -2;
  if (row === row2) {
    if (column < column2) return -1;
    if (column === column2) return 0;
    return 1;
  }
  return 2;
}

function eqPosition(p1, p2) {
  return comparePosition(p1, p2) === 0;
}

function maybeSelectCommentOrLine(morph) {
  // Dan's famous selection behvior! Here it goes...
  /*   If you click to the right of '//' in the following...
  'wrong' // 'try this'.slice(4)  //should print 'this'
  'http://zork'.slice(7)          //should print 'zork'
  */
  // If click is in comment, just select that part
  var sel = morph.selection,
      {row, column} = sel.lead,
      text = morph.selectionOrLineString();

  if (!sel.isEmpty()) return;

  // text now equals the text of the current line, now look for JS comment
  var idx = text.indexOf('//');
  if (idx === -1                          // Didn't find '//' comment
      || column < idx                 // the click was before the comment
      || (idx>0 && (':"'+"'").indexOf(text[idx-1]) >=0)    // weird cases
      ) { morph.selectLine(row); return }

  // Select and return the text between the comment slashes and end of method
  sel.range = {start: {row, column: idx + 2}, end: {row, column: text.length}};
}

function doEval(morph, range, additionalOpts, code) {
  if (!range)
    range = morph.selection.isEmpty() ? morph.lineRange() : morph.selection.range;
  if (!code)
    code = morph.textInRange(range)
  // eval code here
}


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// commands

export let textCommands = [
  {
    name: "clipboard copy",
    doc: "placeholder for native copy",
    exec: text => false
  },

  {
    name: "clipboard cut",
    doc: "placeholder for native cut",
    exec: text => false
  },

  {
    name: "clipboard paste",
    doc: "placeholder for native paste",
    exec: text => false
  },

  {
    name: "select all",
    doc: "Selects entire text contents.",
    scrollCursorIntoView: false,
    multiSelectAction: "single",
    exec: text => {
      text.selectAll();
      return true;
    }
  },

  {
    name: "delete backwards",
    doc: "Delete the character in front of the cursor or the selection.",
    exec: (text) => {
      if (text.rejectsInput()) return false;
      var sel = text.selection;
      if (sel.isEmpty()) sel.growLeft(1);
      sel.text = "";
      sel.collapse();
      if (text.activeMark) text.activeMark = null;
      return true;
    }
  },

  {
    name: "delete",
    doc: "Delete the character following the cursor or the selection.",
    exec: text => {
      var sel = text.selection;
      if (text.rejectsInput()) return false;
      if (sel.isEmpty()) sel.growRight(1);
      sel.text = "";
      sel.collapse();
      if (text.activeMark) text.activeMark = null;
      return true;
    }
  },

  {
    name: "go left",
    doc: "Move the cursor 1 character left. At the beginning of a line move the cursor up. If a selection is active, collapse the selection left.",
    exec: text => {
      text.activeMark ?
        text.selection.selectLeft(1) :
        text.selection.goLeft(1);
      return true;
    }
  },

  {
    name: "go right",
    doc: "Move the cursor 1 character right. At the end of a line move the cursor down. If a selection is active, collapse the selection right.",
    exec: text => {
      text.activeMark ?
        text.selection.selectRight(1) :
        text.selection.goRight(1);
      return true;
    }
  },

  {
    name: "go up",
    doc: "Move the cursor 1 line. At the end of a line move the cursor down. If a selection is active, collapse the selection right.",
    scrollCursorIntoView: true,
    exec: text => {
      text.activeMark ?
        text.selection.selectUp(1) :
        text.selection.goUp(1, true/*use screen position*/);
      return true;
    }
  },

  {
    name: "go down",
    exec: text => {
      text.activeMark ?
        text.selection.selectDown(1) :
        text.selection.goDown(1, true/*use screen position*/);
      return true;
    }
  },

  {
    name: "select left",
    exec: text => { text.selection.selectLeft(1); return true; }
  },

  {
    name: "select right",
    exec: text => { text.selection.selectRight(1); return true; }
  },

  {
    name: "select up",
    exec: text => { text.selection.selectUp(1, true); return true; }
  },

  {
    name: "select down",
    exec: text => { text.selection.selectDown(1, true); return true; }
  },

  {
    name: "select line",
    exec: text => {
      let sel = text.selection,
          row = sel.lead.row,
          fullLine = text.lineRange(row, false);
      sel.range = sel.range.equals(fullLine) ? text.lineRange(row, true) : fullLine;
      return true;
    }
  },

  {
    name: "goto line start",
    exec: (text, opts = {select: false})  => {
      let select = opts.select || !!text.activeMark,
          sel = text.selection,
          cursor = sel.lead,
          line = text.lineRange(cursor, true);
      sel.lead = eqPosition(cursor, line.start) ? {column: 0, row: cursor.row} : line.start;
      if (!select) sel.anchor = sel.lead;
      return true;
    }
  },

  {
    name: "goto line end",
    exec: (text, opts = {select: false}) => {
      let select = opts.select || !!text.activeMark,
          sel = text.selection,
          cursor = sel.lead,
          line = text.lineRange(cursor, true);
      sel.lead = line.end;
      if (!select) {sel.anchor = sel.lead};
      return true;
    }
  },

  {
    name: "newline",
    exec: text => {
      var {row} = text.cursorPosition,
          currentLine = text.getLineString(row),
          indent = currentLine.match(/^\s*/)[0].length;

      if (!currentLine.trim() && indent) // remove trailing spaces of empty lines
        text.deleteText({start: {row, column: 0}, end: {row, column: indent}});

      let prefill = "\n" + " ".repeat(indent);

      text.selection.text = prefill;
      text.selection.collapseToEnd();
      return true;
    }
  },

  {
    name: "insertstring",
    exec: (text, args = {string: null, undoGroup: false}) => {
      let {string, undoGroup} = args,
          isValid = typeof string === "string" && string.length;
      if (!isValid) console.warn(`command insertstring called with not string value`);
      if (text.rejectsInput() || !isValid) return false;
      let sel = text.selection, isDelete = !sel.isEmpty();
      sel.text = string;
      sel.collapseToEnd();
      return true;
    }
  }
];

export let jsEditorCommands = [
  {
    name: "doit",
    doc: "Evaluates the selected code or the current line and report the result",
    exec: async (text, opts, count = 1) => {
      maybeSelectCommentOrLine(text);
      let result, err;
      try {
        opts = Object.assign({}, opts, {inspect: true, inspectDepth: count});
        result = await doEval(text, undefined, opts);
        err = result.isError ? result.value : null;
      } catch (e) { err = e; }
      if (err) console.log('**' + err);
      return result;
    }
  },

  {
    name: "printit",
    doc: "Evaluates selected code or the current line and inserts the result in a printed representation",
    exec: async (text, opts) => {
      // opts = {targetModule}
      maybeSelectCommentOrLine(text);
      var result, err;
      try {
        opts = Object.assign({}, opts, {asString: true});
        result = await doEval(text, undefined, opts);
        err = result.isError ? result.value : null;
      } catch (e) { err = e; }
      text.selection.collapseToEnd();
      text.insertTextAndSelect(err ?
        String(err) + (err.stack ? "\n" + err.stack : "") :
        String(result.value));
      return result;
    }
  },

  {
    name: "save",
    doc: "Saves...",
    handlesCount: true,
    exec: async (text, opts, count = 1) => {
      //if (morph.saveTextToModel) return morph.saveTextToModel();
      //const container = morph.getContainer();
      //console.log(`container is a ${container.constructor}`)
      //if (container && container.save) return container.save();
      // The following line makes ‘save’ work in the TSystemBrowser,
      // but it should be handled by a better route than tParent
      //if (morph.tParent && morph.tParent.save) return morph.tParent.save();
      console.log("this text doesn't know how to save");
      return true;
    }
  }
];

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// keybindings

export const defaultKeyBindings = [
  {keys: {mac: 'Meta-C', win: 'Ctrl-C'}, command: {command: "clipboard copy", passEvent: true}},
  {keys: {mac: 'Meta-X', win: 'Ctrl-X'}, command: {command: "clipboard cut", passEvent: true}},
  {keys: {mac: 'Meta-V', win: 'Ctrl-V'}, command: {command: "clipboard paste", passEvent: true}},

  //{keys: {mac: 'Meta-Z|Ctrl-Shift--|Ctrl-x u', win: 'Ctrl-Z|Ctrl-Shift--|Ctrl-x u'}, command: "text undo"},
  //{keys: {mac: 'Meta-Shift-Z', win: 'Ctrl-Shift-Z'}, command: "text redo"},

  {keys: {mac: 'Meta-A|Ctrl-X H', win: 'Ctrl-A|Ctrl-X H'}, command: "select all"},
  {keys: {mac: 'Meta-D', win:  'Ctrl-D'}, command: "doit"},
  {keys: {mac: "Meta-Shift-L X B"},      command: "eval all"},
  {keys: {mac: 'Meta-P', win: 'Ctrl-P'}, command: "printit"},
  {keys: {mac: 'Meta-S', win: 'Ctrl-S'}, command: "save"},
  {keys: {mac: 'Meta-I', win: 'Ctrl-I'}, command: "print inspectit"},
  {keys: {mac: 'Meta-Shift-I', win: 'Ctrl-Shift-I'}, command: "inspectit"},
  {keys: {mac: 'Meta-Shift-U', win: 'Ctrl-Shift-U'}, command: "undefine variable"},

  {keys: 'Backspace',                           command: "delete backwards"},
  {keys: {win: 'Delete', mac: 'Delete|Ctrl-D'}, command: "delete"},

  {keys: {win: 'Left', mac: 'Left|Ctrl-B'},   command: "go left"},
  {keys: {win: 'Right', mac: 'Right|Ctrl-F'}, command: "go right"},
  {keys: {win: 'Up', mac: 'Up|Ctrl-P'},       command: "go up"},
  {keys: {win: 'Down', mac: 'Down|Ctrl-N'},   command: "go down"},

  {keys: 'Shift-Left',  command: "select left"},
  {keys: 'Shift-Right', command: "select right"},
  {keys: 'Shift-Up',    command: "select up"},
  {keys: 'Shift-Down',  command: "select down"},

  {keys: {win: 'Ctrl-Right', mac: 'Alt-Right|Alt-F'}, command: "goto word right"},
  {keys: {win: 'Ctrl-Left', mac: 'Alt-Left|Alt-B'}, command: "goto word left"},
  {keys: {win: 'Ctrl-Shift-Right', mac: 'Alt-Shift-Right|Alt-Shift-F'}, command: {command: "goto word right", args: {select: true}}},
  {keys: {win: 'Ctrl-Shift-Left', mac: 'Alt-Shift-Left|Alt-Shift-B'}, command: {command: "goto word left", args: {select: true}}},
  {keys: 'Alt-Backspace',                command: "delete word left"},
  {keys: 'Alt-D',                        command: "delete word right"},
  {keys: 'Alt-Ctrl-K',                   command: "delete word right"/*actualle delete sexp!*/},
  {keys: 'Alt-Shift-2',                  command: "select word right"},

  {keys: "Ctrl-X Ctrl-X",                                     command: "reverse selection"},
  {keys: {win: "Ctrl-Shift-L", mac: 'Meta-L'},                command: "select line"},
  {keys: {win: "Shift-Home", mac: "Shift-Home|Ctrl-Shift-A"}, command: {command: "goto line start", args: {select: true}}},
  {keys: {win: "Home", mac: "Home|Ctrl-A"},                   command: {command: "goto line start", args: {select: false}}},
  {keys: {win: "Shift-End", mac: "Shift-End|Ctrl-Shift-E"},   command: {command: "goto line end", args: {select: true}}},
  {keys: {win: "End", mac: "End|Ctrl-E"},                     command: {command: "goto line end", args: {select: false}}},

  {keys: "Ctrl-C J",                                     command: {command: "join line", args: {withLine: "before"}}},
  {keys: "Ctrl-C Shift-J",                               command: {command: "join line", args: {withLine: "after"}}},
  {keys: {win: "Ctrl-Shift-D", mac: "Meta-Shift-D|Ctrl-C P"},     command: "duplicate line or selection"},
  {keys: {win: "Ctrl-Backspace", mac: "Meta-Backspace"}, command: "delete left until beginning of line"},
  {keys: "Ctrl-K",                                       command: "delete emtpy line or until end of line"},

  {keys: {win: "Ctrl-Alt-Up|Ctrl-Alt-P", mac: "Ctrl-Meta-Up|Ctrl-Meta-P"}, command: "move lines up"},
  {keys: {win: "Ctrl-Alt-Down|Ctrl-Alt-N", mac: "Ctrl-Meta-Down|Ctrl-Meta-N"}, command: "move lines down"},

  {keys: {win: "PageDown", mac: "PageDown|Ctrl-V"},      command: "goto page down"},
  {keys: {win: "PageUp", mac: "PageUp|Alt-V"},           command: "goto page up"},
  {keys: {win: "Shift-PageDown", mac: "Shift-PageDown"}, command: "goto page down and select"},
  {keys: {win: "Shift-PageUp", mac: "Shift-PageUp"},     command: "goto page up and select"},
  {keys: 'Alt-Ctrl-,'/*Alt-Ctrl-<*/,                     command: 'move cursor to screen top in 1/3 steps'},
  {keys: 'Alt-Ctrl-.'/*Alt-Ctrl-<*/,                     command: 'move cursor to screen bottom in 1/3 steps'},

  {keys: {win: "Alt-Left", mac: "Meta-Left"},               command: "goto matching left"},
  {keys: {win: "Alt-Shift-Left", mac: "Meta-Shift-Left"},   command: {command: "goto matching left", args: {select: true}}},
  {keys: {win: "Alt-Right", mac: "Meta-Right"},             command: "goto matching right"},
  {keys: {win: "Alt-Shift-Right", mac: "Meta-Shift-Right"}, command: {command: "goto matching right", args: {select: true}}},

  // FIXME this is actually fwd/bwd sexp
  {keys: "Alt-Ctrl-B", command: "goto matching left"},
  {keys: "Alt-Ctrl-F", command: "goto matching right"},

  {keys: "Ctrl-Up", command: "goto paragraph above"},
  {keys: "Ctrl-Down", command: "goto paragraph below"},


  {keys: {win: "Ctrl-Shift-Home", mac: "Meta-Shift-Up"},           command: {command: "goto start", args: {select: true}}},
  {keys: {win: "Ctrl-Shift-End", mac: "Meta-Shift-Down"},          command: {command: "goto end", args: {select: true}}},
  {keys: {win: "Ctrl-Home", mac: "Meta-Up|Meta-Home|Alt-Shift-,"}, command: "goto start"},
  {keys: {win: "Ctrl-End", mac: "Meta-Down|Meta-End|Alt-Shift-."}, command: "goto end"},

  {keys: "Ctrl-L",                                           command: "realign top-bottom-center"},
  {keys: {win: "Ctrl-Shift-L", mac: "Ctrl-Shift-L|Alt-G G"}, command: "goto line"},

  {keys: 'Enter', command: "newline"},
  {keys: 'Space', command: {command: "insertstring", args: {string: " ", undoGroup: true}}},
  {keys: 'Tab',   command: {command: "tab - snippet expand or indent"}},

  {keys: {win: 'Ctrl-]', mac: 'Meta-]'}, command: "indent"},
  {keys: {win: 'Ctrl-[', mac: 'Meta-['}, command: "outdent"},

  {keys: {win: 'Ctrl-Enter', mac: 'Meta-Enter'}, command: {command: "insert line", args: {where: "below"}}},
  {keys: 'Shift-Enter',                          command: {command: "insert line", args: {where: "above"}}},
  {keys: 'Ctrl-O',                               command: "split line"},

  {keys: {mac: 'Ctrl-X Ctrl-T'}, command: "transpose chars"},
  {keys: {mac: 'Ctrl-C Ctrl-U'}, command: "uppercase"},
  {keys: {mac: 'Ctrl-C Ctrl-L'}, command: "lowercase"},
  {keys: {mac: 'Meta-Shift-L W t'}, command: "remove trailing whitespace"},

  {keys: "Ctrl-Space", command: "toggle active mark"},


  {keys: {mac: 'Meta-Shift-L L T'}, command: "toggle line wrapping"},
  {keys: {win: 'Ctrl-=', mac: 'Meta-='}, command: "increase font size"},
  {keys: {win: 'Ctrl--', mac: 'Meta--'}, command: "decrease font size"},

  {keys: "Esc|Ctrl-G", command: "cancel input"},

  {keys: {win: "Ctrl-/", mac: "Meta-/"}, command: "toggle comment"},
  {keys: {win: "Alt-Ctrl-/", mac: "Alt-Meta-/|Alt-Meta-÷"/*FIXME*/}, command: "toggle block comment"},
  {keys: "Meta-Shift-L /  D", command: "comment box"},

  {keys: {windows: "Ctrl-.", mac: "Meta-."}, command: '[IyGotoChar] activate'},
  {keys: {windows: "Ctrl-,", mac: "Meta-,"}, command: {command: '[IyGotoChar] activate', args: {backwards: true}}},

  {keys: "Alt-Shift-Space|Alt-Space|Meta-Shift-P", command: "text completion"},

  {keys: "Alt-Q", command: "fit text to column"},

  {keys: {win: "Ctrl-F|Ctrl-G|F3", mac: "Meta-F|Meta-G|Ctrl-S"},                      command: "search in text"},
  {keys: {win: "Ctrl-Shift-F|Ctrl-Shift-G", mac: "Meta-Shift-F|Meta-Shift-G|Ctrl-R"}, command: {command: "search in text", args: {backwards: true}}},

  {keys: {mac: 'Meta-E', win: 'Ctrl-E'}, command: "doExchange"},
  {keys: {mac: 'Meta-M', win: 'Ctrl-M'}, command: "doMore"},
  {keys: {mac: 'Meta-Shift-M', win: 'Ctrl-Shift-M'}, command: "doMuchMore"}


];


    // // "text access"
    // indexToPosition(index) {
    //     let carota = this.editor,
    //     lines = carota.frame.lines, row = 0;
    //     for (; row < lines.length; row++) {
    //         let line = lines[row];
    //         if (index < line.length) break;
    //         index -= line.length;
    //     }
    //     return {row, column: index};
    // }

    // positionToIndex(textPos) {
    //     let {frame: {lines}} = this.editor,
    //     {row, column} = textPos,
    //     minRow = 0, maxRow = lines.length -1;
    //     if (row < minRow) { row = 0; column = 0; }
    //     if (row > maxRow) { row = maxRow; column = lines[maxRow].length-1; }
    //     return lines[row].ordinal + column;
    // }

    // getCursorPosition() {
    //     return this.selection.range.start;
    // }

    // setCursorPosition(pos) {
    //     this.selection.range = {start: pos, end: pos};
    // }

    // getLineString(row) {
    //     // the carota interface is pretty awkward...
    //     return this.textInRange(this.lineRange(row));
    // }

    // lineRange(row) {
    //     if (typeof row !== "number") row = this.cursorPosition.row;
    //     let endCol = this.editor.frame.lines[row].length-1;
    //     return {start: {row, column: 0}, end: {row, column: endCol}};
    // }

    // getTextString() { return this.editor.documentRange().plainText(); }

    // setTextString(string) {
    //     if (typeof string !== "string") {
    //         string = JSON.stringify(string);
    //     }
    //     this.editor.documentRange().setText(string);
    // }

    // textInRange(range) {
    //     let from = this.positionToIndex(range.start),
    //     to = this.positionToIndex(range.end);
    //     return this.editor.range(from, to).plainText();
    // }

    // selectLine(row) {
    //     return this.selection.range = this.lineRange(row);
    // }

    // selectionOrLineString() {
    //     return this.textInRange(this.selection.isEmpty() ? this.lineRange() : this.selection.range);
    // }

    // get documentRange() {
    //     let {start, end} = this.editor.documentRange();
    //     return {start: this.indexToPosition(start), end: this.indexToPosition(end)};
    // }

    // selectAll() {
    //     this.selection.range = this.documentRange;
    //     // this.changed(SELECTION_CHANGE);
    // }

    // selection() {
    //     if (this._selection) return this._selection;
    //     let text = this, carota = this.editor;

    //     return this._selection = {

    //         get start() { return this.range.start; },
    //         set start(start) { this.range = {start, end: start}; },

    //         get end() { return this.range.end; },
    //         set end(end) { this.range = {start: end, end}; },

    //         get anchor() { return this.isReverse() ? this.range.end : this.range.start; },
    //         set anchor(pos) {
    //             this.range = {start: pos, end: this.lead};
    //             // text.changed(SELECTION_CHANGE);
    //         },
    //         get lead() { return this.isReverse() ? this.range.start : this.range.end; },
    //         set lead(pos) {
    //             this.range = {start: this.anchor, end: pos};
    //             // text.changed(SELECTION_CHANGE);
    //         },

    //         get range() {
    //             return {
    //                 start: text.indexToPosition(carota.selection.start),
    //                 end: text.indexToPosition(carota.selection.end)
    //             };
    //         },

    //         set range(range) {
    //             let from = text.positionToIndex(range.start),
    //             to = text.positionToIndex(range.end);
    //             carota.select(from, to, true);
    //         },

    //         get text() { return text.textInRange(this.range); },
    //         set text(string) { return text.setTextInRange(string, this.range); },

    //         isEmpty() { return carota.selection.start === carota.selection.end; },

    //         collapse() {
    //             let pos = text.indexToPosition(carota.selection.start);
    //             this.range = {start: pos, end: pos};
    //         },

    //         collapseToEnd() {
    //             let pos = text.indexToPosition(carota.selection.end);
    //             this.range = {start: pos, end: pos};
    //         },

    //         isReverse() { return false; },

    //         growRight(n) {
    //             carota.select(carota.selection.start, carota.selection.end+n, true);
    //         },

    //         growLeft(n) {
    //             carota.select(carota.selection.start-n, carota.selection.end, true);
    //         },

    //         selectLeft(n) { this.growLeft(n); },
    //         selectRight(n) { this.growRight(n); },

    //         selectUp(n) {
    //             let {start, end: pos} = this.range,
    //             lastPos = text.documentRange.end,
    //             newRow = Math.min(Math.max(0, pos.row-n), lastPos.row),
    //             range = text.lineRange(newRow),
    //             newCol = Math.min(pos.column, range.end.column),
    //             newPos = {row: newRow, column: newCol};
    //             this.range = {start, end: newPos};
    //         },

    //         selectDown(n) { return this.selectUp(-n); },

    //         goRight(n) {
    //             let index = carota.selection.start + n;
    //             carota.select(index, index, true);
    //             text.resetTyping();
    //         },

    //         goLeft(n) { return this.goRight(-n); },

    //         goUp(n) {
    //             this.selectUp(n);
    //             this.collapseToEnd();
    //             text.resetTyping()
    //         },
    //         goDown(n) { return this.goUp(-n); }
    //     };
    // }

    // rejectsInput() { return false; }

    // setTextInRange(string, range, keepSelection) {
    //     let {start, end} = this.editor.selection;
    //     this.selection.range = range;
    //     this.editor.insert(string, true);
    //     let {end: newEnd} = this.editor.selection;
    //     if (keepSelection) {this.editor.select(start, end, true);}
    //     let newRange = {start: this.indexToPosition(start), end: this.indexToPosition(newEnd)};
    //     return newRange;
    // }

    // insertText(string, textPos) {
    //     if (textPos === undefined) textPos = this.cursorPosition;
    //     return this.setTextInRange(string, {start: textPos, end: textPos});
    // }

    // insertTextAndSelect(string, pos) {
    //     return this.selection.range = this.insertText(string, pos);
    // }

    // deleteText(range) { return this.setTextInRange("", range); }
