/** A domain manages subscriptions */
export class Domain {

    constructor() {
        /** maps topic to subscribers, handling is either "immediate" or "queued" or "oncePerFrame"
         * @type {{"scope:event": {handling: Set<{fn: Function, for}>}}}
         */
        this.subscriptions = {};
        /** queue of view events generated by model in this frame */
        this.frameEventQueue = [];
        /** data of oncePerFrame events generated by model in this frame */
        this.frameEventMap = new Map();
        /**  */
        this.id = uuidv4();
        this.lastId = 0;
    }

    register(_object) {
        return this.id + "/V" + ++this.lastId;
    }

    deregister(_object) {
    }

    /** Add a subscription
     *
     * @param {String} scope - a string that publishers and subscribers agree on
     * @param {String} event - a name for the event
     * @param {*} subscriber - the owner of this subscription
     * @param {Function} callback - a function called when event is published in scope
     * @param {"immediate"|"queued"|"oncePerFrame"} handling - when to invoke the handler
     */
    addSubscription(scope, event, subscriber, callback, handling) {
        const topic = scope + ":" + event;
        const handler = callback;
        handler.for = subscriber;
        let subs = this.subscriptions[topic];
        if (!subs) subs = this.subscriptions[topic] = {
            immediate: new Set(),
            queued: new Set(),
            oncePerFrame: new Set(),
        };
        subs[handling].add(handler);
    }

    /** Remove a subscription
     *
     * @param {String} scope - a string that publishers and subscribers agree on
     * @param {String} event - a name for the event
     * @param {*} subscriber - the owner of this subscription
     */
    removeSubscription(scope, event, subscriber) {
        const topic = scope + ":" + event;
        const subs = this.subscriptions[topic];
        if (subs) {
            const remaining = _removeSubscriber(subs, subscriber);
            if (remaining === 0) delete this.subscriptions[topic];
        }
    }

    /** Remove all subscriptions
     *
     * @param {*} subscriber
     */
    removeAllSubscriptionsFor(subscriber) {
        const topicPrefix = `${subscriber}:`;
        // TODO: optimize this - reverse lookup table?
        for (const [topic, subs] of Object.entries(this.subscriptions)) {
            if (topic.startsWith(topicPrefix)) delete this.subscriptions[topic];
            else {
                const remaining = _removeSubscriber(subs, subscriber);
                if (remaining === 0) delete this.subscriptions[topic];
            }
        }
    }

    /** An event was published. Invoke its immediate handlers now, and/or queue it
     * for later execution in processFrameEvents()
     */
    handleEvent(topic, data) {
        // model=>view events are typically queued for later execution from the main loop
        // The subscriber is encouraged to request batch handling, which only invokes the handler
        // for the latest event per render frame (e.g. to batch multiple position updates into one)
        // The subscriber may request immediate handling, but it must not modify model state!
        const topicSubscribers = this.subscriptions[topic];
        if (topicSubscribers) {
            if (topicSubscribers.queued.size > 0) this.frameEventQueue.push({topic, data});
            if (topicSubscribers.oncePerFrame.size > 0) this.frameEventMap.set(topic, data);
            for (const handler of topicSubscribers.immediate) handler(data);
        }
    }

    /** Process all queued and oncePerFrame events that were generated since the last invocation
     * @returns {Number} number of processed events
     */
    processFrameEvents() {
        let n = 0;
        // process queued events in order
        for (const {topic, data} of this.frameEventQueue) {
            const subscriptions = this.subscriptions[topic];
            if (subscriptions) {
                for (const handler of subscriptions.queued) { handler(data); n++; }
            }
        }
        this.frameEventQueue.length = 0;
        // process oncePerFrame events in any order
        for (const [topic, data] of this.frameEventMap) {
            const subscriptions = this.subscriptions[topic];
            if (subscriptions) {
                for (const handler of subscriptions.oncePerFrame) { handler(data); n++; }
            }
        }
        this.frameEventMap.clear();
        return n;
    }

}


function _removeSubscriber(subscriptions, subscriber) {
    function removeHandler(handlers) {
        for (const handler of handlers) {
            if (handler.for === subscriber) handlers.delete(handler);
        }
    }
    removeHandler(subscriptions.immediate);
    removeHandler(subscriptions.oncePerFrame);
    removeHandler(subscriptions.queued);
    return subscriptions.immediate.size + subscriptions.queued.size + subscriptions.oncePerFrame.size;
}

export const viewDomain = new Domain();

function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => {
        return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
    });
}
