import Component, { ComponentOwner } from './component.js';

/** @extends ComponentOwner<ViewvComponent> */
export default class View extends ComponentOwner {
    // LIFECYCLE
    /** @arg {import('./islandReplica').default} island */
    constructor(island) {
        super();
        this.island = island;
        this.id = island.registerView(this);
    }

    attach(modelState) {
        this.modelId = modelState.id;
        for (let componentName of Object.keys(this.components)) {
            this.components[componentName].attach(modelState);
        }
    }

    detach() {
        for (let componentName of Object.keys(this.components)) {
            this.components[componentName].detach();
        }
    }

    addToThreeParent(parent) {
        for (let componentName of Object.keys(this.components)) {
            const component = this.components[componentName];
            if (component.addToThreeParent) component.addToThreeParent(parent);
        }
    }

    removeFromThreeParent(parent) {
        for (let componentName of Object.keys(this.components)) {
            const component = this.components[componentName];
            if (component.removeFromThreeParent) component.removeFromThreeParent(parent);
        }
    }

    model(tOffset=0) {
        return new Proxy({}, {
            get: (_t1, componentOrMethodName) => {
                const componentOrMethodProxy = new Proxy(() => {}, {
                    get: (_t2, methodName) => {
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
}

/** @extends ViewComponent<View> */
export class ViewComponent extends Component {
    // LIFECYCLE
    /** @abstract */
    attach(modelState) {}

    /** @abstract */
    detach() {}

    // PUB/SUB
    subscribe(event, methodName, scope=this.owner.id, component=this.componentName) {
        const fullScope = scope + (component ? "." + component : "");
        this.owner.island.addViewSubscription(fullScope, event, this.owner.id, this.componentName, methodName);
    }

    unsubscribe(event, methodName, scope=this.owner.id, component=this.componentName) {
        const fullScope = scope + (component ? "." + component : "");
        this.owner.island.removeViewSubscription(fullScope, event, this.owner.id, this.componentName, methodName);
    }

    publish(event, data, scope=this.owner.id, component=this.componentName) {
        const fullScope = scope + (component ? "." + component : "");
        this.owner.island.publishFromView(fullScope, event, data);
    }

    asViewComponentRef() {
        return this.owner.id + "." + this.componentName;
    }
}
