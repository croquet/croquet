import Part, { PartOwner } from './parts.js';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

/** @extends PartOwner<ViewPart> */
export default class View extends PartOwner {
    // LIFECYCLE
    /** @arg {import('./islandReplica').default} island */
    constructor(island, viewOptions={}) {
        super();
        this.island = island;
        this.id = island.registerView(this);
        this.buildParts(viewOptions);
    }

    /** @abstract */
    buildParts(_viewOptions) {}

    attach(modelState) {
        this.modelId = modelState.id;
        for (let partId of Object.keys(this.parts)) {
            this.parts[partId].attach(modelState);
        }
    }

    detach() {
        for (let partId of Object.keys(this.parts)) {
            this.parts[partId].detach();
        }
    }

    addToThreeParent(parent) {
        for (let partId of Object.keys(this.parts)) {
            const part = this.parts[partId];
            if (part.addToThreeParent) part.addToThreeParent(parent);
        }
    }

    removeFromThreeParent(parent) {
        for (let partId of Object.keys(this.parts)) {
            const part = this.parts[partId];
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

/** @extends Part<View> */
export class ViewPart extends Part {
    static defaultPartId() {
        const name = this.name.replace("ViewPart", "");
        return name.charAt(0).toLowerCase() + name.slice(1);
    }

    constructor(owner, options) {
        super(owner, options);
        this.fromOptions(options);
    }

    /** @abstract */
    fromOptions(_options) {}

    // LIFECYCLE
    /** @abstract */
    attach(_modelState) {}

    /** @abstract */
    detach() {}

    // PUB/SUB
    subscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.addViewSubscription(fullScope, event, this.owner.id, this.partId, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.removeViewSubscription(fullScope, event, this.owner.id, this.partId, methodName);
    }

    publish(event, data, scope=this.owner.id, part=this.partId) {
        const fullScope = scope + (part ? "." + part : "");
        this.owner.island.publishFromView(fullScope, event, data);
    }

    asViewPartRef() {
        return this.owner.id + "." + this.partId;
    }
}
