// Signals for Croquet
//
// Author: Vanessa Freudenberg
//
// USAGE
//
// import Signal from "./croquet-signal.js";
//
// In your model code, create a signal like this:
//     this.counter = new Signal.State(0);
// and use it like this:
//     this.doSomething(this.counter.value); // read
//     this.counter.value = 42;              // write
//     this.counter.value++;                 // read+write
//
// In your view code, use the signal in an effect like this:
//     Signal.effect(() => { document.getElementById("counter").innerHTML = this.counter.value; });
// which will automatically re-run the effect whenever the signal value changes.
// You can also derive a computed signal from other signals like this:
//     const isFifth = new Signal.Computed(() => this.counter.value % 5 === 0);
// and use that in an effect like this:
//     Signal.effect(() => { document.getElementById("counter").style.color = isFifth.value ? "red" : "black"; });
// The effect will only run when the derived value isFifth changes, not whenever counter changes.
//
// Signals can only be modified in model code, and Effects/Computed can only be used in view code.
//
// CAVEATS
//
// At the moment there is no way to remove an effect from a signal's dependents list.
// This means it's unsuitable for dynamic UIs where components are added and removed.

// silence eslint – we've loaded Croquet as script in the HTML
/* global Croquet */

let currentEffect = null;

// use a class for the Signal so we can have a custom serializer for it
// only used in model code
class SignalState {

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
Croquet.Constants.__Signal = SignalState;

// wrapper for view code that depends on signals
// it will register the effect with all signals it reads
function effect(fn) {
    if (Croquet.Model.isExecuting()) throw new Error("Effects cannot be used in model code");
    if (currentEffect) throw new Error("Cannot nest effects");
    // all signals this effect depends on (by reading a signal's value)
    // will add this effect to their list of dependents
    currentEffect = fn;
    fn();
    currentEffect = null;
}

// separate class for derived signals, only used in view code
class SignalComputed {

    constructor(fn) {
        this._value = undefined;     // last computed result
        this.dependents = new Set();

        // use an effect to add this derived signal as a
        // dependent of all signals fn() reads
        effect(() => this.value = fn());
    }

    set value(value) {
        if (Object.is(value, this._value)) return;
        this._value = value;
        // we're in view code, execute effects immediately
        this.dependents.forEach(fn => fn(value));
    }

    get value() {
        if (currentEffect) this.dependents.add(currentEffect);
        return this._value;
    }
}

// Public API
const Signal = {
    State: SignalState,
    Computed: SignalComputed,
    effect,
};

// This class only exists to provide a serializer for Signals
class CroquetSignals extends Croquet.Model {
    static types() {
        return {
            "Croquet:Signal": {
                cls: Signal.State,
                write: signal => signal._value,
                read: value => new Signal.State(value),
            }
        };
    }
}
CroquetSignals.register("Croquet:Signals");

export default Signal;
