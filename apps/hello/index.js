// Hello World Example
//
// Croquet Studios, 2019
//
// This is an example of a simple Teatime applicaton. It creates a counter that increments
// every time you click on it. The counter is replicated across the network and will record clicks
// from any client connected to the same session. The state of the model is automatically saved
// to the cloud.

import { Controller, startSession, Model, View } from "@croquet/teatime";

// Open a connection to a Teatime reflector.

Controller.connectToReflector(module.id);

// Create a global variable to hold the session information. It's initially null because
// we haven't joined a session yet.

let session = null;

// Set up an event listener to receive mouse clicks from the window. If we're in a session, it
// tells the view to broadcast that we clicked.

document.addEventListener('click', OnClick, false);

function OnClick(event) {
    if (session) session.view.sendClick();
}

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
// Define our view. MyView listens for update events from the model. It it receives one, it
// updates the counter on the screen with the current count.
//------------------------------------------------------------------------------------------

export class MyView extends View {
    constructor(model) {
        super(model);
        this.handleUpdate(model.counter); // Get the current count on start up.
        this.subscribe("simulation", "update", data => this.handleUpdate(data));
    }

    sendClick() {
        this.publish("input", "click");
    }

    handleUpdate(data) {
        document.getElementById("counter").innerHTML = data;
    }

}

//------------------------------------------------------------------------------------------
// Define our main loop. First we join the TeaTime session, which spawns our model and our
// view. Then we step the session forward every time the window updates. When the
// the session steps forward, it executes all pending events in both the model and the
// the view.
//------------------------------------------------------------------------------------------

async function go() {

    //-- Start session --

    session = await startSession("hello", MyModel, MyView);

    // -- Main loop --

    window.requestAnimationFrame(frame);
    function frame(now) {
        session.step(now);
        window.requestAnimationFrame(frame);
    }
}

go();
