import { ModelComponent } from "../model";

const TextEvents = {
    contentChanged: 'text-contentChanged',
    fontChanged: 'text-fontChanged'
};

export default class TextComponent extends ModelComponent {
    constructor(owner, state={}, componentName="text") {
        super(owner, componentName);
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
