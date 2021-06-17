// to use latest sdk: cd croquet/libraries/packages/croquet; npm start
import { Model, View, App, Session } from "@croquet/croquet";


const TPS = "10x3";             // reflector ticks per sec x local multiplier
const THROTTLE = 1000 / 20;     // mouse event throttling
const STEP_MS = 1000 / 30;      // bouncing ball step time in ms
const SPEED = 10;               // bouncing ball speed in virtual pixels / step


////// Models /////

class ModelRoot extends Model {

    init() {
        super.init();
        this.children = [];
    }

    // non-inherited methods below

    add(child) {
        this.children.push(child);
        this.publish(this.id, 'child-added', child);
    }

    remove(child) {
        const index = this.children.findIndex(c => c === child);
        this.children.splice(index, 1);
        this.publish(this.id, 'child-removed', child);
        child.destroy();
    }
}
ModelRoot.register("ModelRoot");

class Shape extends Model {

    init(options={}) {
        super.init();
        const r = max => Math.floor(max * this.random());
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
        this.future(STEP_MS).step();
    }

    // non-inherited methods below

    randomSpeed() {
        const r = this.random() * 2 * Math.PI;
        return [Math.cos(r) * SPEED, Math.sin(r) * SPEED];
    }

    step() {
        this.moveBy(this.speed);
        this.future(STEP_MS).step();
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
        const n = typeof options.n === "number" ? options.n : 99;
        for (let i = 0; i < n; i++) this.add(Shape.create());
        this.add(BouncingShape.create({pos: [500, 500], color: "white"}));
    }
}
Shapes.register("Shapes");

////// Views /////

const TOUCH ='ontouchstart' in document.documentElement;

let SCALE = 1;                  // model uses a virtual 1000x1000 space
let OFFSETX = 50;               // top-left corner of view, plus half shape width
let OFFSETY = 50;               // top-left corner of view, plus half shape height


class ShapesView extends View {

    constructor(model) {
        super(model);
        this.element = document.createElement("div");
        this.element.className = "root";
        if (TOUCH) this.element.ontouchstart = e => e.preventDefault();
        this.resize();
        document.body.appendChild(this.element);
        window.onresize = () => this.resize();
        model.children.forEach(child => this.attachChild(child));
        this.subscribe(model.id, 'child-added', this.attachChild);
        this.subscribe(model.id, 'child-removed', this.detachChild);
    }

    detach() {
        super.detach();
        if (!this.element.parentNode) return;
        this.element.parentNode.removeChild(this.element);
    }

    // non-inherited methods below

    attachChild(child) {
        const childView = new ShapeView(child);
        this.element.appendChild(childView.element);
        childView.element.view = childView;
    }

    detachChild(child) {
        const el = document.getElementById(child.id);
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

    showStatus(backlog, starvation, min, max) {
        const color = backlog > starvation ? '255,0,0' : '255,255,255';
        const value = Math.max(backlog, starvation) - min;
        const size = Math.min(value, max) * 100 / max;
        const alpha = size / 100;
        this.element.style.boxShadow = alpha < 0.2 ? "" : `inset 0 0 ${size}px rgba(${color},${alpha})`;
    }
}


class ShapeView extends View {

    constructor(model) {
        super(model);
        const el = this.element = document.createElement("div");
        el.className = model.type;
        el.id = model.id;
        el.style.backgroundColor = model.color;
        this.subscribe(model.id, { event: 'pos-changed', handling: "oncePerFrame" }, this.move);
        this.move(model.pos);
        this.enableDragging();
    }

    detach() {
        const el = this.element;
        el.parentElement.removeChild(el);
    }

    // non-inherited methods below

    move(pos) {
        this.element.style.left = pos[0];
        this.element.style.top = pos[1];
    }

    enableDragging() {
        const el = this.element;
        let x, y, lastTimeStamp = 0;
        const move = (moveDetails, sourceEvt = moveDetails) => {
            sourceEvt.preventDefault();
            x = moveDetails.clientX - OFFSETX;
            y = moveDetails.clientY - OFFSETY;

            const timeStamp = sourceEvt.timeStamp;
            if (timeStamp - lastTimeStamp > THROTTLE) {
                this.publish(el.id, "move-to", [x / SCALE, y / SCALE]);
                lastTimeStamp = timeStamp;
            }
        };
        if (TOUCH) el.ontouchstart = start => {
            move(start.touches[0], start);
            el.ontouchmove = evt => move(evt.touches[0], evt);
            el.ontouchend = el.ontouchcancel = () => {
                el.ontouchmove = null;
            };
        };
        else el.onmousedown = start => {
            move(start);
            document.onmousemove = move;
            document.onmouseup = () => document.onmousemove = null;
        };
    }
}


// tell many.html
//window.top.postMessage({connected: +1}, "*");
//window.top.postMessage({connected: -1}, "*");

async function go() {
    App.messages = true;
    App.makeWidgetDock();

    const SessionButton = document.getElementById("SessionButton");

    let session = null;
    let users = 0;

    joinSession();

    async function joinSession() {
        SessionButton.innerText = "Joining";
        SessionButton.onclick = null;

        session = await Session.join({
            appId: "io.croquet.examples._2d",
            name: App.autoSession(),
            password: App.autoPassword(),
            model: Shapes,
            view: ShapesView,
            tps: TPS,
            step: "manual",
            optionsFromUrl: ['n']
            });
        window.requestAnimationFrame(frame);
        SessionButton.innerText = "Leave";
        SessionButton.onclick = leaveSession;
    }

    async function leaveSession() {
        SessionButton.innerText = "Leaving";
        SessionButton.onclick = null;
        await session.leave();
        session = null;
        SessionButton.innerText = "Join";
        SessionButton.onclick = joinSession;
    }

    function frame(timestamp) {
        if (!session) return;

        session.step(timestamp);

        if (session.view) {
            const controller = session.view.realm.island.controller;

            session.view.showStatus(controller.backlog, controller.starvation, 100, 3000);

            if (users !== controller.users) {
                users = controller.users;
                window.top.postMessage({ users }, "*");
            }
        }

        window.requestAnimationFrame(frame);
    }
}


go();
