import { Model, View, Session } from '@croquet/croquet'

class Counter extends Model {

  counter = 0

  init() {
      this.counter = 0;
      this.subscribe("counter", "reset", this.resetCounter);
      this.future(1000).tick();
  }

  resetCounter() {
      this.counter = 0;
      this.publish("counter", "update");
  }

  tick() {
      this.counter++;
      this.publish("counter", "update");
      this.future(1000).tick();
  }

}
Counter.register("MyModel");


export function setupCounter(element: HTMLButtonElement) {

  class Button extends View {
    model: Counter;

    constructor(model: Counter) {
        super(model);
        this.model = model;
        this.subscribe("counter", "update", this.updateCounter);
        element.onclick = () => this.publish("counter", "reset");
        this.updateCounter();
    }

    updateCounter() {
        element.innerHTML = `${this.model.counter}`;
    }
  }

  Session.join({
    appId: "io.croquet.hello-typescript",
    apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
    name: location.origin + location.pathname, // one session per URL
    password: "shared",
    model: Counter,
    view: Button,
  })
}
