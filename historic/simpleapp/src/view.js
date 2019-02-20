export default class View {
    // LIFECYCLE
    /** @arg {IslandReplica} island */
    constructor(island) {
        this.island = island;
        this.id = island.registerView(this);
    }

    /** @abstract */
    attach(modelState) {
        this.modelId = modelState.id;
    }
    /** @abstract */
    detach() {}

    model(tOffset=0) {
        return new Proxy({}, {
            get: (target, methodName) => {
                const methodProxy = new Proxy(() => {}, {
                    apply: (_a, _b, args) => {
                        this.island.callModelMethod(this.modelId, methodName, tOffset, args);
                    }
                });
                return methodProxy;
            }
        });
    }

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
