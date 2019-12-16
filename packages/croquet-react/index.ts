import {useState, useEffect, createContext, createElement, useContext, useMemo, useCallback, ReactNode} from 'react';
import {View, startSession, CroquetSession, Model, CroquetSessionOptions} from '@croquet/croquet';
import {Observing, ObservableModel} from '@croquet/observable';

const CroquetContext = createContext<CroquetSession<CroquetReactView> | undefined>(undefined);

export function useObservable<M extends ObservableModel>(model: M): M {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw(new Error("No Croquet Context provided!"));
    const [_, forceUpdate] = useState();

    const onChange = () => {
        forceUpdate({});
    };

    const actuallyObservedProps: {[prop: string]: true | undefined, [prop: number]: true | undefined} = {};

    useEffect(() => {
        // cleanup
        return () => {
            for (const prop of Object.keys(actuallyObservedProps)) {
                croquetContext.view.unsubscribeFromPropertyChange(model, prop);
                delete actuallyObservedProps[prop];
            }
        };
    }, [model]);

    return useMemo(() => new Proxy(model, {
        get(target, prop) {
            if (typeof prop !== 'symbol' && !actuallyObservedProps[prop]) {
                croquetContext.view.subscribeToPropertyChange(
                    model, prop.toString(), onChange, {handling: "oncePerFrame"}
                );
                actuallyObservedProps[prop] = true;
            }
            return (target as any)[prop];
        }
    }), [model]);
}

export function useViewId() {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw(new Error("No Croquet Context provided!"));
    return croquetContext.view.viewId;
}

export function useModelRoot() {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw(new Error("No Croquet Context provided!"));
    return croquetContext.view.model;
}

export function usePublish(publishCallback: (...args: any[]) => [string, string] | [string, string, any], deps: any[]) {
    const croquetContext = useContext(CroquetContext);
    if (!croquetContext) throw(new Error("No Croquet Context provided!"));
    return useCallback((...args) => {
        const result = publishCallback(...args);
        if (result && result.length >= 2) {
            const [scope, event, data] = result;
            croquetContext.view.publish(scope, event, data);
        }
    }, deps);
}

class CroquetReactView extends Observing(View) {
    model: Model;

    constructor(model: Model) {
        super(model);
        this.model = model;
    }
}

export function InCroquetSession<M extends Model>({name, modelRoot, options, children} : {name: string, modelRoot: new (...args: any[]) => M, options?: CroquetSessionOptions, children: ReactNode[]}) {
    const [croquetContext, setCroquetContext] = useState<CroquetSession<CroquetReactView> | undefined>(undefined);
    useEffect(() => {
        const optionsWithDefaults: CroquetSessionOptions = {step: "auto", ...(options || {})};
        startSession(name, modelRoot, CroquetReactView, optionsWithDefaults).then(context => setCroquetContext(context));
    }, [name, modelRoot, options]);

    if (croquetContext) {
        return createElement(CroquetContext.Provider, {value: croquetContext}, children)
    } else {
        return createElement("div");
    }
}
