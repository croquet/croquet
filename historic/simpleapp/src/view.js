import Part, { PartOwner } from './parts.js';

/** @extends PartOwner<ViewvPart> */
export default class View extends PartOwner {
    // LIFECYCLE
    /** @arg {import('./islandReplica').default} island */
    constructor(island) {
        super();
        this.island = island;
        this.id = island.registerView(this);
    }

    attach(modelState) {
        this.modelId = modelState.id;
        for (let partName of Object.keys(this.parts)) {
            this.parts[partName].attach(modelState);
        }
    }

    detach() {
        for (let partName of Object.keys(this.parts)) {
            this.parts[partName].detach();
        }
    }

    addToThreeParent(parent) {
        for (let partName of Object.keys(this.parts)) {
            const part = this.parts[partName];
            if (part.addToThreeParent) part.addToThreeParent(parent);
        }
    }

    removeFromThreeParent(parent) {
        for (let partName of Object.keys(this.parts)) {
            const part = this.parts[partName];
            if (part.removeFromThreeParent) part.removeFromThreeParent(parent);
        }
    }

    model(tOffset=0) {
        return new Proxy({}, {
            get: (_t1, partOrMethodName) => {
                const partOrMethodProxy = new Proxy(() => {}, {
                    get: (_t2, methodName) => {
                        const partMethodProxy = new Proxy(() => {}, {
                            apply: (_a, _b, args) => {
                                this.island.callModelMethod(this.modelId, partOrMethodName, methodName, args, tOffset);
                            }
                        });
                        return partMethodProxy;
                    },
                    apply: (_a, _b, args) => {
                        this.island.callModelMethod(this.modelId, null, partOrMethodName, args, tOffset);
                    }
                });
                return partOrMethodProxy;
            }
        });
    }
}

/** @extends ViewPart<View> */
export class ViewPart extends Part {
    // LIFECYCLE
    /** @abstract */
    attach(_modelState) {}

    /** @abstract */
    detach() {}

    // PUB/SUB
    subscribe(event, methodName, scope=this.owner.id, part=this.partName) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.addViewSubscription(fullScope, event, this.owner.id, this.partName, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, part=this.partName) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.removeViewSubscription(fullScope, event, this.owner.id, this.partName, methodName);
    }

    publish(event, data, scope=this.owner.id, part=this.partName) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.publishFromView(fullScope, event, data);
    }

    asViewPartRef() {
        return this.owner.id + "." + this.partName;
    }
}
