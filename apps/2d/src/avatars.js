// to use latest client lib: cd croquet/libraries/packages/croquet; npm start
import { Model, View, App, Session } from "@croquet/croquet";


const TPS = "10x3";             // reflector ticks per sec x local multiplier
const THROTTLE = 1000 / 20;     // mouse event throttling
const STEP_MS = 1000 / 30;      // bouncing ball step time in ms
const SPEED = 10;               // bouncing ball speed in virtual pixels / step

////// Models /////

class ModelRoot extends Model {

    init() {
        super.init();
        this.shapes = {};
        this.subscribe(this.sessionId, "view-join", this.addUser);
        this.subscribe(this.sessionId, "view-exit", this.removeUser);
    }

    // non-inherited methods below

    addUser(viewId) {
        if (this.shapes[viewId]) { console.warn("shape already exists for joining user", viewId); return; }
        // both color and gravatar pic are based on viewId
        // so we get the same look back after going dormant
        const randomInt = Number.parseInt(viewId, 36);
        const hue = Math.floor(randomInt / 50) % 360;
        const saturation = 50 + randomInt % 50;
        const shape = BouncingShape.create({color: `hsla(${hue},${saturation}%,50%,0.5)`});
        shape.gravatar = randomInt.toString(16).padStart(16, '0');
        this.shapes[viewId] = shape;
        this.publish(this.id, 'shape-added', shape);
    }

    removeUser(viewId) {
        const shape = this.shapes[viewId];
        if (!shape) { console.warn("shape not found for leaving user", viewId); return; }
        delete this.shapes[viewId];
        this.publish(this.id, 'shape-removed', shape);
    }
}
ModelRoot.register("ModelRoot");


class Shape extends Model {

    init(options={}) {
        super.init();
        const r = max => Math.floor(max * Math.random());
        this.type = options.type || 'circle';
        this.color = options.color || `hsla(${r(360)},${r(50)+50}%,50%,0.5)`;
        this.pos = [r(1000), r(1000)];
        this.subscribe(this.id, "move-to", this.moveTo);
    }

    // non-inherited methods below

    moveBy(delta) {
        const [dx, dy] = delta;
        const [x, y] = this.pos;
        this.moveTo([x + dx, y + dy]);
    }

    moveTo(pos) {
        const [x, y] = pos;
        this.pos[0] = Math.max(0, Math.min(1000, x));
        this.pos[1] = Math.max(0, Math.min(1000, y));
        this.publish(this.id, 'pos-changed', this.pos);
    }

}
Shape.register("Shape");


class BouncingShape extends Shape {

    init(state) {
        super.init(state);
        this.speed = this.randomSpeed();
        this.subscribe(this.id, 'stress-step', this.step);
        if (state.startStepping) this.step(true);
    }

    // non-inherited methods below

    randomSpeed() {
        const r = this.random() * 2 * Math.PI;
        return [Math.cos(r) * SPEED, Math.sin(r) * SPEED];
    }

    step(repeat) {
        this.moveBy(this.speed);
        if (repeat) this.future(STEP_MS).step(repeat);
    }

    moveTo(pos) {
        super.moveTo(pos);
        const [x, y] = pos;
        let dx = x < 0 ? 1 : x >= 1000 ? -1 : 0;
        let dy = y < 0 ? 1 : y >= 1000 ? -1 : 0;
        if (dx || dy) {
            if (!dx) dx = Math.sign(this.speed[0]);
            if (!dy) dy = Math.sign(this.speed[1]);
            const r = this.randomSpeed();
            this.speed = [
                dx * Math.abs(r[0]),
                dy * Math.abs(r[1]),
            ];
        }
    }

}
BouncingShape.register("BouncingShape");


class Shapes extends ModelRoot {
    init(options) {
        super.init(options);
        for (let i = 0; i < options.bounce; i++) this.shapes["bounce" + i] = BouncingShape.create({pos: [500, 500], color: "white", startStepping: true});
    }
}
Shapes.register("Shapes");


////// Views /////

let SCALE = 1;                  // model uses a virtual 1000x1000 space
let OFFSETX = 50;               // top-left corner of view, plus half shape width
let OFFSETY = 50;               // top-left corner of view, plus half shape height

const TOUCH ='ontouchstart' in document.documentElement;
const STRESS = +new URL(window.location).searchParams.get("stress");

class ShapesView extends View {

    constructor(model) {
        super(model);
        this.model = model;
        this.element = document.createElement("div");
        this.element.className = 'root';
        document.body.appendChild(this.element);
        if (TOUCH) this.element.ontouchstart = e => e.preventDefault();
        this.resize();
        window.onresize = () => this.resize();
        Object.values(model.shapes).forEach(shape => this.attachShape(shape));
        this.subscribe(model.id, 'shape-added', this.attachShape);
        this.subscribe(model.id, 'shape-removed', this.detachShape);
        if (STRESS) this.startStress(1000 / (Math.min(120, STRESS)));
    }

    detach() {
        super.detach();
        clearInterval(this.ticker);
        if (!this.element.parentNode) return;
        this.element.parentNode.removeChild(this.element);
    }

    // non-inherited methods below

    attachShape(shape) {
        const shapeView = new ShapeView(shape);
        this.element.appendChild(shapeView.element);
        shapeView.element.view = shapeView;
        // make our own shape our avatar
        if (this.model.shapes[this.viewId] === shape) this.gotUserShape(shape);
    }

    detachShape(shape) {
        const el = document.getElementById(shape.id);
        if (el) el.view.detach();
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

    gotUserShape(shape) {
        this.userShape = shape;
        const el = document.getElementById(shape.id);
        el.classList.add("user");
        this.enableDragging();
    }

    enableDragging() {
        const el = this.element;
        let x, y, lastTimeStamp = 0;
        const move = (moveDetails, sourceEvt=moveDetails) => {
            sourceEvt.preventDefault();
            x = moveDetails.clientX - OFFSETX;
            y = moveDetails.clientY - OFFSETY;

            const timeStamp = sourceEvt.timeStamp;
            if (timeStamp - lastTimeStamp > THROTTLE) {
                this.publish(this.userShape.id, "move-to", [x / SCALE, y / SCALE]);
                lastTimeStamp = timeStamp;
            }
            };
        if (TOUCH) el.ontouchstart = start => {
            move(start.touches[0], start);
            el.ontouchmove = evt => move(evt.touches[0], evt);
            el.ontouchend = el.ontouchcancel = () => {
                el.ontouchmove = null; };
            };
        else el.onmousedown = start => {
            move(start);
            document.onmousemove = move;
            document.onmouseup = () => document.onmousemove = null;
            };
    }

    showStatus(backlog, starvation, min, max) {
        const color = backlog > starvation ? '255,0,0' : '255,255,255';
        const value = Math.max(backlog, starvation) - min;
        const size = Math.min(value, max) * 100 / max;
        const alpha = size / 100;
        this.element.style.boxShadow = alpha < 0.2 ? "" : `inset 0 0 ${size}px rgba(${color},${alpha})`;
    }

    startStress(ms) {
        this.ticker = setInterval(() => this.userShape && this.publish(this.userShape.id, 'stress-step'), ms);
    }
}

class ShapeView extends View {

    constructor(model) {
        super(model);
        const el = this.element = document.createElement("div");
        el.className = model.type;
        el.id = model.id;
        el.style.backgroundColor = model.color;
        if (!STRESS && model.gravatar) el.style.backgroundImage = `url("https://www.gravatar.com/avatar/${model.gravatar}?d=robohash&f=y&s=100")`;
        this.subscribe(model.id, { event: 'pos-changed', handling: "oncePerFrame" }, this.move);
        this.move(model.pos);
    }

    detach() {
        super.detach();
        const el = this.element;
        el.parentElement.removeChild(el);
    }

    // non-inherited methods below

    move([x,y]) {
        this.element.style.left = x;
        this.element.style.top = y;
    }
}


// tell many.html
//window.top.postMessage({connected: +1}, "*");
//window.top.postMessage({connected: -1}, "*");

async function go() {
    App.messages = true;
    App.makeWidgetDock();

    const bounce = +new URL(window.location).searchParams.get("bounce");

    const session = await Session.join({
        apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
        appId: "io.croquet.examples.avatars",
        name: App.autoSession(),
        password: "none",
        model: Shapes,
        view: ShapesView,
        tps: TPS,
        step: "manual",
        options: { bounce: Math.max(1, bounce) }
        });

    const controller = session.view.realm.vm.controller;

    let users = 0;

    window.requestAnimationFrame(frame);
    function frame(timestamp) {
        session.step(timestamp);

        if (session.view) session.view.showStatus(controller.backlog, controller.starvation, 100, 3000);

        if (users !== controller.users) {
            users = controller.users;
            window.top.postMessage({ users }, "*");
        }

        window.requestAnimationFrame(frame);
    }

    window.addEventListener("beforeunload", () => {
        if (controller.vm) window.top.postMessage({connected: -1}, "*");
    });
}


go();
