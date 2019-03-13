import StatePart from "../statePart.js";
import { Carota, setCachedMeasureText } from './carota/editor.js';
import { fontRegistry } from '../viewParts/fontRegistry.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const TextEvents = {
    contentChanged: 'text-contentChanged',
    fontChanged: 'text-fontChanged'
};

export default class TextPart extends StatePart {
    fromState(state={}) {
        this.content = state.content || "";
        this.font = state.font || fontRegistry.defaultFont();
        this.width = state.width || 3;
        this.height = state.height || 2;
        this.numLines = state.numLines || 10;
        this.initEditor();
    }

    toState(state) {
        state.content = this.content;
        state.font = this.font;
        state.width = this.width;
        state.height = this.height;
        state.numLines = this.numLines;
    }

    initEditor() {
        this.editor = new Carota(this.width, this.height, this.numLines);
        Carota.setCachedMeasureText(fontRegistry.measureText.bind(fontRegistry)); // ???

        this.editor.isScrollable = true;  // unless client decides otherwise
        this.editor.load([]);

        this.editor.mockCallback = ctx => {
            let glyphs = this.processMockContext(ctx);
            this.publish(TextEvents.contentChanged, {content: glyphs, corners: this.editor.visibleTextBounds(), scaleX: this.editor.scaleX, scrollTop: this.editor.scrollTop, frameHeight: this.editor.frame.height});
        };

        const callback = () => this.onTextChange();
        this.editor.setSubscribers(callback);
        this.newText(this.content);
    }

    processMockContext(ctx) {
        let layout = fontRegistry.getMeasurer(this.font);
	if (!layout) {return [];}
        let info = fontRegistry.getInfo(this.font);
        return layout.computeGlyphs({font: info, drawnStrings: ctx.drawnStrings});
    }

    onTextChange() {}

    newText(txt) {
        this.editor.load([]); //clear current text
        this.editor.insert(txt); //insert the new text
    }

    newNewText() {
        this.editor.load([]); //clear current text
        this.editor.insert("man is much more than a tool builder... he is an inventor of universes... Except the real one."); //insert the new text
    }

    onKeyDown(str) {
	console.log("onKeyDown", str);
	this.editor.insert(str);
    }

    setContent(newContent) {
        this.content = newContent;
        this.editor.newText(newContent);
    }

    setFont(font) {
        this.font = font;
        this.publish(TextEvents.fontChanged, font);
    }
}
