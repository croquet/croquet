// Croquet Tutorial 1
// Hello World
// Croquet Labs, 2019

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

MyModel.register("MyModel");

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

Croquet.Session.join("hello", MyModel, MyView);
