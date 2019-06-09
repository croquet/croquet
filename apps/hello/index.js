// Hello World Example
//
// Croquet Studios, 2019
//
// This is an example of a simple Teatime applicaton. It creates a counter that increments
// every time you click on it. The counter is replicated across the network and will record clicks
// from any client connected to the same session. The state of the model is automatically saved
// to the cloud.

import { Model, View, Controller, startSession } from "@croquet/teatime";

//------------------------------------------------------------------------------------------
// Define our model. MyModel listens for click events from the view. If it receives one, it
// increments its internal counter and broadcasts the current value.
//------------------------------------------------------------------------------------------

export class MyModel extends Model {

    init() { // Note that models are initialzed with "init" instead of "constructor"!
        super.init();
        this.counter = 0;
        this.subscribe("input", "click", () => this.handleClick());
    }

    handleClick() {
        this.counter++;
        this.publish("simulation", "update", this.counter);
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
        document.addEventListener('click', evt => this.sendClick(evt), false);
        this.subscribe("simulation", "update", data => this.handleUpdate(data));
    }

    sendClick() {
        this.publish("input", "click");
    }

    handleUpdate(data) {
        document.getElementById("counter").innerHTML = data;
    }

}


// Open a connection to a Teatime reflector.

Controller.connectToReflector(module.id);


//------------------------------------------------------------------------------------------
// Join the Teatime session, which spawns our model and our view.
// We enable automatic stepping (which creates a mainloop using window.requestAnimationFrame).
// When the session steps forward, it executes all pending events in both the model and the
// the view.
//------------------------------------------------------------------------------------------

startSession("hello", MyModel, MyView, {step: "auto"});
