import {Wrap, Measurer} from './wrap.js';
import MockContext from './MockContext.js';

function runLength(ary) {
    return ary.map(c => c.text).reduce((s, x) => x.length + s, 0);
}


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
        // can I assume it is canonicalized? => yes
        let result = [];
        this.doc.forEach(run => {
            if (run.style) {
                result.push({text: run.text, style: run.style});
            } else {
                result.push({text: run.text});
            }
        });
        return result;
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
                ctx.fillStyle = 'barSelection ' + k;
                let caretRect = this.barRect(selection);
                ctx.fillRect(caretRect.left, caretRect.top, caretRect.width, caretRect.height);
            }
        }
        ctx.restore();
    }

    drawScrollbar(ctx) {}

    findRun(pos, x, y) {
        let runs = this.doc.doc;

        if (x !== undefined && y !== undefined) {
            let lineIndex = this.lines.findIndex(line => {
                let w = line[0]; // should be always one
                return w.top <= y && y < w.top + w.height;
            });
            if (lineIndex < 0) {
                return runs[runs.length - 1]; // or?
            }
            let line = this.lines[lineIndex];
            let ind = line.findIndex(run => run.left <= x && x  < run.left + run.width);
            return [runs[ind], ind];
        }

        let ind = runs.findIndex(run => run.start <= pos && pos < run.end);

        if (ind < 0) {
            ind = runs.length - 1;
        }
        return [runs[ind], ind];
    }

    findLine(pos, x, y) {
        // a smarty way would be to do a binary search
        let lines = this.lines;
        if (x !== undefined && y !== undefined) {
            let lineIndex = lines.findIndex(line => {
                let w = line[0]; // should be always one
                return w.top <= y && y < w.top + w.height;
            });
            if (lineIndex < 0) {
                lineIndex = lines.length - 1;
            }
            return [lines[lineIndex], lineIndex];
        }

        let lineIndex = lines.findIndex(line => {
            let start = line[0];
            let end = line[line.length-1];
            return start.start <= pos && pos < end.end;
        });

        if (lineIndex < 0) {
            lineIndex = lines.length;
        }
        return [lines[lineIndex], lineIndex];
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
            let [line, lineIndex] = this.findLine(pos, x, y);
            let wordIndex = line.findIndex(w => w.left <= x && x < w.left + w.width);
            if (wordIndex < 0) {
                wordIndex = line.length - 1;
            }
            return line[wordIndex];
        } 

        let [line, lineIndex] = this.findLine(pos, x, y);
        let wordIndex = line.findIndex(w => w.start <= pos && pos < w.end);
        if (wordIndex < 0) {
            wordIndex = this.words.length - 1;
        }
        return line[wordIndex];
    }

    insert(userID, runs) {
        let evt;
        let selection = this.selections[userID] || {start: 0, end: 0}; // or at the end?
        if (selection.start === selection.end) {
            evt = Event.insert(userID, runs, selection.start, this.timezone);
            this.events.push(evt);
            let pos = selection.start + runLength(runs);
            evt = Event.select(userID, pos, pos, userID, this.timezone);
            this.events.push(evt);
        } else {
            evt = Event.delete(userID, selection.start, selection.end, this.timezone);
            this.events.push(evt);
            evt = Event.insert(userID, runs, selection.start, this.timezone);
            this.events.push(evt);
            let pos = selection.start + runLength(runs);
            evt = Event.select(userID, pos, pos, userID, this.timezone);
            this.events.push(evt);
        }
    }

    delete(userID, start, end) {
        let evt = Event.delete(userID, start, end, this.timezone);
        this.events.push(evt);
        evt = Event.select(userID, start, start, userID, this.timezone);
        this.events.push(evt);
    }

    select(userID, start, end, color) {
        let evt = Event.select(userID, start, end, color, this.timezone);
        this.events.push(evt);
    }

    doEvent(evt) {
        if (evt.type === "insert") {
            this.doInsert(evt.pos, evt.runs);
        } else if (evt.type === "delete") {
            this.doDelete(evt.start, evt.end);
        } else if (evt.type === "select") {
            this.doSelect(evt.user, evt.start, evt.end, evt.color);
        }
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
            // here, previous run ends at pos. and next one starts at pos.
            runIndex += 1;
        }

        let endRun = run;
        let endRunIndex;
        do {
            [endRun, endRunIndex] = this.findRun(endRun.end);
        } while (endRun.end < end && endRunIndex < this.doc.length);

        let reminder = end - endRun.start;
        if (end !== endRun.end) {
            this.splitDocAt(endRunIndex, end - endRun.start);
            endRunIndex += 1;
        }

        this.doc.doc.splice(runIndex, endRunIndex - runIndex);
        this.doc.doc = this.doc.canonicalize(this.doc.doc);
        this.layout();
    }

    doSelect(userID, start, end, color) {
        this.selections[userID] = {start, end, color};
    }

    positionFromIndex(pos) {
        let word = this.findWord(pos);

        let lp = pos - word.start;
        if (lp === 0) {
            let measure0 = new Measurer().measureText(word.text.slice(0, 0), word.style);
            return {left: word.left + measure0.width, top: word.top, width: measure0.width, height: word.height};
        }

        let measure0 = new Measurer().measureText(word.text.slice(0, pos-word.start), word.style);
        let measure1 = new Measurer().measureText(word.text.slice(0, pos-word.start+1), word.style);
        return {left: word.left + measure0.width, top: word.top, width: measure1.width - measure0.width, height: word.height};
    }

    indexFromPosition(x, y) {
        let word = this.findWord(null, x, y);
        let last = 0;
        let lx = x - word.left;
        for (let i = 0; i <= word.text.length; i++) {
            let measure = new Measurer().measureText(word.text.slice(0, i), word.style);
            let half = (measure.width - last) / 2;
            if (last <= lx && lx < last + half) {
                return word.start + i - 1;
            }
            if (last + half <= lx && lx < measure.width) {
                return word.start + i;
            }
            last = measure.width;
        }
        return word.end;
    }

    barRect(selection) {
        let rect = this.positionFromIndex(selection.start);
        return {left: rect.left, top: rect.top, width: 5, height: rect.height};
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
            console.log("index:", index);
            this.extendingSelection = null;
            this.selectDragStart = index;
            this.select(userID, index, index, userID);
        }
        this.keyboardX = null;
    }
    mouseMove(x,y, realY) {}
    mouseUp(x,y, realY) {}

    backspace(userID) {
        let selection = this.selections[userID] || {start: 0, end: 0};
        if (selection.start === selection.end && selection.start > 0) {
            this.delete(userID, selection.start - 1, selection.end);
        } else {
            this.delete(userID, selection.start, selection.end);
        }
    }

    handleKey(userID, key, selecting, ctrlKey) {
        let selection = this.selections[userID] || {start: 0, end: 0};
        let start = selection.start,
            end = selection.end,
            handled = false;

        switch (key) {
        case 8: // backspace
            this.backspace(userID);
            handled = true;
            break;
            default:
            break;
        }
        return handled;
    }
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
