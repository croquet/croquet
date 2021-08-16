import {
    useState,
    useEffect,
    createContext,
    createElement,
    useContext,
    useMemo,
    useCallback
  } from "react";

import {
    View,
    Session,
    CroquetSession,
    Model,
    CroquetModelOptions,
  } from "@croquet/croquet";
import { ObservableModel, Observing } from "@croquet/observable";

// A React context that stores the croquet session
// Provided by `InCroquetSession`, consumed by all the hooks.
export const CroquetContext = createContext<
    CroquetSession<CroquetReactView> | undefined
    >(undefined);

/** Makes use of croquet-observable's convention for listening to property changes of {@link ObservableModels}
 * (whether those proeprty changes are published manually or automatically).
 *
 * On the surface, it simply returns all properties of the input model that you already had access to,
 * but the returned properties are in fact proxied, with the following effects:
 *
 *  * for every returned Model property that you access (by destructuring or direct access), a subscription to property changes to that property is automatically started
 *  * whenever one of these property change subscription gets called, the component using this hook gets rerendered by React, with the hook now returning fresh Model property values.
 *
 * This allows you to very declaratively listen to Model property changes with automatic rerendering.
 *
 * ```
 * function CounterView({counterModel}) {
 *    const {count} = useObservable(counterModel);
 *
 *    return <div>The current count is {count}</div>
 * }
 * ```
 */

export function useObservable<M extends ObservableModel>(model: M): M {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    const [, forceUpdate] = useState({});

    const onChange = () => {
        forceUpdate({});
    };

    // once (on component mount), create an access-monitoring proxy and one-use-view
    const {proxy, oneUseView} = useMemo(
        () => {
            const actuallyObservedProps: {
                [prop: string]: true | undefined;
                [prop: number]: true | undefined;
            } = {};
            
            const oneUseView = new (Observing(View))(croquetContext.view.model);

            const proxy = new Proxy(model, {
                // only start subscribing to property changes on properties
                // that the component actually accesses.
                get(target, prop) {
                    if (typeof prop !== "symbol" && !actuallyObservedProps[prop]) {
                        oneUseView.subscribeToPropertyChange(
                            model,
                            prop.toString(),
                            onChange,
                            { handling: "oncePerFrame" }
                        );
                        actuallyObservedProps[prop] = true;
                    }
                    return (target as any)[prop];
                }
            });

            return {oneUseView, proxy};
        },
        [model, croquetContext.view]
    );

    // empty effect that is only used to ensure cleanup
    useEffect(() => {
        // cleanup
        return () => {
            oneUseView.detach();
        };
    }, [oneUseView]);

    return proxy;
}

/** Hook that gives access to the id of the main view. This can be used as an identifier for different clients.
 */
export function useViewId() {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    return croquetContext.view.viewId;
}

/** Hook that gives access to the root Model of this croquet session.
 * Can be used to read Model properties (including other referenced Models),
 * and to publish events to the Model or to subscribe to Model events using the other hooks.
 */
export function useModelRoot(): Model {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    return croquetContext.view.model;
}

/** Hook that gives access to the Model specified by an id of this croquet session.
 * Can be used to read Model properties (including other referenced Models),
 * and to publish events to the Model or to subscribe to Model events using the other hooks.
 */
export function useModelById(id:string): Model|undefined {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    return croquetContext.view.model.getModel(id);
}

/** Hook that returns a function that will have an event publishing effect.
 * Needs to be provided with a `publishCallback` that determines the event and data to be published,
 * by either returning `[scope, event, data]` or just `[scope, event]`.
 * Any arguments passed to the function returned by the hook will be forwarded to `publishCallback` as-is.
 * Any state variables that the publish callback depends on internally need to be provided as `deps`,
 * like for React's own `useCallback` hook.
 *
 *
 * A simple example:
 * ```
 * function IncrementCounterButton({counterModel}) {
 *    const publishIncrement = usePublish(
 *      () => [counterModel.id, 'increment', 1],
 *      [counterModel]
 *    );
 *
 *    return <button onClick={publishIncrement} value="Increment"/>;
 * }
 * ```
 *
 * Forwarding arguments:
 * ```
 * function IncrementCounterBy10Button({counterModel}) {
 *    const publishIncrement = usePublish(
 *      (incrementBy) => [counterModel.id, 'increment', incrementBy],
 *      [counterModel]
 *    );
 *
 *    return <button onClick={() => publishIncrement(10)} value="Increment by 10"/>;
 * }
 * ```
 */
export function usePublish(
    publishCallback: (...args: any[]) => [string, string] | [string, string, any],
    deps: any[]
): (...args: any[]) => void {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    return useCallback(
        (...args) => {
            const result = publishCallback(...args);
            if (result && result.length >= 2) {
                const [scope, event, data] = result;
                croquetContext.view.publish(scope, event, data);
            }
        },
	// deps are not in play here as publishCallback has to be fresh to capture what it depnds on
        [publishCallback, croquetContext.view]
    );
}

/** Hook that listens to events matching the provided `scope` and `eventSpec`.
 * Event data is passed as an argument to `callback`.
 * Automatically unsubscribes when the component is demounted.
 * Any state variables that `callback` uses internally need to be provided as `deps`,
 * like for React's own `useEffect` hook.
 *
 * ```
 *  function StatusBar({counterModel}) {
 *    const [status, setStatus] = useState("Counting...");
 *
 *    useSubscribe(
 *      counterModel.id,
 *      "maximumReached",
 *      (maximum) => {setStatus("Maximum reached!")},
 *      [setStatus]
 *    );
 *
 *    return <div>Current Status: {status}</div>;
 *  }
 * ``` */
export function useSubscribe(scope: string, eventSpec: string, callback: (data: any) => void, deps: any[]) {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    useEffect(() => {
        const oneUseView = new View(croquetContext.view.model);
        oneUseView.subscribe(scope, eventSpec, callback);
        // cleanup on component unmount
        return () => {
            oneUseView.unsubscribe(scope, eventSpec);
            oneUseView.detach();
        }
	// deps is not in play here as callback has to capture what it depends on
    }, [scope, eventSpec, callback, croquetContext.view]);
}

type UpdateCallback = (time:number) => void;
type SimpleCallback = () => void;
type SyncedCallback = (flag:boolean) => void;

/** Hook that sets up a callback for Croquet.View.update().
 * The function will be called at each simulation cycle.
 * ``` */

export function useUpdateCallback(callback:UpdateCallback|null) {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    croquetContext.view.updateCallback = callback;
}

/** Hook that sets up a callback for Croquet.View.synced().
 * The function will be called when Croquet synced event occurs.
 * ``` */

export function useSyncedCallback(callback:SyncedCallback|null) {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw new Error("No Croquet Context provided!");
    croquetContext.view.syncedCallback = callback;
}

// our top level view that gets the root model
// and from which we create our one-time-use views per component
class CroquetReactView extends Observing(View) {
    model: Model;
    updateCallback: UpdateCallback|null;
    syncedCallback: SyncedCallback|null;

    constructor(model: Model) {
        super(model);
        this.model = model;
        this.updateCallback = null;
	this.syncedCallback = null;
	this.subscribe(this.viewId, "synced", this.synced);
    }

    update(time:number) {
        if (this.updateCallback !== null) {
            this.updateCallback(time);
        }
    }

    synced(flag:boolean) {
	if (this.syncedCallback) {
            this.syncedCallback(flag);
	}
    }
}

// just a type helper to make the documentation look cleaner and more descriptive
type ClassOf<M> = new (...args: any[]) => M

/** Main wrapper component that starts and manages a croquet session, enabling child elements to use the
 * {@link usePublish}, {@link useSubscribe}, {@link useObservable}, {@link useViewId} and {@link useModelRoot} hooks.
 *
 * Takes the same parameters as {@link Session.join} except that it doesn't need a root View class,
 * since croquet-react provides a suitable View class behind the scenes.
 *
 * ```
 * function MyApp() {
 *    return (
 *      <InCroquetSession
 *        appId="com.example.myapp"
 *        name="mySession"
 *        password="secret"
 *        modelRoot={MyRootModel}
 *      >
 *        // child elements that use hooks go here...
 *      </InCroquetSession>
 *    );
 * }
 * ```
 */
export function InCroquetSession<M extends Model>(params: {
    appId: string,
    name: string|Promise<string>,
    password: string,
    modelRoot: ClassOf<M>;
    eventRateLimit?: number,
    options?: CroquetModelOptions;
    children: React.ReactNode;
}) {
    const {
        appId,
        name,
        password,
        modelRoot,
        eventRateLimit,
        options,
        children,
    } = params;
    const [croquetContext, setCroquetContext] = useState<
        CroquetSession<CroquetReactView> | undefined
        >(undefined);
    useEffect(() => {
        Session.join({
            name,
            appId,
            password,
            model: modelRoot,
            eventRateLimit,
            view: CroquetReactView,
            options
        }).then(setCroquetContext);
    }, [name, modelRoot, options, appId, password, eventRateLimit]);

    if (croquetContext) {
        return createElement(
            CroquetContext.Provider,
            { value: croquetContext },
            children
        );
    } else {
        return createElement("div");
    }
}
