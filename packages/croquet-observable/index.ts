import { Model, View, PubSubParticipant, ViewSubOptions } from '@croquet/croquet';

export interface ObservableModel extends Model {
    publishPropertyChange(property: string): void;
}

interface ModelStatics {
    create<T extends typeof Model>(this: T, options: any): InstanceType<Model>;
    register(classId:string): void;
    wellKnownModel<M extends Model>(name: string): M | undefined;
}

/**
 * Mixin that supplies a standard implementation for {@link ObservableModel#publishPropertyChange} into the given Model BaseClass.
 * This makes this method is available to all classes extending the mixed-in BaseClass, **allowing them to publish property changes as a {@link ObservableModel}**.
 *
 * ```
 * class CounterModel extends Observable(Model) {
 *      init(options = {}) {
 *          super.init(options);
 *          this.count = 0;
 *          this.subscribe(this.id, 'increment', this.onIncrement);
 *      }
 *
 *      onIncrement() {
 *          this.count += 1;
 *          publishPropertyChange("count");
 *      }
 * }
 * ```
 *
 * @param BaseClass
 */
export function Observable<M extends Model>(BaseClass: ClassOf<M>): ModelStatics & ClassOf<M & ObservableModel> {
    return class ObservableClass extends (BaseClass as ClassOf<Model>) {
        /**
         *
         * public
         */
        publishPropertyChange(property: string) {
            this.publish(this.id + "#" + property, "changed", null);
        }
    } as ModelStatics & ClassOf<M & ObservableModel>;
}

export interface ModelObserving<SubOptions> {
    subscribeToPropertyChange(model: ObservableModel, property: string, callback: any, options?: SubOptions): void;
    unsubscribeFromPropertyChange(model: ObservableModel, property: string): void;
}

type ClassOf<M> = new (...args: any[]) => M

/** Mixin that supplies a standard implementation for {@link ModelObserving#subscribeToPropertyChange} and {@link ModelObserving#unsubscribeFromPropertyChange}
 * into a Model *or* View BaseClass.
 * This makes these methods is available to all classes extending the mixed-in BaseClass, **allowing them to listen to property changes of {@link ObservableModel}s**.
 *
 * ```
 * class CounterView extends Observing(View) {
 *      constructor(model) {
 *          this.model = model;
 *          this.subscribeToPropertyChange(model, "count", this.onCountChanged, {handling: "oncePerFrame"});
 *      }
 *
 *      onCountChanged() {
 *          console.log("Count changed! " + this.model.count);
 *      }
 * }
 * ```
 */
export function Observing<M extends Model>(BaseClass: ClassOf<M>): ClassOf<M & ModelObserving<{}>>;
export function Observing<V extends View>(BaseClass: ClassOf<V>): ClassOf<V & ModelObserving<ViewSubOptions>>;
export function Observing<SubOptions>(BaseClass: ClassOf<PubSubParticipant<SubOptions>>): ClassOf<PubSubParticipant<SubOptions> & ModelObserving<SubOptions>> {
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

// This creates proxies around objects that detect even deep changes
// (to sub-properties) and call the given callback on mutation.
// This is used to implement the auto-publish functionalities
// of AutoObservables.
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

/** Create a model class that consist solely of automatically observable properties.
 *
 * This works by defining getters and setters for all properties implied by `initialState`,
 * which not only read and change those properties as if they were instance members,
 * but automatically publish corresponding property change events on every property write.
 *
 * The CounterModel example from {@link Observable}, where properties changes were published
 * manually, can be rewritten using `AutoObservableModel` like this:
 *
 * ```
 * class CounterModel extends AutoObservableModel({count: 0}) {
 *      init(options = {}) {
 *          super.init(options);
 *          this.subscribe(this.id, 'increment', this.onIncrement);
 *      }
 *
 *      onIncrement() {
 *          // automatically publishes property change event
 *          this.count += 1;
 *      }
 * }
 * ```
 */
export function AutoObservableModel<S extends Object>(initialState: S): ModelStatics & ClassOf<ObservableModel & S> {
    return AutoObservable(initialState)(Model);
}

/** Mixin that supplies automatically managed observable properties to a Model BaseClass,
 * making it an ObservableModel with respect to these properties.
 *
 * This works by defining getters and setters for all properties implied by `initialState`,
 * which not only read and change those properties as if they were instance members,
 * but automatically publish corresponding property change events on every property write.
 *
 * Combining automatically observed properties with an existing Model class is probably a rarer use case,
 * so the main application for `AutoObservable` is actually through `AutoObservableModel`, which creates
 * a Model class consisting solely of automatically observable properties.
 */
export function AutoObservable<S extends Object>(initialState: S): (BaseClass: typeof Model) => ModelStatics & ClassOf<ObservableModel & S> {
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
                        (this as ObservableModel).publishPropertyChange(prop);
                    });
                },
                set(newVal) {
                    this[realProp] = newVal;
                    this.publishPropertyChange(prop);
                }
            });
        }

	return cls as any as (ModelStatics & ClassOf<ObservableModel & S>);
    }
}
