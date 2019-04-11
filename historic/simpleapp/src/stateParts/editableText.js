import { StatePart } from "../modelView.js";
import { addMessageTranscoder } from "../island.js";

import { Doc } from "../util/warota/warota.js";

addMessageTranscoder('*', { encode: a => a, decode: a => a });

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const TextEvents = {
    changed: 'text-changed',
};

export default class EditableTextPart extends StatePart {
    applyState(state={}) {
        let content = {...{runs: [], selections: {}, timezone: 0, queue: []}, ...{runs: state.content.runs}};
        this.content = content;
        this.viewOptions = {font: state.font, numLines: state.numLines, width: state.width, height: state.height, editable: state.editable, showSelection: state.showSelection, showScrollBar: state.showScrollBar, margins: state.margins};
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
