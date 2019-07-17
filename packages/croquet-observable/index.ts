import { Model, View, PubSubParticipant } from '@croquet/croquet';

export interface ObservableModel extends Model {
    publishPropertyChange(property: string): void;
}

/**
 * Create a new __observable__ model
 * @param BaseClass
 */
export function Observable(BaseClass: typeof Model) {
    return class extends BaseClass implements ObservableModel {
        /**
         *
         * public
         */
        publishPropertyChange(property: string) {
            this.publish(this.id + "#" + property, "changed", null);
        }
    };
}

export interface ModelObserving {
    subscribeToPropertyChange(model: ObservableModel, property: string, callback: any): void;
    unsubscribeFromPropertyChange(model: ObservableModel, property: string): void;
}


export function Observing<M extends Model>(BaseClass: new (...args: any[]) => M): new (...args: any[]) => (M & ModelObserving);
export function Observing<V extends Model>(BaseClass: new (...args: any[]) => V): new (...args: any[]) => (V & ModelObserving);
export function Observing(BaseClass: new (...args: any[]) => PubSubParticipant): new (...args: any[]) => (PubSubParticipant & ModelObserving) {
    return class extends BaseClass implements ModelObserving {
        /**
         *
         * public
         */
        subscribeToPropertyChange(model: ObservableModel, property: string, callback: any) {
            this.subscribe(model.id + "#" + property, "changed", callback);
        }

        /**
         *
         * public
         */
        unsubscribeFromPropertyChange(model: ObservableModel, property: string) {
            this.unsubscribe(model.id + "#" + property, "changed");
        }
    };
}



const deepChangeProxyCache = new WeakMap();

const MUTATING_METHODS = ["push", "pop", "splice", "unshift", "shift", "sort", "reverse", "copyWithin", "fill"];

function mutatingMethodProxy(fn: Function, onCalled: Function) {
    return new Proxy(fn, {
        apply(target, thisArg, argArray) {
            Reflect.apply(target, thisArg, argArray);
            onCalled();
        }
    });
}

function deepChangeProxy(object: any, onChangeAtAnyDepth: Function) {
    if (typeof object === "object" && object !== null) {
        if (deepChangeProxyCache.has(object)) {
            return deepChangeProxyCache.get(object);
        }

        const proxy: any = new Proxy(object, {
            get(target, prop, receiver) {
                if (typeof target[prop] === "function") {
                    if (typeof prop == 'string' && MUTATING_METHODS.includes(prop)) {
                        return mutatingMethodProxy(target[prop], onChangeAtAnyDepth);
                    }
                }
                return deepChangeProxy(Reflect.get(target, prop, receiver), onChangeAtAnyDepth);
            },

            set(target, prop, value, receiver) {
                const result = Reflect.set(target, prop, value, receiver);
                onChangeAtAnyDepth();
                return result;
            },

            deleteProperty(target, prop) {
                const result = Reflect.deleteProperty(target, prop);
                onChangeAtAnyDepth();
                return result;
            }
        });

        deepChangeProxyCache.set(object, proxy);
        return proxy;
    }

    // primitive value
    return object;
}

export function AutoObservableModel<S extends Object>(initialState: S): ObservableModel & S {
    const cls = class ObservableClass extends Observable(Model) {
        static create(options: any) {
            const model = super.create(options);
            for (const [prop, initialValue] of Object.entries(initialState)) {
                (model as any)[prop] = initialValue;
            }
            return model;
        }
    };

    for (const prop of Object.keys(initialState)) {
        const realProp = "_o_" + prop;
        Object.defineProperty(cls.prototype, prop, {
            get() {
                return deepChangeProxy(this[realProp], () => {
                    this.publishPropertyChange(prop);
                });
            },
            set(newVal) {
                this[realProp] = newVal;
                this.publishPropertyChange(prop);
            }
        });
    }

    return cls as any as ObservableModel & S;
}
