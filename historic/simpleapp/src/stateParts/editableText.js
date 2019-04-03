import StatePart from "../statePart.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const TextEvents = {
    viewContentChanged: 'text-viewContentChanged',
    modelContentChanged: 'text-modelContentChanged',
    sequencedEvents: 'text-sequencedEvents',
};

export default class EditableTextPart extends StatePart {
    fromState(state={}) {
        this.content = state.content || {content: [], selections: {}, timezone: 0, queue: []};
        window.model = this;
    }

    toState(state) {
        state.content = this.content;
    }

    initialUpdate() {
        this.publish(TextEvents.modelContentChanged, this.content);
    }

    plaintext(content) {
        return content.content.map(c => c.text || "").join('');
    }

    acceptContent() {
        console.log("accept");
    }

    receiveEditEvents(events) {
        // What this method assumes, and what this method does are:
        // - edit events from a client who lagged badly won't be processed.
        // - The model maintains the timezone ID, which is incremented once for a series
        //   of edit commands from a client (effectively, once in the invocation of
        //   this method).
        // - AN event sent to the model (to this method) has a timezone value,
        //   which is the value the model sent to the view as the last view update.
        //   That is, the view commands are generated in that logical timezone.
        // - When an event arrives, first the timezone of the event is checcked to see
        //   if it is still considered recent enough.
        //   -- Then, starting from the first events with the same timezone,
        //      the event will be inclusively transformed repeatedly until the last event,
        //      and it will be pushed to the list.
        //   -- And also, the event will be pushed to the list of events that needs
        //      to be sent to the view.
        // - Then, the early elements in the list are dropped as they are deemed to be
        //   past their life.
        // - The list is a part of the saved model. It will be saved with the string content.

        this.content.timezone++;

        function findFirst(queue, event) {
            return queue.findIndex(elem => event.timezone >= elem.timezone);
        }

        function transform(n, o) {
            // it already assumes that n (for new) is newer than o (for old)
            let len = o.end - o.start;
            if (n.type === "insert") {
                if (o.type === "insert") {
                    if (n.pos > o.pos) {
                        return Object.assign({}, n, {pos: n.pos + len});
                    }
                    return n;
                } else if (o.type === "erase") {
                    if (n.pos < o.start) {
                        return n;
                    }
                    if (o.start <= n.pos && n.pos < o.end) {
                        return Object.assign({}, n, {pos: o.start});
                    }
                    return Object.assign({}, n, {pos: n.pos - len});
                }
            } else if (n.type === "erase") {
                if (o.type === "insert") {
                    if (n.end < o.pos) {
                        return n;
                    }
                    if (n.start <= o.pos && o.pos < n.end) {
                        return Object.assign({}, n, {pos: o.start});
                    }
                    return Object.assign({}, n, {pos: n.pos - len});
                }
                if (o.type === "erase") {
                    if (n.end < o.start) {
                        return n;
                    }
                    if (o.start <= n.start && n.end < o.end) {
                        return Object.assign({}, n, {start: n.start, end: n.start});
                    }
                    if (o.end <= n.start) {
                        return Object.assign({}, n, {start: n.start - len, end: n.end - len});
                    }
                    if (n.start <= o.start && n.end < o.end) {
                        return Object.assign({}, n, {end: o.start});
                    }
                    if (o.start <= n.start && o.end < n.end) {
                        return Object.assign({}, n, {start: o.start, end: n.end - o.end});
                    }
                }
            }
            return null; // to catch an error
        }

        let queue = this.content.queue;
        let sendQueue = [];
        let unseenIDs = Object.assign({}, this.content.selections);
        // all events in variable 'events' should be in the same timezone
        let ind = findFirst(queue, events[0]);
        events.forEach(event => {
            let t = event;
            if (ind >= 0) {
                for (let i = ind; i < queue.length; i++) {
                    t = transform(t, queue[i]);
                }
            }
            t.timezone = this.content.timezone;
            sendQueue.push(t);
            queue.push(t);
        });

        ind = queue.findIndex(e => e.timezone < this.content.timezone - 60);

        for (let i = 0; i < ind; i++) {
            let e = queue[i];
            delete unseenIDs[e.user];
        }
        for (let k in unseenIDs) {
            delete this.content.selections[k];
        }
        queue.splice(0, ind);

        this.publish(TextEvents.sequencedEvents, sendQueue);
    }
}
