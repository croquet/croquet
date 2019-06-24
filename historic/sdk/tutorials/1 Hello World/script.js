// Croquet Tutorial 1
// Hello World
// Croquet Studios, 2019

class MyModel extends Croquet.Model {

    init(options) {
        super.init(options);
        this.count = 0;
        this.subscribe("counter", "reset", () => this.resetCounter());
        this.future(1000).tick();
    }

    resetCounter() {
        this.count = 0;
        this.publish("counter", "update", this.count);
    }

    tick() {
        this.count++;
        this.publish("counter", "update", this.count);
        this.future(1000).tick();
    }

}

MyModel.register();

class MyView extends Croquet.View {

    constructor(model) {
        super(model);
        document.addEventListener("click", event => this.onclick(event), false);
        this.subscribe("counter", "update", data => this.handleUpdate(data));
    }

    onclick(event) {
      if (event.target !== document.getElementById("qr"))
        this.publish("counter", "reset");
    }

    handleUpdate(data) {
        document.getElementById("countDisplay").textContent = data;
    }

}

// use fixed session name instead of random so multiple codepen windows find each other
const session = { user: 'GUEST', random: '1234567' };
Croquet.startSession("hello", MyModel, MyView, {step: "auto", session});

// Note: the QR code points to our original pen. After forking,
// change the url in the HTML tab to point to your pen so you can easily
// join your own session on a mobile device
