import { StatePart } from "../modelView";
import { addMessageTranscoder } from "../island";

import { Doc } from "../util/warota/warota";

addMessageTranscoder('*', { encode: a => a, decode: a => a });

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const TextEvents = {
    changed: 'text-changed',
};

export default class TextPart extends StatePart {
    applyState(state={}) {
        let content = {runs: [], selections: {}, timezone: 0, queue: [], editable: state.editable !== undefined ? state.editable : true, ...state.content};
        this.content = content;
        this.doc = new Doc();
        this.doc.load(this.content.runs);
        this.doc.selections = this.content.selections;
        window.model = this;
    }

    toState(state) {
        state.content = this.content;
    }

    acceptContent() {
        console.log("accept", this.doc.plainText());
    }

    receiveEditEvents(events) {
        let timezone = this.doc.receiveEditEvents(events, this.content, this.doc);
        this.content.runs = this.doc.save();
        this.publish(TextEvents.changed, timezone);
    }
}
