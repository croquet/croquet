import Part, { PartOwner } from './parts.js';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

/** @extends PartOwner<ViewPart> */
export default class View extends PartOwner {
    // LIFECYCLE
    /** @arg {import('./island').default} island */
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
        for (const partId of Object.keys(this.parts)) {
            if (this.parts[partId] instanceof ViewPart) {
                this.parts[partId].attach(modelState);
            }
        }
    }

    detach() {
        for (const partId of Object.keys(this.parts)) {
            if (this.parts[partId] instanceof ViewPart) {
                this.parts[partId].detach();
                if (!this.parts[partId].superDetachedCalled) {
                    throw new Error("super.detach() wasn't called by " + Object.prototype(this.parts[partId]).constructor.name + ".detach()");
                }
            }
        }
    }

    addToThreeParent(parent) {
        for (const partId of Object.keys(this.parts)) {
            const part = this.parts[partId];
            if (part.addToThreeParent) part.addToThreeParent(parent);
        }
    }

    removeFromThreeParent(parent) {
        for (const partId of Object.keys(this.parts)) {
            const part = this.parts[partId];
            if (part.removeFromThreeParent) part.removeFromThreeParent(parent);
        }
    }

    get model() {
        return new Proxy({}, {
            get: (_t1, partOrMethodName) => {
                const partOrMethodProxy = new Proxy(() => {}, {
                    get: (_t2, methodName) => {
                        const partMethodProxy = new Proxy(() => {}, {
                            apply: (_a, _b, args) => {
                                this.island.callModelMethod(this.modelId, partOrMethodName, methodName, args);
                            }
                        });
                        return partMethodProxy;
                    },
                    apply: (_a, _b, args) => {
                        this.island.callModelMethod(this.modelId, null, partOrMethodName, args);
                    }
                });
                return partOrMethodProxy;
            }
        });
    }

    // PUB/SUB
    subscribePart(scope, part, event, subscribingPartId, methodName) {
        const fullScope = scope + (part ? "." + part : "");
        this.island.addViewSubscription(fullScope, event, this.id, subscribingPartId, methodName);
    }

    unsubscribePart(scope, part, event, subscribingPartId, methodName) {
        const fullScope = scope + (part ? "." + part : "");
        this.island.removeViewSubscription(fullScope, event, this.id, subscribingPartId, methodName);
    }

    publish(scope, part, event, data) {
        const fullScope = scope + (part ? "." + part : "");
        this.island.publishFromView(fullScope, event, data);
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

    detach() {
        this.owner.island.removeAllViewSubscriptionsFor(this.owner.id, this.partId);
        this.superDetachedCalled = true;
    }

    // PUB/SUB
    subscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        this.owner.subscribePart(scope, part, event, this.partId, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, part=this.partId) {
        this.owner.unsubscribePart(scope, part, event, this.partId, methodName);
    }

    publish(event, data, scope=this.owner.id, part=this.partId) {
        this.owner.publish(scope, part, event, data);
    }

    asViewPartRef() {
        return this.owner.id + "." + this.partId;
    }
}
