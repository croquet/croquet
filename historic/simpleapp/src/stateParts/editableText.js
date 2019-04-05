import { StatePart } from "../modelView.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const TextEvents = {
    viewContentChanged: 'text-viewContentChanged',
    modelContentChanged: 'text-modelContentChanged',
};

export default class EditableTextPart extends StatePart {
    applyState(state={}) {
        this.content = state.content || {content: [], selection: {start: 0, end: 0}};
    }

    toState(state) {
        state.content = this.content;
    }

    updateContents(newContent) {
        this.content = newContent;
        this.publish(TextEvents.modelContentChanged, this.content);
    }

    plaintext(content) {
        return content.content.map(c => c.text || "").join('');
    }

    acceptContent() {
        console.log("accept");
    }
}
