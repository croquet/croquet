// Hello World Static Props Test
//
// Croquet Labs, 2025
//
// This is an example of a simple Teatime applicaton. It uses various static properties to
// excercise the snapshotting of these static properties in Croquet.
// Each click increments the static counters in four different ways. Their initial values are
// 1, 2, 3, and 4.
// After triggering a snapshot and reloading the page, the counters should be restored to their
// previous values rather than being reset to their initial values.

// silence eslint – we've loaded Croquet as script in the HTML
/* global Croquet */


// a non-model class with a static property. Its instance is used in MyModel.
class StaticResetCounter {
    static count = 1;       // snapshotted via MyModels.types
    increment() { StaticResetCounter.count++; }
    getCount() { return StaticResetCounter.count; }
}

// a global variable, used in MyModel
let globalResetCount = 2; // also explicitly snapshotted via MyModels.types writeStatic()

class MyModel extends Croquet.Model {
    static resetCount = 3;  // static property of a Model class, snapshotted automatically

    static {
        this.reset = { count: 4 }; // another static property, snapshotted automatically
    }

    static incResetCount() {
        this.reset.count++;
    }

    static types() {
        return {
            "StaticResetCounter": {
                cls: StaticResetCounter,
                write: () => 0, // no state to write
                read: () => new StaticResetCounter(),
                writeStatic: () => ({ count: StaticResetCounter.count }),
                readStatic: (state) => { StaticResetCounter.count = state.count; }
            },
            "Global": { // not even a class, just functions to read/write global variables
                writeStatic: () => ({ globalResetCount }),
                readStatic: (state) => { globalResetCount = state.globalResetCount; }
            }
        };
    }

    init() {
        this.counter = 0;
        this.resets = new StaticResetCounter();
        this.subscribe("counter", "reset", this.resetCounter);
        this.future(1000).tick();
    }

    resetCounter() {
        this.counter = 0;
        this.publish("counter", "update", this.counter);
        // five different ways to count resets statically
        MyModel.resetCount++;
        MyModel.incResetCount();
        this.resets.increment();
        globalResetCount++;
    }

    tick() {
        this.counter++;
        this.publish("counter", "update", this.counter);
        this.future(1000).tick();
    }

}
MyModel.register("MyModel");

class MyView extends Croquet.View {

    constructor(model) {
        super(model);
        this.model = model;
        this.handleUpdate();
        this.clickHandler = event => this.onclick(event);
        document.addEventListener("click", this.clickHandler, false);
        this.subscribe("counter", "update", data => this.handleUpdate(data));
    }

    onclick() {
        this.publish("counter", "reset");
    }

    handleUpdate() {
        const counter = this.model.counter;
        const resets = [
            this.model.resets.getCount(), // StaticResetCounter.count
            globalResetCount,
            MyModel.resetCount,
            MyModel.reset.count,
        ];
        document.getElementById("counter").innerHTML =
            `Counter: ${counter} (static: ${resets.join(", ")})`;
    }

    detach() {
        super.detach();
        document.removeEventListener("click", this.clickHandler);
    }
}

Croquet.Session.join({
    apiKey: "234567_Paste_Your_Own_API_Key_Here_7654321",
    appId: "io.croquet.hello",
    model: MyModel,
    view: MyView,
});

// // Joining a second session should print warnings about the static properties
// Croquet.Session.join({
//     apiKey: "234567_Paste_Your_Own_API_Key_Here_7654321",
//     appId: "io.croquet.hello",
//     name: "foo",
//     password: "bar",
//     model: MyModel,
//     view: MyView,
// });
