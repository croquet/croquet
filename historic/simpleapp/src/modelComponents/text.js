import { ModelComponent } from "../model";

const TextEvents = {
    contentChanged: 'text-contentChanged',
    fontChanged: 'text-fontChanged'
}

export default class TextComponent extends ModelComponent {
    constructor(owner, state={}, componentName="text") {
        super(owner, componentName);
        this.content = state.content || "";
        this.font = state.font || "Barlow";
    }

    setContent(newContent) {
        this.content = newContent;
        this.publish(TextEvents.contentChanged, content);
    }

    setFont(font) {
        this.font = font;
        this.publish(TextEvents.fontChanged, font);
    }
}