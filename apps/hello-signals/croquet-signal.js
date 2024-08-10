// Signals for Croquet
//
// USAGE
//     import { SignalModel, Affect, Effect, Derive }  from "./croquet-signal.js";
//
//     * derive
// Author: Vanessa Freudenberg

// silence eslint – we've loaded Croquet as script in the HTML
/* global Croquet */

let currentEffect = null;
let currentAffect = null;

// use a class for the Signal so we can have a custom serializer for it
class Signal {

    constructor(value, id) {
        this.id = id;
        this._value = value;
        this.viewEffects = new Set();
    }

    set value(value) {
        if (!Croquet.Model.isExecuting()) {
            // we are not in model code, so we need to send the value to the model
            if (!currentAffect) throw new Error("Cannot set signal value from outside an Affect");
            currentAffect.publish("__signal", "set", [this.id, value]);
            return;
        }
        if (Object.is(value, this._value)) return;
        this._value = value;
        // execute effects outside of the model
        Promise.resolve().then(() => this.viewEffects.forEach(fn => fn(value)));
    }

    setDerivedValue(value) {
        // only called from within an effect, outside of the model
        if (Object.is(value, this._value)) return;
        this._value = value;
        this.viewEffects.forEach(fn => fn(value));
    }

    get value() {
        if (currentEffect) this.viewEffects.add(currentEffect);
        return this._value;
    }
}

// hash all source code that might be executed in the model into session ID
Croquet.Constants.__Signal = Signal;

function Effect(fn) {
    if (Croquet.Model.isExecuting()) throw new Error("Effects cannot be used in model code yet");
    if (currentEffect) throw new Error("Cannot nest effects");
    currentEffect = fn;
    fn();
    currentEffect = null;
}

function Derive(fn) {
    const computed = new Signal();
    Effect(() => computed.setDerivedValue(fn()));
    return computed;
}

function Affect(fn) {
    if (Croquet.Model.isExecuting()) throw new Error("Affects can only be used outside model code");
    if (currentAffect) throw new Error("Cannot nest affects");
    currentAffect = {
        publish(scope, event, value) {
            // okay this is a bit of a hack, but it works
            CROQUETVM.handleViewEventInModel(`${scope}:${event}`, value);
            // if we wanted to do it properly, we would need to pass in
            // a view instance to publish, which may be inconvenient
        }
    };
    fn();
    currentAffect = null;
}

class SignalModel extends Croquet.Model {

    static signals;

    init() {
        // keep track of all created signals to be able to set their values
        // from the view via the __signal event
        if (!SignalModel.signals) {
            SignalModel.signals = [];
            this.subscribe("__signal", "set", this._setSignalValue);
        }
    }

    createSignal(value) {
        const id = SignalModel.signals.length;
        const signal = new Signal(value, id);
        SignalModel.signals[id] = signal;
        return signal;
    }

    _setSignalValue([id, value]) {
        SignalModel.signals[id].value = value;
    }

    static types() {
        return {
            "Croquet.Signal": {
                cls: Signal,
                write: signal => [signal._value, signal.id],
                read: ([value, id]) => new Signal(value, id)
            }
        };
    }
}
SignalModel.register("Croquet:SignalModel");

export { SignalModel, Effect, Derive, Affect };
