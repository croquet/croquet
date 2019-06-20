Copyright © 2019 Croquet Studios

This is an example of how you can create multi-user shared animations and interactions. If you click one of the bouncing objects it will stop moving. Click again and it will start bouncing again. This tutorial isn't really that much more complex than the Hello World application. It just has a few more moving parts and really demonstrates how the model is used to compute a simulation and how the view is used to display it and interact with it.

<p class="codepen" data-height="477" data-theme-id="37149" data-default-tab="js,result" data-user="croquet" data-slug-hash="NZbgGY" style="height: 477px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 2px solid; margin: 1em 0; padding: 1em;" data-pen-title="Simple Animation">
  <span>See the Pen <a href="https://codepen.io/croquet/pen/NZbgGY/">
  Simple Animation</a> by Croquet (<a href="https://codepen.io/croquet">@croquet</a>)
  on <a href="https://codepen.io">CodePen</a>.</span>
</p>
<script async src="https://static.codepen.io/assets/embed/ei.js"></script>


## **Try it out!**
The first thing to do is click or scan the QR code above. This will launch a new Codepen instance of this session. If you compare the two counters, you will see that they are identical. If you click in either of these panes, the counters in both will reset to 0.

There are three things we will learn here.
1. Creating a simulation model.
2. Creating an interactive view.
3. Safely communicating between them.


## Simple Animation Model

Our application uses two model subclasses, MyModel and BallModel. The MyModel class is the container for the BallModel class objects.

We must register all of the Croquet model classes that we create.

MyModel is the root model. It is what creates the BallModel ball objects and it is what we pass into Croquet.startSession. MyModel.children is an array of BallModel objects.

The BallModel is where the action is. Its shape is defined in the CSS code - either a 'circle' or a 'roundRect', but the BallModel only sets the type of this element - it does not interact with the CSS or HTML code in any way. The Croquet View uses this type to create the actual visual element. The ball also computes a random color, position, and speed vector when it is initialized.

```this.subscribe(this.id, "touch-me", ()=>this.startStop());```

The BallModel subscribes to the "touch-me" event. This event is published by the view when an element is touched by a user. When the BallModel recieves this message, it calls the BallModel.startStop() function.

```this.future(STEP_MS).step();```

```
BallModel.step() {
    if(this.alive)this.moveBounce();
    this.future(STEP_MS).step();
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
BallModel.moveBounce is actually quite interesting. It updates the ball object position. But if the ball is computed to be out of bounds, it computes a new speed vector which redirects it. This new speed vector is an example of a replicated random - every instance of this world will compute exactly the same random, so when the balls bounce, they all bounce in exactly the same new direction.

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

