// Hello World Example
//
// Croquet Studios, 2019
//
// This is an example of a simple Teatime applicaton. It creates a counter that counts up once
// per second. Clicking on it resets it to zero. The counter is replicated across the network and
// will respond to clicks from any client connected to the same session. The current value of the
// counter is automatically saved to the cloud.

import { Model, View, startSession } from "@croquet/teatime";
//import { Model, View, startSession } from "../sdk/dist/croquet.min.js";

//------------------------------------------------------------------------------------------
// Define our model. MyModel has a tick method that executes once per second. It updates the value
// of a counter and publishes the value with an event. It also listens for reset events from the view.
// If it receives one, it resets its counter and broadcasts the change.
//------------------------------------------------------------------------------------------

class MyModel extends Model {

    init() { // Note that models are initialized with "init" instead of "constructor"!
        this.counter = 0;
        this.subscribe("counter", "reset", () => this.resetCounter());
        this.future(1000).tick();
    }

    resetCounter() {
        this.counter = 0;
        this.publish("counter", "update", this.counter);
    }

    tick() {
        this.counter++;
        this.publish("counter", "update", this.counter);
        this.future(1000).tick();
    }

}

// Register our model class with the serializer
//MyModel.register();

//------------------------------------------------------------------------------------------
// Define our view. MyView listens for click events on the window. If it receives one, it
// broadcasts a reset event. It also listens for update events from the model. If it receives
// one, it updates the counter on the screen with the current count.
//------------------------------------------------------------------------------------------

class MyView extends View {

    constructor(model) { // The view gets a reference to the model when the session starts.
        super(model);
        this.handleUpdate(model.counter); // Get the current count on start up.
        document.addEventListener("click", event => this.onclick(event), false);
        this.subscribe("counter", "update", data => this.handleUpdate(data));
    }

    onclick() {
        this.publish("counter", "reset");
    }

    handleUpdate(data) {
        document.getElementById("counter").innerHTML = data;
    }

}

//------------------------------------------------------------------------------------------
// Join the Teatime session and spawn our model and view. We also enable automatic
// stepping. Each time the window draws an animation frame, the session steps forward
// and executes all pending events in both the model and the view.
//------------------------------------------------------------------------------------------

startSession("hello", MyModel, MyView, {step: "auto"});
