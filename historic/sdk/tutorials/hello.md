# Hello World!


This is a hellow world test.

 <div
  class="codepen"
  data-prefill='{
    "title": "Croquet Hello World",
    "description": "Simple distributed counter",
    "tags": ["croquet"],
    "html_classes": ["loading", "no-js"],
    "head": "&lt;meta name=&#x27;viewport&#x27; content=&#x27;width=device-width, initial-scale=1&#x27;&gt;",
    "scripts": ["https://croquet.studio/sdk/croquet-0.0.3.min.js"]
  }'
  style="height: 400px; overflow: auto;"
  data-height="400"
  data-theme-id="31205"
  data-default-tab="js,result"
  data-editable="true"
>

<pre data-lang="html">
&lt;div id="counter"&gt;&lt;/div&gt;
</pre>

<pre data-lang="css">
body {
  display: flex;
  flex-flow: wrap;
  user-select: none;
}
#qr {
  width: 150px;
  height: 150px;
}
#counter {
  margin: auto;
  font: 128px sans-serif;
}
</pre>

<pre data-lang="js">
class MyModel extends Croquet.Model {

    init() {
        super.init();
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

MyModel.register();

class MyView extends Croquet.View {

    constructor(model) {
        super(model);
        this.handleUpdate(model.counter);
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

// use fixed session name instead of random so multiple codepen windows find each other
const session = { user: 'GUEST', random: '1234567' };
Croquet.startSession("hello", MyModel, MyView, {step: "auto", session});

</pre>
</div>
<script async src="https://static.codepen.io/assets/embed/ei.js"></script>
