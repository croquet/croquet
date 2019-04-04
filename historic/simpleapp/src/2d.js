import Island, { connectToReflector, Controller, addMessageTranscoder } from "./island.js";
import Model from "./model.js";
import View from "./view.js";


const COLORS = [ "white", "lightblue", "yellow", "lightgreen" ];


addMessageTranscoder('*', a => a, a => a);


export class Text extends Model {

    constructor(state) {
        super(state);
        this.island.set('text', this);
        this.text = state.text || {
            contents: 'Type something!',
            selections: {},
        };
    }

    toState(state) {
        super.toState(state);
        state.text = this.text;
    }

    // non-inherited methods below

    changed() {
        this.publish(this.id, null, 'text-changed', this.text);
        console.log(JSON.stringify(this.text));
    }

    keydown(user, key, shift, cmd) {
        const sel = this.text.selections[user];
        this.replace(sel, key);
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


class TextView extends View {

    attach(modelState) {
        super.attach(modelState);
        this.div = document.createElement("div");
        this.render(modelState.text);
        document.body.appendChild(this.div);

        this.subscribePart(this.modelId, null, 'text-changed', null, "render", true);

        document.addEventListener("keydown", evt => this.model.keydown(this.user, evt.key, evt.shiftKey, evt.metaKey || evt.ctrlKey));

        this.user = localStorage.user || (localStorage.user = window.prompt("Who are you?"));
        this.model.createSelection(this.user);
    }

    // non-inherited methods below

    render(text) {
        // clear old spans
        while (this.div.firstChild) this.div.removeChild(this.div.firstChild);
        // create characters
        const chars = text.contents.split('').map(char => ({char, color: 0}));
        // apply selections
        for (const { start, end, color } of Object.values(text.selections)) {
            for (let i = start; i <= end; i++) {
                chars[i].color |= 1 << color;
            }
        }
        chars.push({char: '', color: -1}); // force end of last span
        // create spans
        let prev = 0;
        let string = '';
        for (const {char, color} of Object.values(chars)) {
            if (color !== prev && string) {
                const span = document.createElement("span");
                span.style.backgroundColor = COLORS[prev % COLORS.length];
                span.innerText = string;
                this.div.appendChild(span);
                string = '';
            }
            prev = color;
            string += char;
        }
    }
}


function initIsland(state) {
    return new Island(state, () => {
        new Text({}, {id: 'text1'});
    });
}

async function go() {
    connectToReflector("wss://dev1.os.vision/reflector-v1");

    const controller = new Controller();
    const island = await controller.createIsland("2d", {
        moduleID: module.id,
        creatorFn: initIsland,
    });

    const textView = new TextView(island);
    textView.attach(island.get('text'));

    function run() {
        controller.simulate(Date.now() + 200);
        island.processModelViewEvents();
    }
    setInterval(run, 50);
}


go();
