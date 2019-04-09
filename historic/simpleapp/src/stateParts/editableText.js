import { StatePart } from "../modelView.js";

import { Doc } from "../viewParts/editableText/warota/doc.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const TextEvents = {
    viewContentChanged: 'text-viewContentChanged',
    modelContentChanged: 'text-modelContentChanged',
    sequencedEvents: 'text-sequencedEvents',
};

export default class EditableTextPart extends StatePart {
    applyState(state={}) {
        this.content = state.content || {content: [], selections: {}, timezone: 0, queue: []};
        this.doc = new Doc();
        this.doc.load(this.content.content);
        this.doc.selections = this.content.selections; // sharing would be bad
        window.model = this;
    }

    toState(state) {
        state.content = this.content;
    }

    plaintext(content) {
        return content.content.map(c => c.text || "").join('');
    }

    acceptContent() {
        console.log("accept");
    }

    receiveEditEvents(events) {
        let sendQueue = this.doc.receiveEditEvents(events, this.content, this.doc);
        let saved = this.doc.save();
        this.content.content = saved.content;
        this.publish(TextEvents.sequencedEvents, sendQueue);
    }
}
