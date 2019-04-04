function length(ary) {
    return ary.map(c => c.text).reduce((s, x) => x.length + s, 0);
}

class Insert {
    constructor(user, runs, pos, timezone) {
        this.user = user;
        this.runs = runs;
        this.length = length(runs);
        this.timezone = timezone;
    }

    do(doc) {
        doc.insert(pos, runs);
    }

    undo(doc) {
        doc.delete(pos, length);
    }

    type() {return "insert";}
}

class Delete {
    constructor(user, start, end, timezone) {
        this.user = user;
        this.start = start;
        this.end = end;
        this.timezone = timezone;

        this.deleted = null;
    }

    do(doc) {
        this.deleted = doc.get(start, end);
        doc.delete(pos, length);
    }

    undo(doc) {
        doc.insert(start, this.deleted);
    }

    type() {return "delete";}
}

export default class Doc {
    constructor() {
        this._width = 0;
        this.load([]);
    }

    load(runs) {
        this.commands = [];
        this.doc = this.canonicalize(runs); // [{start: num, end: num, text: str, style: <tbd>}]
        this.layout();
    }
  
    setMargins(margins) {
        this.margins = margins;
    }

    layout() {
        this.frame = null;

        try {
            this.frame = this.doLayout();
            let [lines, attrs] = this.splitLines(runs);

            // transient.  Constructed from this.doc
            this.lines = lines; // // [{start: num, end: num, text: str}]

            // transient.  Constructed from this.doc.  The length may be dfferent from lines
            this.attrs = attrs; // [{start: num, end: num, style: <tbd>}]
        } catch (x) {
            console.error(x);
        }
    }

    save(optStart, optEnd) {
        //return;
    }

    insert(pos, runs) {
        // runs: [{text: <string>, style: <tbd>}]

        let current = 0;
        let runIndex = 0;

        let nextRun;
        let runLength;

        do {
            nextRun = this.doc[runIndex]; // (at least there should be "", in this.doc)
            runLength = this.runLength(nextRun);
            current += runLength;
            runIndex += 1;

        } while (current < pos && runIndex < this.doc.length);

        if (current > pos) {
            // the end of this run goes beyond pos
            this.splitDocAt(runIndex, current - pos);
        }
        this.doc.splice(runIndex, 0, runs); // adding it
        this.doc = this.canonicalize(this.doc);
        this.layout();
    }

    delete(start, end) {
        let current = 0;
        let runIndex = 0;

        let nextRun;
        let runLength;

        do {
            nextRun = this.doc[runIndex]; // (at least there should be "", in this.doc)
            runLength = this.runLength(nextRun);
            current += runLength;
            runIndex += 1;

        } while (current < start && runIndex < this.doc.length);

        if (current > pos) {
            // the end of this run goes beyond pos
            this.splitDocAt(runIndex, current - start);
        }

        let first = runIndex;

        do {
            nextRun = this.doc[runIndex]; // Is there a guarantee that this is in bounds?
            runLength = this.runLength(nextRun);
            current += runLength;
            runIndex += 1;

        } while (current < end && runIndex < this.doc.length);

        let last = runIndex;

        this.doc.splice(first, last);
        this.doc = this.canonicalize(this.doc);
        this.layout();
    }

    width(optWidth) {
        if (optWidth === undefined) {
            return this._width;
        }
        this._width = optWidth;
        this.layout();
    }

    positionFromIndex(ind) {
        // this.doc should be quiescent, and lines and attrs should be computed
        let lineIndex = 0;
        let current = 0;
        let line;

        do {
            line = this.lines[lineIndex]; // (at least there should be "", in this.doc)
            if (line.start <= pos && pos < line.end) {
                break;
            }
            lineIndex += 1;
        } while (lineIndex < this.lines.length);

        do {
            nextRun = this.doc[runIndex]; // Is there a guarantee that this is in bounds?
            runLength = this.runLength(nextRun);
            current += runLength;
            runIndex += 1;

        } while (current < end && runIndex < this.doc.length);

        if (current > pos) {
            // the end of this run goes beyond pos
            this.splitDocAt(runIndex, current - start);
        }

        let first = runIndex;
    }

  indexFromPosition(x, y) {
  }

  performUndo() {
      let command = this.commands.pop();

      if (command) {
          command.undo(this);
      }
      this.layout();
    }

}
