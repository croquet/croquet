export default class View {
    // LIFECYCLE
    /** @arg {IslandReplica} island */
    constructor(island) {
        this.island = island;
        this.id = island.registerView(this);
    }

    /** @abstract */
    attach(modelState) {}
    /** @abstract */
    detach() {}

    // PUB/SUB
    subscribe(scope, event, methodName) {
        this.island.addViewSubscription(scope, event, this.id, methodName);
    }

    unsubscribe(scope, event, methodName) {
        this.island.removeViewSubscription(scope, event, this.id, methodName);
    }

    publish(event, data, scope=this.id) {
        this.island.publishFromView(scope, event, data);
    }
}