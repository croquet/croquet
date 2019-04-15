import {Wrap, Measurer} from "./wrap.js";
import MockContext from "./MockContext.js";

function runLength(ary) {
    return ary.map(c => c.text).reduce((s, x) => x.length + s, 0);
}

const eof = String.fromCharCode(26); // "^Z"

export class Doc {
    constructor() {
        this.runs = [{text: ""}]; // [{text: str, (opt)style: {font: str, size: num, color: str, emphasis: 'b' | 'i'|'bi'}}]
        this.intervals = []; // [{start: num, end: num}]
        this.selections = {}; // {user: {start: num, end: num, color: string}}

        this.commands = [];

        this.defaultFont = "Roboto";
        this.defaultSize = 10;
    }

    load(runs) {
        // runs does not have start and end (human would not want to add them by hand).
        // The canonicalize method adds them. save() strip them out.
        this.canonicalize(runs);
        this.commands = [];
    }

    setDefault(font, size) {
        this.defaultFont = font;
        this.defaultSize = size;
    }

    doEvent(evt) {
        if (evt.type === "insert") {
            this.doInsert(evt.user, evt.runs, true);
        } else if (evt.type === "delete") {
            this.doDelete(evt.user, true, true);
        } else if (evt.type === "select") {
            this.doSelect(evt.user, evt.start, evt.end);
        }
    }

    doInsert(user, runs) {
        // runs: [{text: <string>, (opt)style: {}}]
        let selection = this.ensureSelection(user);
        if (selection.start === selection.end) {
            let [run, runIndex] = this.findRun(selection.start);
            let interval = this.intervals[runIndex];
            if (interval.end !== selection.start && interval.start !== selection.start) {
                // that is, pos is within the run
                this.splitRunsAt(runIndex, selection.start - interval.start);
                runIndex += 1;
            } else if (interval.end === selection.start) {
                runIndex += 1;
            }
            this.runs.splice(runIndex, 0, ...runs);
            this.canonicalize(this.runs, interval.start); // this may be off
            this.updateSelectionsInsert(user, selection.start, runLength(runs));
        } else {
            this.doDelete(user, true);
            this.doInsert(user, runs);
        }
    }

    doDelete(user, isBackspace) {
        let selection = this.ensureSelection(user);
        let start, end;

        if (selection.start === selection.end) {
            let length = this.length();
            if ((!isBackspace && selection.start === length)
               || (isBackspace && selection.start === 0)) {
                return;
            }

            if (isBackspace) {
                start = selection.start -1;
                end = selection.end;
            } else {
                start = selection.start;
                end = selection.end + 1;
            }
        } else {
            start = selection.start;
            end = selection.end;
        }

        let [run, runIndex] = this.findRun(start);
        let interval = this.intervals[runIndex];

        if (interval.end !== start) { // that is, pos is within the run
            this.splitRunsAt(runIndex, start - interval.start);
            // here, previous run ends at pos. and next one starts at pos.
            runIndex += 1;
        }

        let endRun = run;
        let endRunIndex;
        let endRunInterval;
        [endRun, endRunIndex] = this.findRun(end);
        endRunInterval = this.intervals[endRunIndex];

        let reminder = end - endRunInterval.start;
        if (end !== endRunInterval.end) {
            this.splitRunsAt(endRunIndex, reminder);
            endRunIndex += 1;
        } else if (end === endRunInterval.end) {
            endRunIndex += 1;
        }

        this.runs.splice(runIndex, endRunIndex - runIndex);
        this.canonicalize(this.runs);
        this.updateSelectionsDelete(user, start, end);
    }

    doSelect(user, start, end) {
        this.selections[user.id] = {start, end, color: user.color};
    }

    length() {
        return this.intervals[this.intervals.length-1].end;
    }

    equalStyle(prev, next) {
        let defaultFont = this.defaultFont;
        let defaultSize = this.defaultSize;
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

    copyRun(run) {
        if (!run) {return run;}
        let obj = {};
        obj.text = run.text;
        if (run.style) {
            obj.style = run.style;
        }
        return obj;
    }

    canonicalize(runs) {
        let result = [];
        let newIntervals = [];
        let lastRun = this.copyRun(runs[0]);
        let start = 0;
        let i = 1;
        let run = this.copyRun(runs[i]);
        while (run) {
            if (this.equalStyle(lastRun.style, run.style)) {
                lastRun.text += run.text;
            } else {
                let end = start + lastRun.text.length;
                let interval = {start, end};
                start = end;
                result.push(lastRun);
                newIntervals.push(lastRun);
                lastRun = run;
            }
            i++;
            run = this.copyRun(runs[i]);
        }
        let end = start + lastRun.text.length;
        let interval = {start, end};
        result.push(lastRun);
        newIntervals.push(interval);
        this.runs = result;
        this.intervals = newIntervals;
    }

    save(optStart, optEnd) {
        // intervals is dropped as an external form
        let runs = this.runs;
        let intervals = this.intervals;
        let start = optStart !== undefined ? optStart : 0;
        let end = optEnd !== undefined ? optEnd : this.length();
        let startRun, startRunIndex;
        let endRun, endRunIndex;
        let run, obj, interval;
        [startRun, startRunIndex] = this.findRun(start);
        [endRun, endRunIndex] = this.findRun(end);

        if (startRunIndex === endRunIndex) {
            let interval = intervals[startRunIndex];
            let obj = this.copyRun({text: startRun.text.slice(start - interval.start, end - interval.start)});
            return [obj];
        }

        let result = [];
        run = startRun;
        interval = intervals[startRunIndex];

        obj = this.copyRun({text: run.text.slice(start - interval.start)}, true);
        result.push(obj);

        for (let i = startRunIndex + 1; i <= endRunIndex - 1; i++) {
            obj = this.copyRun(runs[i]);
            result.push(obj);
        }

        interval = intervals[endRunIndex];

        obj = this.copyRun({text: endRun.text.slice(0, end - interval.start)});
        result.push(obj);
        return result;
    }

    plainText(optStart, optEnd) {
        return this.save(optStart, optEnd).map(c => c.text).join('');
    }

    splitRunsAt(runIndex, sizeInRun) {
        let run = this.runs[runIndex];
        let interval = this.intervals[runIndex];

        let one = this.copyRun({text: run.text.slice(0, sizeInRun),
                   style: run.style});
        let two = this.copyRun({text: run.text.slice(sizeInRun, run.text.length),
                   style: run.style});
        this.runs.splice(runIndex, 1, one, two);

        one = {start: interval.start, end: interval.start + sizeInRun};
        two = {start: interval.start + sizeInRun, end: interval.end};
        this.intervals.splice(runIndex, 1, one, two);
    }

    findRun(pos) {
        let runs = this.runs;
        let intervals = this.intervals;
        for (let ind = 0; ind < runs.length; ind++) {
            let run = runs[ind];
            let interval = intervals[ind];
            if (interval.start <= pos && pos < interval.end) {
                return [runs[ind], ind];
            }
        }
        let ind = runs.length-1
        return [runs[ind], ind];  // should be the eof run
    }

    updateSelectionsInsert(user, pos, length) {
        for (let k in this.selections) {
            let sel = this.selections[k];
            if (k === user.id) {
                this.selections[k] = {start: pos + length, end: pos + length, color: user.color};
            } else {
                if (pos <= sel.start) {
                    this.selections[k] = {start: sel.start + length, end: sel.end + length, color: sel.color};
                } else if (sel.start < pos && pos < sel.end) {
                    this.selections[k] = {start: sel.start, end: sel.end + length, color: sel.color};
                } /*else if (sel.end <= pos) {}*/
            }
        }
    }

    updateSelectionsDelete(user, start, end) {
        let len = end - start;
        for (let k in this.selections) {
            let sel = this.selections[k];
            if (k === user.id) {
                this.selections[k] = {start, end: start, color: user.color};
            } else {
                if (end <= sel.start) {
                    this.selections[k] = {start: sel.start - len, end: sel.end - len, color: sel.color};
                } else if (sel.end <= start) {
                } else if (start <= sel.start && sel.end < end) {
                    this.selections[k] = {start, end: start, color: sel.color};
                } else if (start < sel.start && end < sel.end) {
                    this.selections[k] = {start, end: sel.end - end, color: sel.color};
                } else if (sel.start <= start && end < sel.end) {
                    this.selections[k] = {start: sel.start, end: sel.end - len, color: sel.color};
                } else if (sel.start <= start && start < sel.end) {
                    this.selections[k] = {start: sel.start, end: sel.end - start, color: sel.color};
                }
            }
        }
    }

    setSelections(selections) {
        this.selections = selections;
    }

    ensureSelection(user) {
        let sel = this.selections[user.id];
        if (!sel) {
            sel = {start: 0, end: 0, color: user.id};
            this.selections[user.id] = sel;
        }
        return sel;
    }

    performUndo() {
        let command = this.commands.pop();

        if (command) {
            command.undo(this);
        }
        this.canonicalize(this.runs);
    }

    receiveEditEvents(events, content, doc) {
        // What this method assumes, and what this method does are:
        // - edit events from a client who lagged badly won't be processed.
        // - The model maintains the timezone counter, which is incremented once for a series
        //   of edit commands from a client (effectively, once in the invocation of
        //   this method).
        // - An event sent to the model (to this method) has a timezone value,
        //   which is the value the model sent to the view as the last view update. That is,
        //   the view commands are considered to be generated in that logical timezone.
        // - When an event arrives, first the timezone of the event is checcked to see
        //   if it is still considered recent enough.
        //   -- insert and delete events use the selection value in the model;
        //      so they don't have to be transformed.  They are puhsed into the list.
        //   -- a select event may be off as there are edit events already processed;
        //      so it has to be transformed against the events in the list with the same
        //      logical time or after but already in the list.
        // - The model executes new events, and update its data structure.
        // - Then, the early elements in the list are dropped as they are deemed to be
        //   past their life.
        // - The list is a part of the saved model. It will be saved with the string content.
        // Things are all destructively updated in content,

        content.timezone++;
        let CUTOFF = 60;
        let queue = content.queue;
        let user = events[0].user; // {id, color}

        if (queue.length > 0
            && (queue[queue.length - 1].timezone > events[0].timezone + CUTOFF)) {
                return content.timezone;
        }

        function findFirst(queue, event) {
            if (queue.length === 0) {
                return 0;
            }
            if (queue[queue.length-1].timezone < event.timezone) {
                return queue.length;
            }
            for (let i = queue.length - 1; i >= 0; i--) {
                if (queue[i].timezone < event.timezone) {
                    return i+1;
                }
            }
            return 0;
        }

        function transform(n, o) {
            // it already assumes that n (for new) is newer than o (for old)
            // the first empty obj in assign is not necessary; but make it easier to debug
            if (n.type === "select") {
                if (o.type === "insert") {
                    if (o.pos <= n.start) {
                        return Object.assign({}, n, {start: n.start + o.length,
                                                    end: n.end + o.length});
                    }
                    if (n.start <= o.pos && o.pos <= n.end) {
                        return Object.assign({}, n, {end: n.end + o.length});
                    }
                    return n;
                }
                if (o.type === "delete") {
                    if (n.end <= o.start) {
                        return n;
                    }
                    if (o.start <= n.start && n.end <= o.end) {
                        // subsume
                        return Object.assign({}, n, {start: o.start, end: o.start});
                    }
                    if (o.end <= n.start) {
                        return n;
                    }
                    if (n.start <= o.start && n.end < o.end) {
                        return Object.assign({}, n, {end: o.start});
                    }
                    if (o.start <= n.start && o.end < n.end) {
                        return Object.assign({}, n, {start: o.start, end: n.end - o.end});
                    }
                }
                if (o.type === "select") {
                    return n;
                }
            }
            return n;
        }

        let thisQueue = [];
        let unseenIDs = Object.assign({}, content.selections);

        // all events in the variable 'events' should be in the same timezone;
        // so pick the zero-th one
        let ind = findFirst(queue, events[0]);

        events.forEach(event => {
            let t = event;
            if (ind >= 0) {
                for (let i = ind; i < queue.length; i++) {
                    t = transform(t, queue[i]);
                }
            }
            t.timezone = content.timezone;
            thisQueue.push(t);
        });

        queue.push(...thisQueue);

        // finish up by dropping old events
        ind = queue.findIndex(e => e.timezone > content.timezone - CUTOFF);
        for (let i = queue.length-1; i >= 0; i--) {
            let e = queue[i];
            delete unseenIDs[e.user.id];
        }
        for (let k in unseenIDs) {
            delete content.selections[k];
        }
        queue.splice(0, ind);

        doc.setSelections(content.selections);
        thisQueue.forEach(e => doc.doEvent(e));

        return content.timezone;
    }
}

export class Warota {
    constructor(options, optDoc) {
        this.doc = optDoc || new Doc();
        this._width = 0;
        if (options.margins) {
            this.margins = options.margins;
        } else {
            this.margins = options.margins = {left: 0, top: 0, right: 0, bottom: 0};
        }

        this.scrollLeft = 0;
        this.scrollTop = 0;
        this.relativeScrollBarWidth = 0.02;
        this.showsScrollbar = options.showScrollBar;
        this.isScrollable = true;

        this.resize(options.width, options.height);
        this.resizeToNumLinesOrFontSize(options);

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

    setTimezone(num) {
        this.timezone = num;
    }

    resize(width, height) {
        this.screenWidth = width;
        this.screenHeight = height;
    }

    resizeToNumLinesOrFontSize(options) {
        let lineHeight = new Measurer().lineHeight(options.font);
        let marginHeight = (options.margins.top + options.margins.bottom);
        let textScreenHeight = options.height - marginHeight;
        if (options.fontSize) {
            options.numLines = textScreenHeight / options.fontSize;
        } else {
            if (options.numLines) {
                options.fontSize = textScreenHeight / options.numLines;
            } else {
                options.numLines = 10;
                options.fontSize = textScreenHeight / options.numLines;
            }
        }

        let textScreenPixels = options.numLines * lineHeight;
        let heightInPixel = options.fontSize / lineHeight;
        let neededPixels = textScreenPixels + marginHeight * heightInPixel;

        this.pixelY = neededPixels;
        let scale = neededPixels / this.screenHeight;
        this.pixelX = this.screenWidth * scale;

        if (this.pixelX * this.relativeScrollBarWidth <= 30) {
            this.relativeScrollBarWidth = 30 / this.pixelX;
        }

        this.width(this.pixelX * (1.0 - this.relativeScrollBarWidth));
        this.lineHeight = lineHeight;
        this.pixelMargins = {left: options.margins.left * heightInPixel,
                                right: options.margins.right * heightInPixel,
                                top: options.margins.top * heightInPixel,
                                bottom: options.margins.bottom * heightInPixel};

        options.pixelMargins = this.pixelMargins;
    }

    layout() {
        let [lines, words] = new Wrap().wrap(this.doc.runs, this._width, new Measurer(), this.doc.defaultFont, this.doc.defaultSize, this.pixelMargins);
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
        let {left, top, width, height} = rect;
        this.words.forEach(word => {
            if (word.left + word.width < left || word.top > top + height
                || word.top + word.height < top || word.left > left + width) {return;}
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
        for (let k in this.doc.selections) {
            let selection = this.doc.selections[k];
            if (selection.end === selection.start) {
                ctx.fillStyle = 'barSelection ' + selection.color;
                let caretRect = this.barRect(selection);
                ctx.fillRect(caretRect.left, caretRect.top, caretRect.width, caretRect.height);
            } else {
                ctx.fillStyle = 'boxSelection ' + selection.color;
                let rects = this.selectionRects(selection);
                rects.forEach(box => {
                  ctx.fillRect(box.left, box.top, box.width, box.height);
                });
            }
        }
        ctx.restore();
    }

    drawScrollbar(ctx) {
        let {pixelX, pixelY} = this,
        {l, t, h, w} = this.scrollbarBounds();
        ctx.save();
        ctx.fillStyle = "scrollBar";
        ctx.fillRect(l, 0, w, pixelY);

        ctx.fillStyle = "scrollKnob";
        ctx.fillRect(l+3, t, w-6, h);
        ctx.restore();
    }

    scrollbarBounds() {
        let {
          pixelX,
          pixelY,
          scrollTop: scrollT, // ratio into area
          relativeScrollBarWidth: relWidth,
        } = this;
        let docH = this.docHeight;
        let scrollVRatio = pixelY / docH;
        let barW = pixelX * relWidth;
        let barLeft = pixelX - barW;
        let barTop = scrollT * pixelY;
        let minHeight = pixelY / 100 * 5;
        let barH = scrollVRatio > 1.0 ? pixelY - 3 : Math.max(minHeight, pixelY * scrollVRatio - 6);
        return {l: barLeft, t: barTop, w: barW, h: barH};
    }

    scrollBy(deltaX, deltaY) {
        this.setScroll(this.scrollLeft = deltaX, this.scrollTop + deltaY);
    }

    setScroll(scrollLeft, scrollTop) {
        let {pixelY, docHeight} = this;
        let max = 1.0 - pixelY / docHeight;
        this.scrollTop = Math.max(0, Math.min(max, scrollTop));
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
        if (!line) {return null;}

        let wordIndex = line.findIndex(w => w.start <= pos && pos < w.end);
        if (wordIndex < 0) {
            wordIndex = this.words.length - 1;
        }
        return line[wordIndex];
    }

    insert(user, runs) {
        let evt = Event.insert(user, runs, this.timezone);
        this.events.push(evt);
    }

    delete(user, start, end) {
        let evt = Event.delete(user, start, end, this.timezone);
        this.events.push(evt);
    }

    select(user, start, end) {
        let evt = Event.select(user, start, end, this.timezone);
        this.events.push(evt);
    }

    doEvent(evt) {
        this.doc.doEvent(evt);
        this.layout();
    }

    positionFromIndex(pos) {
        let word = this.findWord(pos);
        if (!word) {return {left: 0, top: 0, width: 0, height: 0};}

        let lp = pos - word.start;
        let measure0 = new Measurer().measureText(word.text.slice(0, pos-word.start), word.style);
        let measure1 = new Measurer().measureText(word.text.slice(0, pos-word.start+1), word.style);
        return {left: word.left + measure0.width, top: word.top, width: measure1.width - measure0.width, height: word.height};
    }

    indexFromPosition(x, y) {
        let word = this.findWord(null, x, y);
        if (!word) {return 0;}
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

    changeLine(user, pos, dir) {
        let [line, lineIndex] = this.findLine(pos);
        let rect = this.positionFromIndex(pos);
        let newLineIndex = lineIndex + dir;
        if (newLineIndex < 0) {return 0;}
        if (newLineIndex >= this.lines.length) {
            return this.lines[this.lines.length-1][0].start;
        }
        let newLine = this.lines[newLineIndex];
        return this.indexFromPosition(rect.left, newLine[0].top);
    }

    barRect(selection) {
        let rect = this.positionFromIndex(selection.start);
        return {left: rect.left, top: rect.top, width: 5, height: rect.height};
    }

    selectionRects(selection) {
        let [line0, line0Index] = this.findLine(selection.start);
        let [line1, line1Index] = this.findLine(selection.end);

        if (line0 === undefined || line1 === undefined) {return [];}

        if (line0Index === line1Index) {
            // one rectangle
            let pos1 = this.positionFromIndex(selection.start);
            let pos2 = this.positionFromIndex(selection.end);
            return [{left: pos1.left, top: pos1.top,
                    width: pos2.left - pos1.left,
                    height: pos1.height}];
        }
        let rects = [];
        let pos1 = this.positionFromIndex(selection.start);
        let pos2 = this.positionFromIndex(line0[line0.length-1].end);
        rects.push({left: pos1.left, top: pos1.top,
                    width: this.width() - pos1.left,
                    height: pos1.height});
        if (line1Index - line0Index >= 2) {
            pos1 = this.positionFromIndex(this.lines[line0Index+1][0].start);
            pos2 = this.positionFromIndex(selection.end);
            rects.push({left: this.pixelMargins.left, top: pos1.top,
                        width: this.width(),
                        height: pos2.top - pos1.top});
        }

        pos1 = this.positionFromIndex(this.lines[line1Index][0].start);
        pos2 = this.positionFromIndex(selection.end);
        rects.push({left: this.pixelMargins.left, top: pos1.top,
                    width: pos2.left - this.pixelMargins.left,
                    height: pos2.height});
        return rects;
    }

    isScrollbarClick(x, y) {
        if (!this.showsScrollbar) {return false;}
        let scrollBarWidth = this.relativeScrollBarWidth * this.pixelX,
            scrollBarLeft = this.pixelX - scrollBarWidth - 3;
        return x >= scrollBarLeft;
    }

    mouseDown(x, y, realY, user) {
        if (this.isScrollbarClick(x, y)) {
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
            this.select(user, index, index);
        }
        this.keyboardX = null;
    }

    mouseMove(x, y, realY, user) {
        if (this.selectDragStart !== null) {
            let other = this.indexFromPosition(x, y);
            let start, end;
            if (other) {
                this.focusChar = other;
                if (this.selectDragStart > other) {
                    this.extendingSelection = 'top';
                    start = other;
                    end = this.selectDragStart;
                } else {
                    this.extendingSelection = 'bottom';
                    start = this.selectDragStart;
                    end = other;
                }
                let last = this.doc.selections[user.id];
                if (last && (last.start !== start || last.end !== end)) {
                    this.select(user, start, end);
                    return 'selectionChanged';
                }
            }
            return null;
        }

        if (this.scrollBarClick) {
            let {realStartY, scrollBarTopOnDown} = this.scrollBarClick;
            let docHeight = this.docHeight;
            let newPos = (realY - realStartY) // movement
                          * Math.max(1, docHeight / this.pixelY) // how many pixels it means relative to doc height
                          / docHeight   // ratio in doc height
                          + scrollBarTopOnDown;  // make it the new value
            this.scrollBarClick.type = "move";
            this.setScroll(0, newPos);
            return 'scrollChanged';
        }
        return null;
    }

    mouseUp(x,y , realY, user) {
        if (this.scrollBarClick) {
            if (this.scrollBarClick.type === "clicked") {
            }
            this.scrollBarClick = null;
            this.wasScrollBarClick = true;
        } else {
            this.wasScrollBarClick = false;
        }
        this.selectDragStart = null;
        this.keyboardX = null;
    }

    backspace(user) {
        let selection = this.doc.selections[user.id] || {start: 0, end: 0, color: user.color};
        if (selection.start === selection.end && selection.start > 0) {
            this.delete(userID.id, selection.start - 1, selection.end);
        } else {
            this.delete(userID.id, selection.start, selection.end);
        }
    }

    handleKey(user, key, selecting, ctrlKey) {
        let selection = this.doc.selections[user.id] || {start: 0, end: 0, color: user.color};
        let lastLine = this.lines[this.lines.length-1];
        let lastWord = lastLine[lastLine.length-1];
        let start = selection.start,
            end = selection.end,
            length = lastWord.end,
            handled = false;

        if (!selecting) {
            this.keyboardSelect = 0;
        } else if (!this.keyboardSelect) {
            switch (key) {
            case 37: // left arrow
            case 38: // up - find character above
            case 36: // start of line
            case 33: // page up
                this.keyboardSelect = -1;
                break;
            case 39: // right arrow
            case 40: // down arrow - find character below
            case 35: // end of line
            case 34: // page down
                this.keyboardSelect = 1;
                break;
            default:
                break;
            }
        }

        let pos = this.keyboardSelect === 1 ? end : start;
        let changingCaret = false;
        switch (key) {
        case 37: // left arrow
            if (!selecting && start !== end) {
                pos = start;
            } else {
                if (pos > 0) {
                    pos--;
                }
            }
            changingCaret = true;
            break;
        case 39: // right arrow
            if (!selecting && start !== end) {
                pos = end;
            } else {
                if (pos < length) {
                    pos++;
                }
            }
            changingCaret = true;
            break;

        case 40: // down arrow - find character below
          pos = this.changeLine(user, pos, 1);
          changingCaret = true;
          break;
        case 38: // up - find character above
          pos = this.changeLine(user, pos, -1);
          changingCaret = true;
          break;

        case 8: // backspace
            this.backspace(user);
            handled = true;
            break;
        default:
            break;
        }

        if (changingCaret) {
            switch (this.keyboardSelect) {
            case 0:
                start = end = pos;
                break;
            case -1:
                start = pos;
                break;
            case 1:
                end = pos;
            break;
            }

            if (start === end) {
                this.keyboardSelect = 0;
            } else {
                if (start > end) {
                    this.keyboardSelect = -this.keyboardSelect;
                    let t = end;
                    end = start;
                    start = t;
                }
            }
            this.select(user, start, end);
            handled = true;
        }
        return handled;
    }

    selectionText(user) {
        let sel = this.doc.selections[user.id];
        if (!sel) {
            return "";
        }
        return this.doc.plainText(sel.start, sel.end);
    }
}

export class Event {
    static insert(user, runs, timezone) {
        return {type: "insert", user, runs, length: runLength(runs), timezone};
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

    static select(user, start, end, timezone) {
        return {type: "select", user, start, end, timezone};
    }

    static doSelect(doc, select) {
        doc.doSelect(select.user, select.start, select.end, select.color);
    }

    static undoSelect(doc, select) { }
}
