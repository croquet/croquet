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

import { Signal, Effect, Derive } from "./croquet-signal.js";


class MyModel extends Croquet.Model {

    init() {
        super.init();
        // use a signal to store the counter value
        this.counter = new Signal(0);
        this.subscribe(this.id, "click", this.onClick);
        this.tick();
    }

    onClick() {
        this.counter.value = 0;
        // restart the tick so we show full seconds since the last click
        this.cancelFuture(this.tick);
        this.future(1000).tick();
    }

    tick() {
        // the signal's setter will automatically trigger
        // any effects that depend on it
        this.counter.value++;
        this.future(1000).tick();
    }

}
MyModel.register("MyModel");


class MyView extends Croquet.View {

    constructor(model) {
        super(model);

        document.onclick = () => this.publish(model.id, "click");

        // we will read the signal value in effects
        const counter = model.counter;

        // by invoking the signal's value getter in an effect, we automatically
        // create a dependency between the signal and the effect,
        // causing the effect to be re-run whenever the signal value changes
        Effect(() => {
            console.log("Counter changed to", counter.value);
            document.getElementById("counter").innerHTML = counter.value;
        });

        // we can also derive a signal from other signals
        // this one's value will only change when the counter is a multiple of 5
        const isFifth = Derive(() => counter.value % 5 === 0);

        // and use that derived signal in an effect
        // Note thst this effect will only run when isFifth changes,
        // not whenever counter changes (as confirmed by the console.log)
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
