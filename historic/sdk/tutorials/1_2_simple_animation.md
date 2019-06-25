Copyright © 2019 Croquet Studios

This tutorial will teach you how to create multi-user shared animations and interactions. If you click one of the bouncing objects it will stop moving. Click again and it will start bouncing again. This tutorial isn't really that much more complex than the Hello World application. It just has a few more moving parts and really demonstrates how the model is used to compute a simulation and how the view is used to display it and interact with it.

<div class="codepen" data-height="512" data-theme-id="light" data-default-tab="js,result" data-user="croquet" data-slug-hash="NZbgGY" data-prefill='{"title":"Simple Animation","tags":[],"stylesheets":["https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css"],"scripts":["https://croquet.studio/sdk/croquet-latest.min.js","https://codepen.io/croquet/pen/OemewR"]}'>
  <pre data-lang="html">&lt;div id="session">&lt;/div>
</pre>
  <pre data-lang="css" >#session { position: fixed; width: 80px; height: 80px; top: 160px; right: 30px; }

body {
  display: flex;
  flex-flow: wrap;
  user-select: none;
}

body {
  margin: 0;
  overflow: hidden;
  font: 12px sans-serif;
  background: #999;
}
.root {
  position: absolute;
  width: 1100px;
  height: 1100px;
  background: #333;
  overflow: hidden;
  z-index: -1;
}
.circle {
  position: absolute;
  width: 100px;
  height: 100px;
  border-radius: 50px;
}
.roundRect {
  position: absolute;
  width: 100px;
  height: 100px;
  border-radius: 25px;
}</pre>
  <pre data-lang="js">// Croquet Tutorial 2
// Simple Animation
// Croquet Studios (C) 2019

//------------ Models--------------
// Models must NEVER use global variables.
// Instead use the Croquet.Constants object.

const Q = Croquet.Constants;
Q.BALL_NUM = 25;              // how many balls do we want?
Q.STEP_MS = 1000 / 30;        // bouncing ball speed in virtual pixels / step
Q.SPEED = 10;                 // max speed on a dimension, in units/s
Q.VERSION = '0.0.20';         // change this to force a new session

class MyModel extends Croquet.Model {

    init(options) {
        super.init(options);
        this.children = [];
        for (let i = 0; i &lt; Q.BALL_NUM; i++)
          this.add(BallModel.create());
        this.add(BallModel.create({type:'roundRect', pos: [500, 500], color: "white", ignoreTouch: true}));
    }

    add(child) {
        this.children.push(child);
        this.publish(this.id, 'child-added', child);
   }
}

MyModel.register();

class BallModel extends Croquet.Model {

    init(options={}) {
        super.init();
        const r = max => Math.floor(max * this.random());
        this.allowTouch = !options.ignoreTouch;
        this.type = options.type || 'circle';
        this.color = options.color || `hsla(${r(360)},${r(50)+50}%,50%,0.5)`;
        this.pos = options.pos || [r(1000), r(1000)];
        this.speed = this.randomSpeed();
        this.subscribe(this.id, "touch-me", ()=>this.startStop());
        this.alive = true;
        this.future(Q.STEP_MS).step();
    }

    moveTo(pos) {
        const [x, y] = pos;
        this.pos[0] = Math.max(0, Math.min(1000, x));
        this.pos[1] = Math.max(0, Math.min(1000, y));
        this.publish(this.id, 'pos-changed', this.pos);
    }

     randomSpeed() {
        const r = this.random() * 2 * Math.PI;
        return [Math.cos(r) * Q.SPEED, Math.sin(r) * Q. SPEED];
    }

     moveBounce() {
        const [x, y] = this.pos;
        if (x&lt;=0 || x>=1000 || y&lt;=0 || y>=1000)
           this.speed=this.randomSpeed();
        this.moveTo([x + this.speed[0], y + this.speed[1]]);
     }

    startStop(){if(this.allowTouch)this.alive = !this.alive}

    step() {
        if(this.alive)this.moveBounce();
        this.future(Q.STEP_MS).step();
    }
}

BallModel.register();

//------------ View--------------
let SCALE = 1;                  // model uses a virtual 1000x1000 space
let OFFSETX = 50;               // top-left corner of view, plus half shape width
let OFFSETY = 50;               // top-left corner of view, plus half shape height
const TOUCH ='ontouchstart' in document.documentElement;

class MyView extends Croquet.View{

    constructor(model) {
        super(model);

        this.element = document.createElement("div");
        this.element.className = "root";
        if (TOUCH) this.element.ontouchstart = e => e.preventDefault();
        this.resize();
        document.body.appendChild(this.element);
        window.onresize = () => this.resize();
        model.children.forEach(child => this.attachChild(child));
    }

    attachChild(child) {
        this.element.appendChild(new BallView(child).element);
    }

    resize() {
        const size = Math.max(50, Math.min(window.innerWidth, window.innerHeight));
        SCALE = size / 1100;
        OFFSETX = (window.innerWidth - size) / 2;
        OFFSETY = 0;
        this.element.style.transform = `translate(${OFFSETX}px,${OFFSETY}px) scale(${SCALE})`;
        this.element.style.transformOrigin = "0 0";
        OFFSETX += 50 * SCALE;
        OFFSETY += 50 * SCALE;
    }
}

class BallView extends Croquet.View {

    constructor(model) {
        super(model);
        const el = this.element = document.createElement("div");
        el.view = this;
        el.className = model.type;
        el.id = model.id;
        el.style.backgroundColor = model.color;
        this.move(model.pos);
        this.subscribe(model.id, { event: 'pos-changed', handling: "oncePerFrame" }, pos => this.move(pos));
         this.enableTouch();
    }

    move(pos) {
        this.element.style.left = pos[0] + "px";
        this.element.style.top = pos[1] + "px";
    }

    enableTouch() {
        const el = this.element;
        if (TOUCH) el.ontouchstart = start => {
            start.preventDefault();
            this.publish(el.id, "touch-me");
        }; else el.onmousedown = start => {
            start.preventDefault();
            this.publish(el.id, "touch-me");
        };
    }
}

// use fixed session name instead of random so multiple codepen windows find each other
const session = { user: 'GUEST', random: 'animate' };
Croquet.startSession("SimpleAnimation", MyModel, MyView, {step: "auto", session});</pre>
</div>
<script async src="https://static.codepen.io/assets/embed/ei.js"></script>


## **Try it out!**
The first thing to do is click or scan the QR code above. This will launch a new Codepen instance of this session. If you compare the two sessions, you will see that the animated simulations are identical. The balls all move and bounce exactly the same. You can stop and start any ball by clicking on it, which will start or stop it in every session. You can't stop the rounded rectangle - it is just like a regular ball but ignores user actions. Any reader of this documentation can start or stop the balls while they are animating. You may notice that this is happening. It just means there is someone else out there working with the tutorial at the same time as you.

There are three things we will learn here.

1. Creating a simulation model.
2. Creating an interactive view.
3. How to safely communicate between them.


## Simple Animation Model

Our application uses two Croquet Model subclasses, MyModel and BallModel. The MyModel class is the container for the BallModel class objects.

We must register all of the Croquet model subclasses that we create. Models can not use globals. Instead, you should use the Croquet.Constants. The Constants object is recursively frozen once a session has started to avoid accidental modification. Here we assign the variable Q to Croquet.Constants as a shorthand.

```
const Q = Croquet.Constants;
Q.BALL_NUM = 25;              // how many balls do we want?
Q.STEP_MS = 1000 / 30;       // bouncing ball speed in virtual pixels / step
Q.SPEED = 10;                 // max speed on a dimension, in units/s
```

MyModel is the root model. It is what creates the BallModel ball objects and it is what we pass into Croquet.startSession. MyModel.children is an array of BallModel objects.

The BallModel is where the action is. Its shape is defined in the CSS code - either a 'circle' or a 'roundRect', but the BallModel only sets the type of this element - it does not interact with the CSS or HTML code in any way. The Croquet View uses this type to create the actual visual element. The ball also computes a random color, position, and speed vector when it is initialized.

```this.subscribe(this.id, "touch-me", ()=>this.startStop());```

The BallModel subscribes to the "touch-me" event. This event is published by the view when an element is touched by a user. When the BallModel recieves this message, it calls the BallModel.startStop() function.

```this.future(STEP_MS).step();```

```
BallModel.step() {
    if(this.alive)this.moveBounce();
    this.future(Q.STEP_MS).step();
}
```

If the alive flag is set, the step() function will call the moveBounce() function.
The BallModel computes a simple linear motion and updates that at a regular interval. If the ball goes beyond a boundary, a new direction is computed.

```
BallModel.moveBounce() {
    const [x, y] = this.pos;
    if (x<=0 || x>=1000 || y<=0 || y>=1000)
        this.speed=this.randomSpeed();
    this.moveTo([x + this.speed[0], y + this.speed[1]]);
}
```
BallModel.moveBounce is actually quite interesting. It updates the ball object position. But if the ball is found to be out of bounds, it computes a new speed vector which redirects it using BallModel.randomSpeed().

```
randomSpeed() {
    const r = this.random() * 2 * Math.PI;
    return [Math.cos(r) * Q.SPEED, Math.sin(r) * Q. SPEED];
}
```

This new speed vector is an example of how we use a replicated random - every instance of this world will compute exactly the same random, so when the balls bounce, they all bounce in exactly the same new direction.

## Simple Animation View

Just like the Croquet Model, the Croquet View is made up of two classes. MyView and BallView.

### MyView

MyView.constructor(model) is used to construct the visual representation of the model. It is really a vanilla web-application in almost every way. It creates a new "div" element and then populates it with new elements associated with the models children (which are also models).

```model.children.forEach(child => this.attachChild(child));```

```
MyView.attachChild(child) {
    this.element.appendChild(new BallView(child).element);
}
```

We are accessing the model directly here to read its state. It is important to note that we **MUST NOT** modify the model or its parts in any way when we do this.

MyView also manages resizing of the view. This helps to keep the views consistent between multiple users. It isn't essential that the views be identical - it depends on the application. It is important if the model/view directly depend on the position of the user interaction relative to the contents.

### BallView

The BallView tracks the associated BallModel.

BallView constructs a new document element based upon the BallModel state. The type is matched to the CSS code and the color and the position of the BallModel are copied.

```this.subscribe(model.id, { event: 'pos-changed', handling: "oncePerFrame" }, pos => this.move(pos));```

The BallView subscribes to the BallModel 'pos-changed' event when the BallModel updates the ball position. The 'handling: "oncePerFrame' flag is used to optimize this, as the view only needs an update when a new image is rendered.

```this.enableTouch();```

```
BallView.enableTouch() {
    const el = this.element;
    if (TOUCH) el.ontouchstart = start => {
        start.preventDefault();
        this.publish(el.id, "touch-me");
    }; else el.onmousedown = start => {
        start.preventDefault();
        this.publish(el.id, "touch-me");
    };
}
```
BallView.enableTouch sets up the BallView element to publish a "touch-me" event when the element is clicked on.
The BallModel subscribes to the "touch-me" event and toggles the ball motion on and off.
