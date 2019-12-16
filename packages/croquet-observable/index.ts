import { Model, View, PubSubParticipant, ViewSubOptions } from '@croquet/croquet';

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

export interface ModelObserving<SubOptions> {
    subscribeToPropertyChange(model: ObservableModel, property: string, callback: any, options?: SubOptions): void;
    unsubscribeFromPropertyChange(model: ObservableModel, property: string): void;
}


export function Observing<M extends Model>(BaseClass: new (...args: any[]) => M): new (...args: any[]) => (M & ModelObserving<{}>);
export function Observing<V extends View>(BaseClass: new (...args: any[]) => V): new (...args: any[]) => (V & ModelObserving<ViewSubOptions>);
export function Observing<SubOptions>(BaseClass: new (...args: any[]) => PubSubParticipant<SubOptions>): new (...args: any[]) => (PubSubParticipant<SubOptions> & ModelObserving<SubOptions>) {
    return class extends BaseClass implements ModelObserving<SubOptions> {
        /**
         *
         * public
         */
        subscribeToPropertyChange(model: ObservableModel, property: string, callback: any, options?: SubOptions) {
            this.subscribe(model.id + "#" + property, {event: "changed",  ...options}, callback);
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

export function AutoObservableModel<S extends Object>(initialState: S): new (...args: any[]) => (ObservableModel & S){
    return AutoObservable(initialState)(Model);
}

export function AutoObservable<S extends Object>(initialState: S): (BaseClass: typeof Model) => new (...args: any[]) => (ObservableModel & S) {
    return (BaseClass) => {
        const cls = class ObservableClass extends Observable(BaseClass) {
            init(options: any) {
                super.init(options);
                for (const [prop, initialValue] of Object.entries(initialState)) {
                    (this as any)[prop] = initialValue;
                }
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

        return cls as any as new (...args: any[]) => (ObservableModel & S);
    }
}
