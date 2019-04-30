import { fontRegistry } from "../fontRegistry";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

// let fontRegistry = {
//     measureText: function(str, style) {
//         return {width: str.length * 20, height: 50, ascent: 40};
//     },
//     getInfo: function(font) {
//         return {common: {lineHeight: 50}};
//     }
// };

export class Measurer {
    measureText(str, style, font) {
        let m = fontRegistry.measureText(str, style, font);
        return m;
    }

    lineHeight(font) {
        if (!font) {return 50;}
        return fontRegistry.getInfo(font).common.lineHeight;
    }
}

export class Wrap {
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

    splitWords(runs) {
        // returns words and lines.

        if (runs.length === 0) {return [];}

        const isSpace = (str) => /[ \f\n\r\t\v\u00A0\u2028\u2029]/.test(str);
        const isNewline = (str) => /[\n\r]/.test(str);

        let push = (obj, style, ss) => {
            if (ss && ss.length > 1) {
                words.push(Object.assign(obj, {styles: ss}));
            } else if (ss && ss.length === 1) {
                words.push(Object.assign(obj, {style: ss[0]}));
            } else if (style) {
                words.push(Object.assign(obj, {style}));
            } else {
                words.push(obj);
            }
        };

        let stylePush = (ss, newOne) => {
            if (!ss) {
                return [newOne];
            }
            let last = ss[ss.length-1];
            if (!this.equalStyle(last.style, newOne.style)) {
                ss.push(newOne);
                return ss;
            }
            last.end = newOne.end;
            return ss;
        };

        let words = [];
        let lines = [];

        let isInWord = !isSpace(runs[0].text[0]);
        let start = 0;
        let leftOver = "";
        let styles = null;
        let style;
        let thisWord;

        for (let i = 0; i < runs.length; i++) {
            let run = runs[i];
            let text = run.text;
            style = run.style;

            if (!isInWord) {
                isInWord = !isSpace(text[0]);
            }

            let wordStart = 0;
            let runStart = 0;
            for (let j = 0; j < text.length; j++) {
                if (start === 0 && i === 0 && j === 0) {continue;}
                if (isInWord) {
                    if (isSpace(text[j])) {
                        thisWord = text.slice(wordStart, j);
                        if (leftOver.length > 0) {
                            if (thisWord.length > 0) {
                                let newOne = {start: leftOver.length, end: leftOver.length + thisWord.length, style: style};
                                styles = stylePush(styles, newOne);
                            }
                            thisWord = leftOver + thisWord;
                            leftOver = "";
                        }
                        push({start, end: start + thisWord.length, text: thisWord}, style, styles);
                        start += thisWord.length;
                        wordStart = j;
                        isInWord = false;
                        styles = null;
                    }
                } else {
                    push({start, end: start + 1, text: text[j-1], style, styles});
                    styles = null;
                    start += 1;
                    wordStart += 1;
                    if (!isSpace(text[j])) {
                        isInWord = true;
                    }
                }
            }
            // end of a run. the style ends here, but a word may continue
            // when a partial word has a different style
            thisWord = text.slice(wordStart, text.length);
            let fragment = {start: leftOver.length, end: leftOver.length + thisWord.length, style: style};
            styles = stylePush(styles, fragment);
            leftOver += thisWord;
        }
        // the last word in the entire text.
        // the special case here is that the style for left over,
        // and the 'fragment' may just be the same as style.  If that is the case,
        // it simply creates a run with one style
        if (styles.length === 1 && this.equalStyle(style, styles[0].style)) {
            push({start, end: start + leftOver.length, text: leftOver}, style);
        } else {
            push({start, end: start + leftOver.length, text: leftOver}, null, styles);
        }
        return words;
    }

    mergeRect(m1, m2) {
        if (!m1) {return m2;}
        if (!m2) {return m1;}
        return {width: m1.width + m2.width,
                height: Math.max(m1.height, m2.height),
                ascent: Math.max(m1.ascent, m2.ascent),
               };
    }

    wrap(runs, textWidth, measurer, defaultFont, defaultSize, margins={left: 0, top: 0, right: 0, bottom: 0}) {
        // returns words and lines.

        const width = textWidth - margins.left - margins.right;
        //const isSpace = (str) => /[ \f\n\r\t\v\u00A0\u2028\u2029]/.test(str);
        const isNewline = (str) => /[\n\r]/.test(str);

        let currentLine = [];
        let currentHeight = 0;
        let currentAscent = 0;
        let lines = []; // list of list of words

        let left = margins.left;
        let top = margins.top;

        let words = this.splitWords(runs);

        let pushLine = () => {
            if (currentLine.length === 0) {return;}
            currentLine.forEach(c => {
                c.ascent = currentAscent;
            });
            lines.push(currentLine);
            currentLine = [];
            left = margins.left;
            top += currentHeight;
        };

        for (let w = 0; w < words.length; w++) {
            let word = words[w];
            let rect;

            if (isNewline(word.text)) {
                rect = measurer.measureText(' ', word.style, defaultFont);
                if (w === words.length - 1) {
                    pushLine();
                } else {
                    currentHeight = Math.max(currentHeight, rect.height);
                    currentAscent = Math.max(currentAscent, rect.ascent);
                }
                rect.left = left;
                rect.top = top;
                Object.assign(word, rect);
                currentLine.push(word);
                pushLine();
                currentHeight = 0;
                currentAscent = 0;
                continue;
            }

            if (word.styles) {
                // a word with multiple styles
                for (let i = 0; i < word.styles.length; i++) {
                    let partialStyle = word.styles[i];
                    let m = measurer.measureText(word.text.slice(partialStyle.start, partialStyle.end), partialStyle.style, defaultFont);
                    partialStyle.width = m.width;
                    partialStyle.height = m.height;
                    rect = this.mergeRect(rect, m);
                }
            } else {
                rect = measurer.measureText(word.text, word.style, defaultFont);
            }
            currentHeight = Math.max(currentHeight, rect.height);
            currentAscent = Math.max(currentAscent, rect.ascent);

            if (rect.width + left > width) {
                pushLine();
            }
            currentHeight = rect.height;
            currentAscent = rect.ascent;
            rect.left = left;
            rect.top = top;
            Object.assign(word, rect);
            left += rect.width;
            currentLine.push(word);
        }

        pushLine();

        const eof = String.fromCharCode(26); // "^Z"
        let rect = measurer.measureText(' ', null, defaultFont);
        let word = {text: eof};
        currentHeight = Math.max(currentHeight, rect.height);
        currentAscent = Math.max(currentAscent, rect.ascent);
        rect.left = 0;
        rect.top = top;
        Object.assign(word, rect);
        currentLine.push(word);
        pushLine();
        return [lines, words];
    }
}
