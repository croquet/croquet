// Hello World With Signals
//
// Croquet Labs, 2024
//
// This is an example of a simple Teatime applicaton. It creates a counter that counts up once
// per second. Clicking on it resets it to zero. The counter is replicated across the network and
// will respond to clicks from any user in the same session. The current value of the
// counter is automatically saved to the cloud.
//
// The difference between this example and the hello-world example is that this one uses signals
// to communicate between the model and the view, rather than publishing and subscribing to events.

// silence eslint – we've loaded Croquet as script in the HTML
/* global Croquet */

import { SignalModel, Affect, Effect, Derive }  from "./croquet-signal.js";


class MyModel extends SignalModel {

    init() {
        super.init();
        this.counter = this.createSignal(0);
        this.tick();
    }

    tick() {
        this.counter.value++;
        this.future(1000).tick();
    }

}
MyModel.register("MyModel");


class MyView extends Croquet.View {

    constructor(model) {
        super(model);
        const counter = model.counter;

        document.onclick = () => Affect(() => counter.value = 0);

        Effect(() => {
            document.getElementById("counter").innerHTML = counter.value;
        });

        const isFifth = Derive(() => counter.value % 5 === 0);

        Effect(() => {
            console.log("Multiple of 5 changed to", isFifth.value);
            document.getElementById("counter").style.color = isFifth.value ? "red" : "black";
        });
    }
}


Croquet.Session.join({
    apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
    appId: "io.croquet.hello-signals",
    model: MyModel,
    view: MyView,
});
