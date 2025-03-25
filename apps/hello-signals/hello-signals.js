// Hello World With Signals
//
// Croquet Labs, 2025
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

import { SignalModel, SignalView } from "./croquet-signal.js";


class MyModel extends SignalModel {

    init() {
        super.init();
        // use a signal to store the counter value
        this.counter = this.createSignal(0);
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


class MyView extends SignalView {

    constructor(model) {
        super(model);

        document.onclick = () => this.publish(model.id, "click");

        // we will read the signal value in the effects below
        const counter = model.counter;

        // by invoking the signal's value getter in an effect, we automatically
        // create a dependency between the signal and the effect,
        // causing the effect to be re-executed whenever the signal value changes
        this.signalEffect(() => {
            console.log("Counter changed to", counter.value);
            document.getElementById("counter").innerHTML = counter.value;
        });

        // we can also derive a signal from other signals
        // this one's value will only be true when the counter is a multiple of 5
        const isFifth = this.computeSignal(() => counter.value % 5 === 0);

        // Note that this effect will only run when isFifth changes,
        // not whenever counter changes (as confirmed by the console.log)
        this.signalEffect(() => {
            console.log("Multiple of 5 changed to", isFifth.value);
            document.getElementById("counter").style.color = isFifth.value ? "red" : "black";
        });

        // we can also remove effects by calling the function returned by signalEffect()
        // this one will output 5 counter values and then stop
        let output = 0;
        const unwatch = this.signalEffect(() => {
            console.log(`Output #${++output}`, counter.value);
            if (output >= 5) {
                unwatch();
                console.log("Output stopped");
            }
        });
    }

}


Croquet.Session.join({
    apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
    appId: "io.croquet.hello-signals",
    model: MyModel,
    view: MyView,
});
