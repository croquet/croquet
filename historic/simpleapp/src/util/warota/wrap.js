import { fontRegistry } from "../fontRegistry";

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

        const isSpace = (str) => /[ \f\n\r\t\v\u00A0\u2028\u2029]/.test(str);
        const isNewline = (str) => /[\n\r]/.test(str);

        let words = [];
        let lines = [];

        let isInWord;
        let start = 0;
        let leftOver = "";
        let styles = null;
        let thisWord;

        let push = (obj, style, ms) => {
            if (ms && ms.length > 1) {
                words.push(Object.assign(obj, {styles: ms}));
            } else if (ms && ms.length === 1) {
                if (ms[0].style) {
                    words.push(Object.assign(obj, {style: ms[0]}));
                } else {
                    words.push(obj);
                }
            } else if (style) {
                if (style.style) {
                    words.push(Object.assign(obj, {style}));
                } else {
                    words.push(obj);
                }
            } else {
                words.push(obj);
            }
        };

        let stylePush = (ms, newOne) => {
            if (!ms) {
                return [newOne];
            }
            let last = styles[styles.length-1];
            if (!this.equalStyle(last.style, newOne.style)) {
                styles.push(newOne);
                return styles;
            }
            last.end = newOne.end;
            return styles;
        };

        let style;
        for (let i = 0; i < runs.length; i++) {
            let run = runs[i];
            let text = run.text;
            style = run.style;
            if (start === 0  && i === 0) {
                isInWord = !isSpace(text[start]);
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
            thisWord = text.slice(wordStart, text.length);
            let fragment = {start: leftOver.length, end: leftOver.length + thisWord.length, style: style};
            styles = stylePush(styles, fragment);
            leftOver += thisWord;
        }
        push({start, end: start + leftOver.length, text: leftOver}, style, styles);
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
                    let m = measurer.measureText(word.text.slice(word.styles[i].start, word.styles[i].end), word.styles[i], defaultFont);
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
