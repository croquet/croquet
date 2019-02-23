export const ModelEvents = {
    destroyed: "model-destroyed"
};

const ModelConstructors = {};

export default class Model {
    // LIFECYCLE
    /** @arg {IslandReplica} island */
    constructor(island, state={}) {
        this.island = island;
        this.id = island.registerModel(this, state.id);
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

    // STATE
    state(state) {
        state.constructorName = this.constructor.name;
        state.id = this.id;
    }

    static fromState(island, state) {
        const Constructor = ModelConstructors[state.constructorName];
        if (Constructor) return new Constructor(island, state);

        // HACK: go through all exports and find model subclasses
        for (let m of Object.values(module.bundle.cache)) {
            for (let [key, value] of Object.entries(m.exports)) {
                if (value.prototype instanceof this) {
                    const name = key === "default" ? value.name : key;
                    ModelConstructors[name] = value;
                }
            }
        }
        if (ModelConstructors[state.constructorName]) {
            return this.fromState(island, state);
        }
        throw new Error(`Class "${state.constructorName}" not found, is it exported?`);
    }

    // NATURAL VIEW
    /** @abstract */
    naturalViewClass(_viewContext) {}
}
