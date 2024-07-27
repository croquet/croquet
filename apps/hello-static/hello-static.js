// Hello World Static Props Test
//
// Croquet Labs, 2024
//
// This is an example of a simple Teatime applicaton. It uses various static properties to
// excercise the snapshotting of these static properties in Croquet.
// Each click increments the static counters in five different ways. Their initial values are
// 1, 2, 3, 4, and 5.
// After triggering a snapshot and reloading the page, the counters should be restored to their
// previous values rather than being reset to their initial values.

// silence eslint – we've loaded Croquet as script in the HTML
/* global Croquet */


// a non-model class with a static property. Its instance is used in MyModel.
class StaticResetCounter {
    static count = 1;       // automatically snapshotted via MyModels.types
    increment() { StaticResetCounter.count++; }
    getCount() { return StaticResetCounter.count; }
}

// a non-model class with a static property. Not instantiated, but used in MyModel.
class StaticResetCounterExplicit {
    static count = 2;      // explicitly snapshotted via MyModels.types writeStatic()
}

// a global variable, used in MyModel
let globalResetCount = 3; // also explicitly snapshotted via MyModels.types writeStatic()

class MyModel extends Croquet.Model {
    static resetCount = 4;  // static property of a Model class, snapshotted automatically

    static {
        this.reset = { count: 5 }; // another static property, snapshotted automatically
    }

    static incResetCount() {
        this.reset.count++;
    }

    static types() {
        return {
            "ResetCounter": StaticResetCounter, // snapshot all static properties of this class
            "ResetCounterExplicit": {
                cls: StaticResetCounterExplicit,
                write: () => 0, // no state to write
                read: () => new StaticResetCounterExplicit(),
                writeStatic: () => ({ count: StaticResetCounterExplicit.count }),
                readStatic: (state) => { StaticResetCounterExplicit.count = state.count; }
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
        globalResetCount++;
        this.resets.increment();
        StaticResetCounterExplicit.count++;
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
            StaticResetCounterExplicit.count,
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
    apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
    appId: "io.croquet.hello",
    name: Croquet.App.autoSession(),
    password: Croquet.App.autoPassword(),
    model: MyModel,
    view: MyView,
});

// // Joining a second session should print warnings about the static properties
// Croquet.Session.join({
//     apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
//     appId: "io.croquet.hello",
//     name: "foo",
//     password: "bar",
//     model: MyModel,
//     view: MyView,
// });
