class Rect {
    constructor(l, t, w, h) {
        this.left = l;
        this.top = t;
        this.width = w;
        this.height = h;
    }
}

function length(ary) {
    return ary.map(c => c.text).reduce((s, x) => x.length + s, 0);
}

/*export*/
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

/*export*/
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

/*export*/
class Doc {
    constructor() {
        this._width = 0;
        this.doc = [{start: 0, end: 0, text: ""}]; // [{start: num, end: num, text: str, (opt)style: {font: str, size: num, color: str, emphasis: 'b' | 'i'|'bi'}}]

        // created in layout, as it involves line wrapping.
        // all letters in a "word" shares the same style,
        // and never go across the displayed lines
        // note that, a space character between letters is counted as a word
        this.renderedWords = null; // [{start: num, end: num, text: string, left: num, top, num, width: num, height: num}]

        this.defaultFont = "Roman";
        this.defaultSize = 10;
    }

    setDefault(font, size) {
        this.defaultFont = font;
        this.defaultSize = size;
    }

    load(runs) {
        // runs does not have start and end (a human would not want to add them).
        // The canonicalize method adds them.  What save() would do is to strip them out.
        this.commands = [];
        this.doc = this.canonicalize(runs);
        this.layout();
    }

    setMargins(margins) {
        this.margins = margins;
    }

    equalStyle(prev, next, defaultFont, defaultSize) {
        if (!prev && !next) {return true;}

        if (!prev) {
            return next.font === defaultFont && next.size === defaultSize
               && !next.color && !next.emphasis;
        }
        if (!next) {
            return prev.font === defaultFont && prev.size === defaultSize
               && !prev.color && !prev.emphasis;
        }

        return (prev.font || defaultFont) === (next.font || defaultFont)
            && (prev.size || defaultSize) === (next.size || defaultSize)
            && (prev.color === next.color)
            && (prev.emphasis === next.emphasis);
    }

    canonicalize(runs) {
        let result = [];
        let lastRun = runs[0];
        let lastStyle = lastRun.style;
        let start = 0;
        let end = 0;
        let i = 1;
        let run = runs[i];
        while (run) {
            if (this.equalStyle(lastRun.style, run.style, this.defaultFont, this.defaultSize)) {
                lastRun.text += run.text;
            } else {
                lastRun.start = start;
                end = start + lastRun.text.length;
                lastRun.end = end;
                start = end;

                result.push(lastRun);
                lastRun = run;
            }
            i++;
            run = runs[i];
        }
        lastRun.start = start;
        end = start + lastRun.text.length;
        lastRun.end = end;
        result.push(lastRun);
        return result;
    }

    splitLines(runs) {
        // assumes that runs is canonicalized
    }
     
    layout() {
        this.frame = null;

        try {
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

    findLine(pos) {
        // a smarty may do a binary search
        return this.lines.find(line => line.start <= pos && pos < line.end);
    }

    findRun(pos) {
        let ind = this.doc.findIndex(run => run.start <= run && pos < run.end);
        if (ind < 0) {
            ind = this.doc.length - 1;
        }
        return [this.doc[ind], ind];
    }

    findWord(pos, x, y) {
        if (x !== undefined && y !== undefined) {
            let wordIndex = this.words.findIndex(word => word.top + word.height >= y);
            let word = this.words[wordIndex];
            let top = word.top;
            while (true) {
                if (word.left <= x && x < word.left + word.width) {
                    return [word, wordIndex];
                }
                if (word.isEOL) {
                    // at the end of line
                    return [word, wordIndex]
                }
                word = this.words[++wordIndex];
            }
            // last line?
        }
        let wordIndex = this.words.findIndex(word => word.start <= pos && pos < word.end);
        return [word, wordIndex];
    }

    insert(pos, runs) {
        // runs: [{text: <string>, style: <tbd>}]

        let [run, runIndex] = this.findRun(pos);

        if (run.end !== pos) { // that is, pos is within the run
            this.splitDocAt(runIndex, pos - run.start);
        }
        this.doc.splice(runIndex, 0, runs); // destructively adding the runs
        this.doc = this.canonicalize(this.doc, run.start);
        this.layout();
    }

    delete(pos, end) {
        let [run, runIndex] = this.findRun(pos);

        if (run.end !== pos) { // that is, pos is within the run
            this.splitDocAt(runIndex, pos - run.start);
        }

        let endRun = run;
        let endRunIndex;
        do {
            [endRun, endRunIndex] = this.findRun(endRun.end);
        } while (endRun.end < end && endRunIndex < this.doc.length);

        let reminder = end - endRun.start;
        if (end !== endRun.end) {
            this.splitDocAt(endRunIndex, end - endRun.start);
        }

        this.doc.splice(runIndex, endRunIndex);
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

    positionFromIndex(pos) {
        let [word, wordIndex] = this.findWord(pos);

        let measure0 = this.measureText(word.text.slice(0, pos-1), word.style);
        let measure1 = this.measureText(word.text.slice(0, pos), word.style);
        return new Rect(word.left + measure0.width, word.top, measure1.width - measure0.width, word.height);
    }

    indexFromPosition(x, y) {
        let [word, wordIndex] = this.findWord(null, x, y);

        for (let i = 0; i < word.text.length; i++) {
            let measure = this.measureText(word.text.slice(0, i), word.style);
            if (measure.width > y - word.left) {
                return word.start + i;
            }
        }
        return 0;
    }

  performUndo() {
      let command = this.commands.pop();

      if (command) {
          command.undo(this);
      }
      this.layout();
    }

}
