// Hello World Example
//
// Croquet Studios, 2019
//
// This is an example of a simple Teatime applicaton. It creates a counter that increments
// every time you click on it. The counter is replicated across the network and will record clicks
// from any client connected to the same session. The state of the model is automatically saved
// to the cloud.

import { Model, View, startSession } from "@croquet/teatime";

//------------------------------------------------------------------------------------------
// Define our model. MyModel listens for click events from the view. If it receives one, it
// increments its internal counter and broadcasts the current value.
//------------------------------------------------------------------------------------------

export class MyModel extends Model {

    init() { // Note that models are initialized with "init" instead of "constructor"!
        super.init();
        this.counter = 0;
        this.subscribe("counter", "increment", () => this.incrementCounter());
    }

    incrementCounter() {
        this.counter++;
        this.publish("counter", "update", this.counter);
    }

}

//------------------------------------------------------------------------------------------
// Define our view. MyView listens for update events from the model. If it receives one, it
// updates the counter on the screen with the current count.
//------------------------------------------------------------------------------------------

export class MyView extends View {

    constructor(model) {
        super(model);
        this.handleUpdate(model.counter); // Get the current count on start up.
        document.addEventListener("click", evt => this.onclick(evt), false);
        this.subscribe("counter", "update", data => this.handleUpdate(data));
    }

    onclick() {
        this.publish("counter", "increment");
    }

    handleUpdate(data) {
        document.getElementById("counter").innerHTML = data;
    }

}

//------------------------------------------------------------------------------------------
// Join the Teatime session, which spawns our model and our view.
// We enable automatic stepping (which creates a mainloop using window.requestAnimationFrame).
// When the session steps forward, it executes all pending events in both the model and the
// the view.
//------------------------------------------------------------------------------------------

startSession("hello", MyModel, MyView, {step: "auto"});
