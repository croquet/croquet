// Hello World Node Example
//
// Croquet Corporation, 2022
//
// This is an example of a simple Teatime applicaton. It creates a counter that counts up once
// per second. The model is exactly the same as the HTML Hello World example, so they can join
// the same session.

const Croquet = require("@croquet/croquet");

//------------------------------------------------------------------------------------------
// Define our model. MyModel has a tick method that executes once per second. It updates the value
// of a counter and publishes the value with an event. It also listens for reset events from the view.
// If it receives one, it resets its counter and broadcasts the change.
//------------------------------------------------------------------------------------------

class MyModel extends Croquet.Model {

    init() { // Note that models are initialized with "init" instead of "constructor"!
        this.counter = 0;
        this.subscribe("counter", "reset", this.resetCounter);
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
MyModel.register("MyModel");

//------------------------------------------------------------------------------------------
// Define our view. MyView listens for update events from the model. If it receives
// one, it logs the current count.
// TODO: Add a way to reset the counter via node client (maybe read console keyboard input?)
//------------------------------------------------------------------------------------------

class MyView extends Croquet.View {

    constructor(model) { // The view gets a reference to the model when the session starts.
        super(model);
        this.handleUpdate(model.counter); // Get the current count on start up.
        this.subscribe("counter", "update", data => this.handleUpdate(data));
    }

    reset() {
        this.publish("counter", "reset");
    }

    handleUpdate(data) {
        console.log(data);
    }

}

//------------------------------------------------------------------------------------------
// Join the Teatime session and spawn our model and view.
//------------------------------------------------------------------------------------------

if (process.argv.length < 4) {
    console.log("Usage: node hello_node.js <session-name> <session-password>");
    process.exit(1);
}

Croquet.Session.join({
    apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
    appId: "io.croquet.hello",
    name: process.argv[2],
    password: process.argv[3],
    model: MyModel,
    view: MyView,
    step: "manual",
}).then(session => {
    setInterval(() => session.step(), 100);
});
