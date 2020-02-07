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
    startSession,
    CroquetSession,
    Model,
    CroquetSessionOptions
  } from "@croquet/croquet";
  import { Observing, ObservableModel } from "@croquet/observable";

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
    const [, forceUpdate] = useState();

    const onChange = () => {
      forceUpdate({});
    };

    const actuallyObservedProps: {
      [prop: string]: true | undefined;
      [prop: number]: true | undefined;
    } = {};

    useEffect(() => {
      // cleanup
      return () => {
        for (const prop of Object.keys(actuallyObservedProps)) {
          croquetContext.view.unsubscribeFromPropertyChange(model, prop);
          delete actuallyObservedProps[prop];
        }
      };
    }, [model, croquetContext.view]);

    return useMemo(
      () =>
        new Proxy(model, {
          get(target, prop) {
            if (typeof prop !== "symbol" && !actuallyObservedProps[prop]) {
              croquetContext.view.subscribeToPropertyChange(
                model,
                prop.toString(),
                onChange,
                { handling: "oncePerFrame" }
              );
              actuallyObservedProps[prop] = true;
            }
            return (target as any)[prop];
          }
        }),
      [model, croquetContext.view]
    );
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
      [publishCallback, croquetContext.view, ...deps]
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
      return () => {
        oneUseView.unsubscribe(scope, eventSpec);
        oneUseView.detach();
      }
    }, [scope, eventSpec, callback, croquetContext.view, ...deps]);
  }

  class CroquetReactView extends Observing(View) {
    model: Model;

    constructor(model: Model) {
      super(model);
      this.model = model;
    }
  }

  type ClassOf<M> = new (...args: any[]) => M

  /** Main wrapper component that starts and manages a croquet session, enabling child elements to use the
   * {@link usePublish}, {@link useSubscribe}, {@link useObservable}, {@link useViewId} and {@link useModelRoot} hooks.
   *
   * Takes the same parameters as {@link startSession} except that it doesn't need a root View class,
   * since croquet-react provides a suitable View class behind the scenes.
   *
   * ```
   * function MyApp() {
   *    return (
   *      <InCroquetSession
   *        name="myApp"
   *        modelRoot={MyRootModel}
   *      >
   *        // child elements that use hooks go here...
   *      </InCroquetSession>
   *    );
   * }
   * ```
   */
  export function InCroquetSession<M extends Model>(params: {
    name: string;
    modelRoot: ClassOf<M>;
    options?: CroquetSessionOptions;
    children: React.ReactNode;
  }) {
    const {
        name,
        modelRoot,
        options,
        children
    } = params;

    const [croquetContext, setCroquetContext] = useState<
      CroquetSession<CroquetReactView> | undefined
    >(undefined);
    useEffect(() => {
      const optionsWithDefaults: CroquetSessionOptions = {
        step: "auto",
        ...(options || {})
      };
      startSession(name, modelRoot, CroquetReactView, optionsWithDefaults).then(
        context => setCroquetContext(context)
      );
    }, [name, modelRoot, options]);

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
