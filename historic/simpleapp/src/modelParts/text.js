import { ModelPart } from "../parts";
import { Doc } from "../util/warota/warota";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const TextEvents = {
    changed: 'text-changed',
};

export default class TextPart extends ModelPart {
    static types() {
        return {
            "Warota.Doc": { cls: Doc },  // no writer func -> not serialized
        };
    }

    constructor() {
        super();
        this.content = { runs: [], selections: {}, undoStacks: {}, timezone: 0, queue: [], editable: true };
    }

    init(options, id) {
        super.init(options, id);
        this.content = { ...this.content, editable: options.editable !== undefined ? options.editable : true, ...options.content};
        this.doc = new Doc();
        this.doc.load(this.content.runs);
        this.doc.selections = this.content.selections;
        window.model = this;
    }

    acceptContent() {
        console.log("accept", this.doc.plainText());
    }

    receiveEditEvents(events) {
        let timezone = this.doc.receiveEditEvents(events, this.content, this.doc);
        this.publish(this.id, TextEvents.changed, timezone);
    }

    undoRequest(user) {
        let event;
        let queue = this.content.queue;
        for (let i = queue.length - 1; i >= 0; i--) {
            let e = queue[i];
            if (e.user.id === user.id && (e.type !== "snapshot" && e.type !== "select")) {
                event = queue[i];
                break;
            }
        }
        if (!event) {return;}

        let timezone = this.doc.undoEvent(event, this.content, this.doc);
        this.publish(this.id, TextEvents.changed, timezone);
    }
}
