const VOTE_SUFFIX = '#__vote'; // internal, for 'vote' handling; never seen by user

/** A domain manages subscriptions */
export class Domain {

    constructor() {
        /** maps topic to handlers, handling is either "immediate" or "queued" or "oncePerFrame" or "oncePerFrameWhileSynced"
         * @type {{[topic: String]: {[handling: String]: Set<{fn: Function, for: String}>}}}
         */
        this.subscriptions = {};
        /** maps subscriber to subscribed topics
         * @type {Map<String, Set<String>>}
        */
        this.subscribers = new Map();
        /** queue of view events generated by model in this frame */
        this.queuedEvents = [];
        /** data of oncePerFrame events generated by model in this frame */
        this.perFrameEvents = new Map();
        /** data of oncePerFrameWhileSynced events generated by model in this frame */
        this.perSyncedFrameEvents = new Map();
        /** counter for subscriberIds */
        this.subscriberIds = 0;
        /** stack of topics being handled */
        this.currentTopics = [];
    }

    register(_subscriber) {
        return "V" + ++this.subscriberIds;
    }

    deregister(_subscriber) {
        // assumes subscriptions have been removed before deregistering
    }

    /** Add a subscription
     *
     * @param {String} scope - a string that publishers and subscribers agree on
     * @param {String} event - a name for the event
     * @param {String} subscriberId - the owner of this subscription
     * @param {Function} callback - a function called when event is published in scope
     * @param {"immediate"|"queued"|"oncePerFrame"|"oncePerFrameWhileSynced"|"vote"} handling - when to invoke the handler
     */
    addSubscription(scope, event, subscriberId, callback, handling) {
        if (handling === 'vote') {
            this.addSubscription(scope, event + VOTE_SUFFIX, subscriberId, callback, 'immediate');
            return;
        }

        const topic = scope + ":" + event;
        const handler = callback;
        handler.for = subscriberId;
        let handlers = this.subscriptions[topic];
        if (!handlers) handlers = this.subscriptions[topic] = {
            immediate: new Set(),
            queued: new Set(),
            oncePerFrame: new Set(),
            oncePerFrameWhileSynced: new Set(),
        };
        if (!handlers[handling]) throw Error(`Unknown subscribe() option: handling="${handling}"`);
        handlers[handling].add(handler);
        let topics = this.subscribers.get(subscriberId);
        if (!topics) this.subscribers.set(subscriberId, topics = new Set());
        topics.add(topic);
    }

    /** Remove a subscription
     *
     * @param {String} scope - a string that publishers and subscribers agree on
     * @param {String} event - a name for the event
     * @param {String} subscriberId - the owner of this subscription
     * @param {Function} callback - the callback function to remove, or null to remove all callbacks for this topic
     */
    removeSubscription(scope, event, subscriberId, callback=null) {
        const topic = scope + ":" + event;
        const handlers = this.subscriptions[topic];
        if (handlers) {
            const remaining = removeHandlers(handlers, subscriberId, callback);
            if (remaining === "none") delete this.subscriptions[topic];
            if (remaining !== "subscriber") {
                const topics = this.subscribers.get(subscriberId);
                topics.delete(topic);
                if (topics.size === 0) this.subscribers.delete(subscriberId);
            }
        }
        if (!event.endsWith(VOTE_SUFFIX)) this.removeSubscription(scope, event + VOTE_SUFFIX, subscriberId);
    }

    /** Remove all subscriptions
     *
     * @param {String} subscriberId
     */
    removeAllSubscriptionsFor(subscriberId) {
        const topics = this.subscribers.get(subscriberId);
        if (topics) {
            for (const topic of topics) {
                const handlers = this.subscriptions[topic];
                if (handlers) {
                    const remaining = removeHandlers(handlers, subscriberId);
                    if (remaining === "none") delete this.subscriptions[topic];
                } else {
                    console.error(`Croquet: topic ${topic} not found in subscriptions table for ${subscriberId} during removeAllSubscriptionsFor()`);
                }
            }
            this.subscribers.delete(subscriberId);
        }
    }

    /** An event was published. Invoke its immediate handlers now, and/or queue it
     * for later execution in processFrameEvents()
     */
    handleEvent(topic, data, immediateWrapper=fn=>fn()) {
        // model=>view events are typically queued for later execution from the main loop
        // The subscriber is encouraged to request batch handling, which only invokes the handler
        // for the latest event per render frame (e.g. to batch multiple position updates into one)
        // The subscriber may request immediate handling, but it must not modify model state!
        const handlers = this.subscriptions[topic];
        if (handlers) {
            if (handlers.queued.size > 0) this.queuedEvents.push({topic, data});
            if (handlers.oncePerFrame.size > 0) this.perFrameEvents.set(topic, data);
            if (handlers.oncePerFrameWhileSynced.size > 0) this.perSyncedFrameEvents.set(topic, data);
            if (handlers.immediate.size > 0) immediateWrapper(() => {
                this.currentTopics.push(topic);
                for (const handler of handlers.immediate) {
                    try { handler(data); }
                    catch (err) {
                        console.error(err);
                        console.warn(`Croquet: error "${err.message}" in "immediate" subscription ${topic}`);
                    }
                }
                this.currentTopics.pop();
            });
        }
    }

    /** Process all queued and oncePerFrame events that were generated since the last invocation
     * @returns {Number} number of processed events
     */
    processFrameEvents(controllerIsInAnimationStep, controllerIsSynced) {
        let n = 0;

        const invokeHandlers = (handling, topic, data) => {
            const handlers = this.subscriptions[topic];
            if (handlers) {
                this.currentTopics.push(topic);
                for (const handler of handlers[handling]) {
                    try { handler(data); }
                    catch (err) {
                        console.error(err);
                        console.warn(`Croquet: error "${err.message}" in "${handling}" subscription ${topic}`);
                    }
                    n++;
                }
                this.currentTopics.pop();
            }
        };

        // process queued events in order (for...of will include any added during the iteration)
        for (const {topic, data} of this.queuedEvents) invokeHandlers('queued', topic, data);
        this.queuedEvents.length = 0;

        // only process per-frame events if this has been triggered by an animation step
        if (controllerIsInAnimationStep) {
            // process oncePerFrame events in any order
            for (const [topic, data] of this.perFrameEvents) invokeHandlers('oncePerFrame', topic, data);
            this.perFrameEvents.clear();

            // process oncePerFrameWhileSynced events in any order
            if (controllerIsSynced) {
                for (const [topic, data] of this.perSyncedFrameEvents) invokeHandlers('oncePerFrameWhileSynced', topic, data);
                this.perSyncedFrameEvents.clear();
            }

            // finally, process any newly queued events
            for (const {topic, data} of this.queuedEvents) invokeHandlers('queued', topic, data);
            this.queuedEvents.length = 0;
        }

        return n;
    }

}

// remove handlers from a topic
function removeHandlers(handlers, subscriberId, callback=null) {
    let remaining = "none";
    for (const handling of ['immediate', 'queued', 'oncePerFrame', 'oncePerFrameWhileSynced']) {
        for (const handler of handlers[handling]) {
            if (handler.for !== subscriberId) {
                if (remaining === "none") remaining = "others"; // there are other subscribers for the same topic
                continue;
            }
            if (callback === null || handler.unbound === callback) {
                handlers[handling].delete(handler);
            } else {
                remaining = "subscriber"; // even this subscriber has other handlers for the same topic
            }
        }
    }
    return remaining;
}

export const viewDomain = globalThis.CROQUETVD = new Domain();
