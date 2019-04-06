import {Wrap, Measurer} from './wrap.js';
import MockContext from './MockContext.js';

export class Doc {
    constructor() {
        this.doc = [{start: 0, end: 0, text: ""}]; // [{start: num, end: num, text: str, (opt)style: {font: str, size: num, color: str, emphasis: 'b' | 'i'|'bi'}}]

        this.commands = [];
        this.defaultFont = "Roboto";
        this.defaultSize = 10;
    }

    setDefault(font, size) {
        this.defaultFont = font;
        this.defaultSize = size;
    }

    load(runs) {
        // runs does not have start and end (a human would not want to add them).
        // The canonicalize method adds them.  What save() would do is to strip them out.
        this.doc = this.canonicalize(runs);
        this.commands = [];
    }

    equalStyle(prev, next) {
        let defaultFont = this.doc.defaultFont;
        let defaultSize = this.doc.defaultSize;
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
            if (this.equalStyle(lastRun.style, run.style)) {
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

    save(optStart, optEnd) {
        //return;
    }

    performUndo() {
        let command = this.commands.pop();

        if (command) {
            command.undo(this);
        }
        this.doc = this.canonicalize(this.doc);
    }
}

export class Warota {
    constructor(width, height, numLines) {
        this.doc = new Doc();
        this.doc.setDefault("Roboto", 10);
        this._width = 0;
        this.margins = {left: 0, top: 0, right: 0, bottom: 0};

        this.selections = {};

        this.scrollLeft = 0;
        this.scrollTop = 0;
        this.relativeScrollBarWidth = 0.02;
        this.showsScrollbar = true;
        this.isScrollable = true;

        this.resize(width, height);
        this.resizeToNumLines(numLines);

        this.events = [];
        this.timezone = 0;
    }

    resetEvents() {
        this.events = [];
    }

    width(width) {
        if (width === undefined) {
            return this._width;
        }
        this._width = width;
        return null;
    }

    setDefault(font, size) {
        this.doc.setDefault(font, size);
    }

    setTimezone(num) {
        this.timezone = num;
    }

    resize(width, height) {
        this.screenWidth = width;
        this.screenHeight = height;
    }

    resizeToNumLines(numLines) {
        let lineHeight = new Measurer().lineHeight(this.doc.defaultFont);
        let neededPixels = lineHeight * numLines + this.margins.top + this.margins.bottom;
        this.pixelY = neededPixels;
        let scale = neededPixels / this.screenHeight;
        this.pixelX = this.screenWidth * scale;

        if (this.pixelX * this.relativeScrollBarWidth <= 30) {
            this.relativeScrollBarWidth = 30 / this.pixelX;
        }

        this.width(this.pixelX * (1.0 - this.relativeScrollBarWidth));
        this.lineHeight = lineHeight;
    }

    load(runs) {
        // runs does not have start and end (a human would not want to add them).
        // The canonicalize method adds them.  What save() would do is to strip them out.
        this.doc.load(runs);
        this.layout();
    }

    layout() {
        let [lines, words] = new Wrap().wrap(this.doc.doc, this._width, new Measurer(), this.doc.defaultFont, this.doc.defaultSize, this.margins);
        this.lines = lines;
        this.words = words;
        let lastWord = lines[lines.length-1][0]; // there should be always one
        this.docHeight = lastWord.top + lastWord.height;
    }

    paint() {
        let ctx = new MockContext();
        let canvas = {width: this.pixelX, height: this.pixelY};
        let docHeight = this.docHeight;
        let absScrollTop = this.scrollTop * docHeight;
        let absScrollLeft = this.scrollLeft * this.pixelX;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate(0, -absScrollTop);

        this.draw(ctx, {left: absScrollLeft, top: absScrollTop, width: this.pixelX, height: this.pixelY});
        this.drawSelections(ctx);

        if (this.showsScrollbar) this.drawScrollbar(ctx);

        ctx.restore();
        if (this.mockCallback) {
            this.mockCallback(ctx);
        }
        return ctx;
    }

    visibleBounds() {
        let docH = this.docHeight;
        return {left: this.scrollLeft * this.pixelX, top: this.scrollTop * docH,
                width: this.pixelX, height: this.pixelY};
    }

    visibleTextBounds() {
        let r = this.visibleBounds();
        let w = r.width * (1.0 - this.relativeScrollBarWidth);
        let h = r.height;
        return {l: r.left, t: r.top, w: r.width * (1.0 - this.relativeScrollBarWidth), h: r.height, b: r.top + h, r: r.left + w};
    }

    draw(ctx, rect) {
        this.words.forEach(word => {
            if (word.styles) {
                word.styles.forEach(style => {
                    ctx.fillStyle = style.color;
                    // and more styles...

                    ctx.fillText(word.text.slice(style.start, style.end),
                                 word.left, word.top + word.ascent);
                });
            } else {
                ctx.fillStyle = word.style || 'black';
                // and more styles...

                ctx.fillText(word.text, word.left, word.top + word.ascent);
            }
        });
    }

    drawSelections(ctx) {
        ctx.save();
        for (let k in this.selections) {
            let selection = this.selections[k];
            if (selection.end === selection.start) {
                //ctx.fillStyle = 'barSelection ' + k;
                //let caretRect = this.caretRect(selection);
                //ctx.fillRect(this.indexFromPosition(selection.start)
            }
        }
        ctx.restore();
    }

    drawScrollbar(ctx) {}

    findLine(pos) {
        // a smarty may do a binary search
        return this.lines.find(line => line.start <= pos && pos < line.end);
    }

    findRun(pos) {
        let runs = this.doc.doc;
        let ind = runs.findIndex(run => run.start <= run && pos < run.end);
        if (ind < 0) {
            ind = runs.length - 1;
        }
        return [runs[ind], ind];
    }

    splitDocAt(runIndex, sizeInRun) {
        let runs = this.doc.doc;
        let run = runs[runIndex];
        let one = {start: run.start,
                   end: run.start + sizeInRun,
                   text: run.text.slice(0, sizeInRun),
                   style: run.style};
        let two = {start: run.start + sizeInRun,
                   end: run.end,
                   text: run.text.slice(sizeInRun, run.text.length),
                   style: run.style};
        runs.splice(runIndex, 1, one, two);
    }

    findWord(pos, x, y) {
        let word;
        const isNewline = (str) => /[\n\r]/.test(str);
        if (x !== undefined && y !== undefined) {
            let wordIndex = this.words.findIndex(w => w.top + w.height >= y);
            word = this.words[wordIndex];
            let top = word.top;
            while (true) {
                if (word.left <= x && x < word.left + word.width) {
                    return [word, wordIndex];
                }
                if (isNewline(word.text)) {
                    // at the end of line
                    return [word, wordIndex];
                }
                word = this.words[++wordIndex];
            }
            // last line?
        }
        let wordIndex = this.words.findIndex(w => w.start <= pos && pos < w.end);
        return [word, wordIndex];
    }

    insert(userID, runs) {
        let evt;
        let selection = this.selections[userID] || {start: 0, end: 0}; // or at the end?
        if (selection.start === selection.end) {
            evt = Event.insert(userID, runs, selection.start, this.timezone);
            this.events.push(evt);
            let pos = selection.start + runLength(runs);
            evt = Event.select(userID, pos, pos, this.timezone);
            this.events.push(evt);
        } else {
            evt = Event.delete(userID, selection.start, selection.end, this.timezone);
            this.events.push(evt);
            evt = Event.insert(userID, runs, selection.start, this.timezone);
            this.events.push(evt);
            let pos = selection.start + runLength(runs);
            evt = Event.select(userID, pos, pos, this.timezone);
            this.events.push(evt);
        }
    }

    delete(userID, start, end, timezone) {
        let evt = Event.delete(userID, start, end, timezone);
        this.events.push(evt);
    }

    select(userID, start, end, color) {
        let evt = Event.select(userID, start, end, color, this.timezone);
        this.events.push(evt);
    }

    doInsert(pos, runs) {
        // runs: [{text: <string>, style: <tbd>}]

        let [run, runIndex] = this.findRun(pos);

        if (run.end !== pos && run.start !== pos) { // that is, pos is within the run
            this.splitDocAt(runIndex, pos - run.start);
            runIndex += 1;
        }
        this.doc.doc.splice(runIndex, 0, ...runs); // destructively adding the runs
        this.doc.doc = this.doc.canonicalize(this.doc.doc, run.start);
        this.layout();
    }

    doDelete(pos, end) {
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

        this.doc.doc.splice(runIndex, endRunIndex);
        this.doc.doc = this.doc.canonicalize(this.doc.doc);
        this.layout();
    }

    doSelect(userID, start, end, color) {
        this.selections[userID] = {start, end, color};
    }

    positionFromIndex(pos) {
        let [word, wordIndex] = this.findWord(pos);

        let measure0 = this.measureText(word.text.slice(0, pos-1), word.style);
        let measure1 = this.measureText(word.text.slice(0, pos), word.style);
        return {left: word.left + measure0.width, top: word.top, width: measure1.with - measure0.width, height: word.height};
    }

    indexFromPosition(x, y) {
        let [word, wordIndex] = this.findWord(null, x, y);

        for (let i = 0; i < word.text.length; i++) {
            let measure = new Measurer().measureText(word.text.slice(0, i), word.style);
            if (measure.width > y - word.left) {
                return word.start + i;
            }
        }
        return 0;
    }

    addSelection(userID, start, end, color) {
        this.selections[userID] = {start, end, color};
    }

    mouseDown(x, y, realY, userID) {
        if (false /*this.isScrollbarClick(x, y)*/) {
            this.scrollBarClick = {
                type: "clicked",
                scrollBarVOffset: y - this.scrollbarBounds().t,
                scrollBarTopOnDown: this.scrollTop,
                realStartY: realY,
                startX: x, startY: y
            };
        } else {
            let index = this.indexFromPosition(x, y);
            this.extendingSelection = null;
            this.selectDragStart = index;
            this.select(userID, index, index);
        }
        this.keyboardX = null;
    }
    mouseMove(x,y, realY) {}
    mouseUp(x,y, realY) {}

}

function runLength(ary) {
    return ary.map(c => c.text).reduce((s, x) => x.length + s, 0);
}

class Event {
    static insert(user, runs, pos, timezone) {
        return {type: "insert", user, runs, pos, length: runLength(runs), timezone};
    }

    static doInsert(doc, insert) {
        doc.doInsert(insert.pos, insert.runs);
    }

    static undoInsert(doc, insert) {
        doc.doDelete(insert.pos, insert.length);
    }

    static delete(user, start, end, timezone) {
        return {type: "delete", user, start, end, timezone, deleted: null};
    }

    static doDelete(doc, del) {
        del.deleted = doc.get(this.start, this.end);
        doc.doDelete(del.start, del.end - del.start);
    }

    static undoDelete(doc, del) {
        doc.doInsert(del.start, del.deleted);
    }

    static select(user, start, end, color, timezone) {
        return {type: "select", user, start, end, color, timezone};
    }

    static doSelect(doc, select) {
        doc.doSelect(select.user, select.start, select.end, select.color);
    }

    static undoSelect(doc, select) { }
}
