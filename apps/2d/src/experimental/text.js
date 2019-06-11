import { Model, View } from "@croquet/teatime";

const COLORS = [ "#FFF", "#C00", "#0C0", "#880", "#00C", "#C0C", "#0CC", "#888" ];
const CURSOR = "|";

export class Text extends Model {

    applyState(state) {
        this.text = state.text || {
            contents: '',
            selections: {},
        };
    }

    toState(state) {
        super.toState(state);
        state.text = this.text;
    }

    // non-inherited methods below

    changed() {
        this.publish('text-changed', this.text);
    }

    keydown(user, key, meta, shift) {
        const sel = this.text.selections[user];
        if (meta || key.length > 1) this.command(sel, key, meta, shift);
        else {
            this.replace(sel, key);
        }
    }

    command(sel, key, meta, shift) {
        if (key.length === 1) key = key.toUpperCase();
        const l = this.text.contents.length;
        switch (key) {
            case "Enter":  this.replace(sel, '\n'); break;
            case "ArrowRight": sel.end = Math.min(l, sel.end + 1);
                if (!shift) sel.start = sel.end; break;
            case "ArrowLeft": sel.start = Math.max(0, sel.start - 1);
                if (!shift) sel.end = sel.start; break;
            case "Backspace": if (sel.start === sel.end) sel.start = Math.max(0, sel.start - 1);
                this.replace(sel, ''); break;
            case 'Shift': case 'Control': case 'Alt': case 'Meta': return;
                default:
                console.warn(`Unhandled key: ${meta ? 'Meta-' : ''}${shift ? 'Shift-' : ''}${key}`);
                return;
        }
        this.changed();
    }

    replace(sel, string) {
        const text = this.text.contents;
        this.text.contents = text.slice(0, sel.start) + string + text.slice(sel.end);
        const delta = sel.end - sel.start + string.length;
        for (const each of Object.values(this.text.selections)) {
            if ((sel !== each) && each.start > sel.end) {
                each.start += delta;
                each.end += delta;
            }
        }
        sel.end = sel.start + string.length;
        sel.start = sel.end;
        this.changed();
    }

    createSelection(user) {
        if (!this.text.selections[user]) {
            this.text.selections[user] = { start: 0, end: 0, color: this.unusedColor() };
        }
        this.changed();
    }

    unusedColor() {
        const usedColors = Object.values(this.text.selections).map(sel => sel.color).sort();
        let i = 0;
        while (usedColors.includes(i)) i++;
        return i;
    }
}


export class TextView extends View {

    constructor(model) {
        super(model);
        this.div = document.createElement("div");
        this.render(model.text);
        document.body.appendChild(this.div);

        this.subscribePart(this.modelId, null, 'text-changed', null, "render", true);

        document.addEventListener("keydown", evt => {
            this.model.keydown(this.user, evt.key, evt.metaKey || evt.ctrlKey, evt.shiftKey);
        });

        // eslint-disable-next-line no-alert
        this.user = localStorage.user || (localStorage.user = window.prompt("What's your name for this browser?"));
        this.model.createSelection(this.user);
    }

    // non-inherited methods below

    render(text) {
        // clear old spans
        while (this.div.firstChild) this.div.removeChild(this.div.firstChild);
        // create characters
        const chars = text.contents.split('').map(char => ({char, color: 0}));
        // apply selections
        const cursors = [];
        for (const { start, end, color } of Object.values(text.selections)) {
            if (start === end) cursors.push({start, color});
            else for (let i = start; i < end; i++) {
                chars[i].color |= 1 << color;
            }
        }
        // insert cursors
        for (const { start, color } of cursors.sort((a,b) => b.start - a.start)) {
            const here = chars.length > 0 ? chars[Math.min(start, chars.length-1)].color : 0;
            chars.splice(start, 0, { char: CURSOR, color: here | 1 << color });
        }
        chars.push({char: '', color: -1}); // force end of last span
        // create spans
        let prev = 0;
        let string = '';
        for (const {char, color} of Object.values(chars)) {
            if (color !== prev && string) {
                const span = document.createElement("span");
                if (string === CURSOR) span.style.color = COLORS[prev % COLORS.length];
                else span.style.backgroundColor = COLORS[prev % COLORS.length];
                span.innerText = string;
                this.div.appendChild(span);
                string = '';
            }
            prev = color;
            string += char;
        }
    }
}
