import StatePart from "../statePart.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const TextEvents = {
    viewContentChanged: 'text-viewContentChanged',
    modelContentChanged: 'text-modelContentChanged',
};

export default class EditableTextPart extends StatePart {
    fromState(state={}) {
        this.content = state.content || [];
        this.subscribe(TextEvents.viewContentChanged, "onContentChanged");

        window.model = this;
    }

    toState(state) {
        state.content = this.content;
    }

    onContentChanged(newContent) {
        this.content = newContent;
    }
}
