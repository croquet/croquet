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
// If you need to remove an effect, call the function returned by Signal.effect:
//     const unwatch = Signal.effect(() => { ... });
// and later:
//     unwatch();
// Computed signals will automatically unwatch their dependencies when they have no watchers left.
//
// NOTE: Signals can only be modified in model code, and Effects/Computed can only be used in view code.

// silence eslint – we've loaded Croquet as script in the HTML
/* global Croquet */

// these globals are used to automatically detect dependencies between signals and effects
let currentWatcher = null;  // the effect currently being executed
let currentWatched = null;  // the signals the current effect reads

class Watchable {
    constructor() {
        this.watchers = new Set();
    }

    addWatcher() {
        this.watchers.add(currentWatcher);
        currentWatched.add(this);
    }

    removeWatcher(fn) {
        this.watchers.delete(fn);
    }

    executeWatchers(value) {
        this.watchers.forEach(fn => fn(value));
    }
}

// use a class for the Signal so we can have a custom serializer for it
// only used in model code
class SignalState extends Watchable {

    constructor(value) {
        super();
        this._value = value;          // the signal value, serialized
        // the watchers are only used by view code and are not serialized
    }

    set value(value) {
        // protect against accidentally setting signal value from outside the model
        if (!Croquet.Model.isExecuting()) throw new Error("Cannot set signal value from outside the model");
        // ignore if value is the same
        if (Object.is(value, this._value)) return;
        this._value = value;
        // execute effects outside of the model
        queueMicrotask(() => this.executeWatchers(value));
    }

    get value() {
        // used in both model and view code
        // if called from within an effect, add the effect to the list of effects to be executed
        if (currentWatcher) this.addWatcher();
        return this._value;
    }

    removeWatcher(fn) {
        this.watchers.delete(fn);
    }
}

// hash all source code that might be executed in the model into session ID
Croquet.Constants.__Signal = SignalState;

// An effect is a wrapper for view code that depends on signals.
// It will register the effect as a watcher of all signals being read by the effect.
// Returns a function that can be called to remove the effect
// from the watch list of all signals it depends on.
function effect(fn) {
    if (Croquet.Model.isExecuting()) throw new Error("Effects cannot be used in model code");
    if (currentWatcher) throw new Error("Cannot nest effects");
    // all signals this effect depends on (by reading a signal's value)
    // will add this effect to their list of dependents
    // and themselves to the list of signals this effect depends on
    const watched = new Set();
    currentWatched = watched;
    currentWatcher = fn;
    fn();
    currentWatcher = null;
    currentWatched = null;
    // return a function that can be called to unwatch this effect
    return () => watched.forEach(signal => signal.removeWatcher(fn));
}

// A computed signal uses an effect to watch its own dependencies.
// Only used in view code
class SignalComputed extends Watchable {

    constructor(fn) {
        super();
        this._value = undefined;     // last computed result

        // use an effect to add this derived signal as a
        // dependent of all signals fn() reads
        this.unwatch = effect(() => this.value = fn());
    }

    set value(value) {
        // this should only ever be called from our own effect above
        if (Object.is(value, this._value)) return;
        this._value = value;
        // we're in view code, execute effects immediately
        this.executeWatchers(value);
    }

    get value() {
        if (currentWatcher) this.addWatcher();
        return this._value;
    }

    removeWatcher(fn) {
        super.removeWatcher(fn);
        if (this.watchers.size === 0) {
            this.unwatch();
        }
    }
}

// Public API
const Signal = {
    State: SignalState,
    Computed: SignalComputed,
    effect,
};

// Register a serializer for Signals
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
