// Signals for Croquet
// ====================
//
// This module provides a simple way to communicate between models and views in a Croquet application.
// It uses signals to store state in the model and effects to update UI elements when the state changes,
// instead of having to publish changes from the model and subscribe to them in a view.
//
// Author: Vanessa Freudenberg, Croquet Labs, 2024
//
// USAGE
//
// import { SignalModel, SignalView } from "./croquet-signal.js";
//
// Subclass SignalModel and create a signal like this:
//     this.counter = this.createSignal(0);
// and use it like this:
//     this.doSomething(this.counter.value); // read
//     this.counter.value = 42;              // write
//     this.counter.value++;                 // read+write
//
// Subclass SignalView and use the signal in an effect like this:
//     this.signalEffect(() => { document.getElementById("counter").innerHTML = this.counter.value; });
// which will automatically re-run the effect whenever the signal value changes.
// You can also derive a computed signal from other signals like this:
//     const isFifth = this.computeSignal(() => this.counter.value % 5 === 0);
// and use that in an effect like this:
//     this.signalEffect(() => { document.getElementById("counter").style.color = isFifth.value ? "red" : "black"; });
// The effect will only run when the derived value isFifth changes, not whenever counter changes.
//
// If you need to remove an effect, call the function returned by signalEffect():
//     const unwatch = this.signalEffect(() => { ... });
// and later:
//     unwatch();
// Computed signals will automatically unwatch their dependencies when they have no watchers left.
// When the view is detached, all its effects are automatically removed, which in turn
// removes all their computed signals.
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

    executeWatchers() {
        this.watchers.forEach(fn => fn());
    }
}

// use a class for the Signal so we can have a custom serializer for it
// only used in model code
class Signal extends Watchable {

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
        queueMicrotask(() => this.executeWatchers());
    }

    get value() {
        // used in both model and view code
        // if called from within an effect, add the effect to the list of effects to be executed
        if (currentWatcher) this.addWatcher();
        return this._value;
    }

}

// hash all source code that might be executed in the model into session ID
Croquet.Constants.__Signal = Signal;

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
class Computed extends Watchable {

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
        this.executeWatchers();
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

// Register a serializer for Signals, and a method for creating them
export class SignalModel extends Croquet.Model {

    createSignal(value) {
        return new Signal(value);
    }

    static types() {
        return {
            "Croquet:Signal": {
                cls: Signal,
                write: signal => signal._value,
                read: value => new Signal(value),
            }
        };
    }
}
SignalModel.register("Croquet:Signals");

// The SignalView class provides a method for creating effects and computed signals
// It will automatically remove all effects when the view is detached
export class SignalView extends Croquet.View {

    constructor(model) {
        super(model);

        this._unwatches = new Set();
    }

    signalEffect(fn) {
        const unwatch = effect(fn);
        this._unwatches.add(unwatch);
        return unwatch;
    }

    computeSignal(fn) {
        return new Computed(fn);
    }

    detach() {
        this._unwatches.forEach(unwatch => unwatch());
        super.detach();
    }
}
