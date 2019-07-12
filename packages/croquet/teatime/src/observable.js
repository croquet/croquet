import Model from './model';

const deepChangeProxyCache = new WeakMap();

const MUTATING_METHODS = ["push", "pop", "splice", "unshift", "shift", "sort", "reverse", "copyWithin", "fill"];

function mutatingMethodProxy(fn, onCalled) {
    return new Proxy(fn, {
        apply(target, thisArg, argArray) {
            Reflect.apply(target, thisArg, argArray);
            onCalled();
        }
    });
}

function deepChangeProxy(object, onChangeAtAnyDepth) {
    if (typeof object === "object" && object !== null) {
        if (deepChangeProxyCache.has(object)) {
            return deepChangeProxyCache.get(object);
        }

        const proxy = new Proxy(object, {
            get(target, prop, receiver) {
                if (typeof target[prop] === "function") {
                    if (MUTATING_METHODS.includes(prop)) {
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

/**
 * @param {S} initialState
 * @returns {function(new:Model & S)}
 * @template S */
export default function ObservableModel(initialState) {
    const cls = class ObservableClass extends Model {
        static create(options) {
            const model = super.create(options);
            for (const [prop, initialValue] of Object.entries(initialState)) {
                model[prop] = initialValue;
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

    return cls;
}
