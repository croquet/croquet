import IslandReplica from './islandReplica';

export const ModelEvents = {
    destroyed: "model-destroyed"
};

export default class Model {
    // LIFECYCLE
    /** @arg {IslandReplica} island */
    constructor(island) {
        this.island = island;
        this.id = island.registerModel(this);
    }

    destroy() {
        this.publish(ModelEvents.destroyed);
        this.island.deregisterModel(this.id);
    }

    // FUTURE
    future(tOffset=0) {
        return new Proxy(this, {
            get(target, property) {
                if (typeof target[property] === "function") {
                    const methodProxy = new Proxy(target[property], {
                        apply(targetMethod, _, args) {
                            window.setTimeout(() => {
                                targetMethod.apply(target, args);
                            }, tOffset);
                        }
                    });
                    return methodProxy;
                }
                throw Error("Tried to call " + property + "() on future of " + Object.getPrototypeOf(target).constructor.name + " which is not a function");
            }
        });
    }

    // PUB/SUB
    subscribe(scope, event, methodName) {
        this.island.addModelSubscription(scope, event, this.id, methodName);
    }

    unsubscribe(scope, event, methodName) {
        this.island.removeModelSubscription(scope, event, this.id, methodName);
    }

    publish(event, data, tOffset=0, scope=this.id) {
        this.island.publishFromModel(scope, event, data, tOffset);
    }

    // NATURAL VIEW
    /** @abstract */
    naturalViewClass(viewContext) {}
}
