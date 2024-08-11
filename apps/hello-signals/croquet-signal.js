// Signals for Croquet
//
// Author: Vanessa Freudenberg
//
// USAGE
//     import { Signal, Effect, Derive }  from "./croquet-signal.js";
//
// In your model code, create a signal like this:
//     this.counter = new Signal(0);
// and use it like this:
//     this.doSomething(this.counter.value); // read
//     this.counter.value = 42;              // write
//     this.counter.value++;                 // read+write
//
// In your view code, use the signal in an effect like this:
//     Effect(() => { document.getElementById("counter").innerHTML = this.counter.value; });
// which will automatically re-run the effect whenever the signal value changes.
// You can also derive a signal from other signals like this:
//     const isFifth = Derive(() => this.counter.value % 5 === 0);
// and use that in an effect like this:
//     Effect(() => { document.getElementById("counter").style.color = isFifth.value ? "red" : "black"; });
//
// Signals can only be modified in model code, and Effects/Derive can only be used in view code.

// silence eslint – we've loaded Croquet as script in the HTML
/* global Croquet */

let currentEffect = null;

// use a class for the Signal so we can have a custom serializer for it
class Signal {

    constructor(value) {
        this._value = value;          // the signal value, serialized
        this.dependents = new Set(); // only used in view code, not serialized
    }

    set value(value) {
        // protect against accidentally setting signal value from outside the model
        if (!Croquet.Model.isExecuting()) throw new Error("Cannot set signal value from outside the model");
        // ignore if value is the same
        if (Object.is(value, this._value)) return;
        this._value = value;
        // execute effects outside of the model
        queueMicrotask(() => this.dependents.forEach(fn => fn(value)));
    }

    get value() {
        // used in both model and view code
        // if called from within an effect, add the effect to the list of effects to be executed
        if (currentEffect) this.dependents.add(currentEffect);
        return this._value;
    }
}

// hash all source code that might be executed in the model into session ID
Croquet.Constants.__Signal = Signal;

// separate class for for setting value from outside the model
class DerivedSignal extends Signal {

    set value(value) {
        if (Croquet.Model.isExecuting()) throw new Error("Cannot set derived signal value from within the model");
        if (Object.is(value, this._value)) return;
        this._value = value;
        // we're in view code, so execute effects immediately
        this.dependents.forEach(fn => fn(value));
    }

    get value() {
        // same as super.get but need to implement because we override set
        if (currentEffect) this.dependents.add(currentEffect);
        return this._value;
    }
}

function Effect(fn) {
    if (Croquet.Model.isExecuting()) throw new Error("Effects cannot be used in model code");
    if (currentEffect) throw new Error("Cannot nest effects");
    // all signals this effect depends on (by reading a signal's value)
    // will add this effect to their list of dependents
    currentEffect = fn;
    fn();
    currentEffect = null;
}

function Derive(fn) {
    // use view-side signal because we know we are in view code
    const derived = new DerivedSignal();
    // add this derived signal to the list of dependents of all signals it reads
    Effect(() => derived.value = fn());
    return derived;
}

// This class only exists to provide a serializer for Signals
class SignalModel extends Croquet.Model {
    static types() {
        return {
            "Croquet.Signal": {
                cls: Signal,
                write: signal => signal._value,
                read: value => new Signal(value),
            }
        };
    }
}
SignalModel.register("Croquet:SignalModel");

export { Signal, Effect, Derive };
