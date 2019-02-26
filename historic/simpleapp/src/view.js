export default class View {
    // LIFECYCLE
    /** @arg {import('./islandReplica').default} island */
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
            get: (_, componentOrMethodName) => {
                const componentOrMethodProxy = new Proxy(() => {}, {
                    get: (_, methodName) => {
                        const componentMethodProxy = new Proxy(() => {}, {
                            apply: (_a, _b, args) => {
                                this.island.callModelMethod(this.modelId, componentOrMethodName, methodName, args, tOffset);
                            }
                        });
                        return componentMethodProxy;
                    },
                    apply: (_a, _b, args) => {
                        this.island.callModelMethod(this.modelId, null, componentOrMethodName, args, tOffset);
                    }
                });
                return componentOrMethodProxy;
            }
        });
    }

    // PUB/SUB
    subscribe(event, methodName, scope=this.id) {
        this.island.addViewSubscription(scope, event, this.id, methodName);
    }

    unsubscribe(event, methodName, scope=this.id) {
        this.island.removeViewSubscription(scope, event, this.id, methodName);
    }

    publish(event, data, scope=this.id) {
        this.island.publishFromView(scope, event, data);
    }
}
