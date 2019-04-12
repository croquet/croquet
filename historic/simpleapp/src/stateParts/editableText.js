import { StatePart } from "../modelView";
import { addMessageTranscoder } from "../island";

import { Doc } from "../util/warota/warota";

addMessageTranscoder('*', { encode: a => a, decode: a => a });

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const TextEvents = {
    changed: 'text-changed',
};

export default class EditableTextPart extends StatePart {
    applyState(state={}) {
        let content = {runs: [], selections: {}, timezone: 0, queue: [], editable: state.editable !== undefined ? state.editable : true, ...state.content};
        this.content = content;
        let viewOptions = {font: 'Roboto',
                           fontSize: 0.25,
                           width: 3,
                           height: 2,
                           editable: true,
                           showSelection: true,
                           showScrollBar: true,
                           hideBackbackground: false,
                           backgroundColor: 'eeeeee',
                           margins: {left: 0, right: 0, top: 0, bottom: 0}, ...state.viewOptions};
        this.viewOptions = viewOptions;
        this.doc = new Doc();
        this.doc.load(this.content.runs);
        this.doc.selections = this.content.selections;
        window.model = this;
    }

    toState(state) {
        state.content = this.content;
        state.viewOptions = this.viewOptions;
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
