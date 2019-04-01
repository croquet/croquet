import StatePart from "../statePart.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const TextEvents = {
    contentChanged: 'text-contentChanged',
    fontChanged: 'text-fontChanged'
};

export default class TextPart extends StatePart {
    fromState(state={}) {
        this.content = state.content || "";
        this.font = state.font || "Barlow";
    }

    toState(state) {
        state.content = this.content;
        state.font = this.font;
    }

    setContent(newContent) {
        this.content = newContent;
        this.publish(TextEvents.contentChanged, newContent);
    }

    setFont(font) {
        this.font = font;
        this.publish(TextEvents.fontChanged, font);
    }
}
