import {useState, useEffect, createContext, createElement, useContext, useMemo, useCallback} from 'react';
import {View, startSession} from 'croquet';

const CroquetContext = createContext();

/**
 * @param {M} model
 * @returns {M}
 * @template M
 */
export function useObservable(model) {
    const croquetContext = useContext(CroquetContext);
    const [_, forceUpdate] = useState();

    const onChange = () => {
        forceUpdate({});
    };

    const actuallyObservedProps = {};

    useEffect(() => {
        // cleanup
        return () => {
            for (const prop of actuallyObservedProps) {
                croquetContext.view.unsubscribeFromPropertyChange(model, prop);
            }
        };
    }, [model]);

    return useMemo(() => new Proxy(model, {
        get(target, prop) {
            if (!actuallyObservedProps[prop]) {
                croquetContext.view.subscribeToPropertyChange(
                    model, prop, onChange, {handling: "oncePerFrame"}
                );
                actuallyObservedProps[prop] = true;
            }
            return target[prop];
        }
    }), [model]);
}

export function useUser() {
    const croquetContext = useContext(CroquetContext);
    return croquetContext.view.user;
}

export function useModelRoot() {
    const croquetContext = useContext(CroquetContext);
    return croquetContext.view.model;
}

export function usePublish(publishCallback, deps) {
    const croquetRootView = useContext(CroquetContext).view;
    return useCallback(() => publishCallback(croquetRootView.publish.bind(croquetRootView), croquetRootView.id), deps);
}

class ReactView extends View {
    constructor(model) {
        super(model);
        this.model = model;
    }
}

export function InCroquetSession({name, modelRoot, options, children}) {
    const [croquetContext, setCroquetContext] = useState(null);
    useEffect(() => {
        const optionsWithDefaults = {step: "auto", ...(options || {})};
        startSession(name, modelRoot, ReactView, optionsWithDefaults).then(context => setCroquetContext(context));
    }, [name, modelRoot, options]);

    return croquetContext
        ? createElement(CroquetContext.Provider, {value: croquetContext}, children)
        : createElement("div");
}
