import { ModelPart } from "../model.js";

const TextEvents = {
    contentChanged: 'text-contentChanged',
    fontChanged: 'text-fontChanged'
};

export default class TextPart extends ModelPart {
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
