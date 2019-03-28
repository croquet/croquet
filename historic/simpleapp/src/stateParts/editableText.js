import StatePart from "../statePart.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const TextEvents = {
    viewContentChanged: 'text-viewContentChanged',
    modelContentChanged: 'text-modelContentChanged',
};

export default class EditableTextPart extends StatePart {
    fromState(state={}) {
        this.content = state.content || {content: [], selection: {start: 0, end: 0}};
        window.model = this;
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
