import { Model, View, Controller, startSession } from "@croquet/teatime";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


const TPS = "10x3";             // reflector ticks per sec x local multiplier
const THROTTLE = 1000 / 20;     // mouse event throttling
const STEP_MS = 1000 / 30;      // bouncing ball step time in ms
const SPEED = 10;               // bouncing ball speed in virtual pixels / step

const TOUCH ='ontouchstart' in document.documentElement;

let SCALE = 1;                  // model uses a virtual 1000x1000 space
let OFFSETX = 50;               // top-left corner of view, plus half shape width
let OFFSETY = 50;               // top-left corner of view, plus half shape height


////// Models /////

export class ModelRoot extends Model {

    constructor() {
        super();
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


export class Shape extends Model {

    init(options={}) {
        super.init();
        const r = max => Math.floor(max * this.random());
        this.type = options.type || 'circle';
        this.color = options.color || `hsla(${r(360)},${r(50)+50}%,50%,0.5)`;
        this.pos = [r(1000), r(1000)];
        this.subscribe(this.id, "move-to", pos => this.moveTo(pos));
        this.subscribe(this.id, "move-by", delta => this.moveBy(delta));
        return this;
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


export class BouncingShape extends Shape {

    init(state) {
        super.init(state);
        this.speed = this.randomSpeed();
        this.future(STEP_MS).step();
        return this;
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

export class Shapes extends ModelRoot {
    init(options) {
        super.init(options);
        const n = options.n || 99;
        for (let i = 0; i < n; i++) this.add(Shape.create());
        this.add(BouncingShape.create({pos: [500, 500], color: "white"}));
    }
}

////// Views /////

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
        this.subscribe(model.id, 'child-added', child => this.attachChild(child));
        this.subscribe(model.id, 'child-removed', child => this.detachChild(child));
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
        this.subscribe(model.id, {event: 'pos-changed', oncePerFrame: true}, pos => this.move(pos));
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
        if (TOUCH) el.ontouchstart = start => {
            start.preventDefault();
            let x = start.touches[0].clientX - OFFSETX;
            let y = start.touches[0].clientY - OFFSETY;
            let timeStamp = 0;
            el.ontouchmove = evt => {
                const dx = evt.touches[0].clientX - OFFSETX - x;
                const dy = evt.touches[0].clientY - OFFSETY - y;
                if (evt.timeStamp - timeStamp > THROTTLE) {
                    this.publish(el.id, "move-by", [dx / SCALE, dy / SCALE]);
                    x += dx;
                    y += dy;
                    timeStamp = evt.timeStamp;
                }
            };
            el.ontouchend = el.ontouchcancel = () => el.ontouchmove = null;
        }; else el.onmousedown = start => {
            start.preventDefault();
            let dx = 0;
            let dy = 0;
            let timeStamp = 0;
            document.onmousemove = evt => {
                dx += evt.movementX;
                dy += evt.movementY;
                if (evt.timeStamp - timeStamp > THROTTLE) {
                    this.publish(el.id, "move-by", [dx / SCALE, dy / SCALE]);
                    dx = dy = 0;
                    timeStamp = evt.timeStamp;
                }
            };
            document.onmouseup = () => document.onmousemove = null;
        };
    }
}


// tell many.html
//window.top.postMessage({connected: +1}, "*");
//window.top.postMessage({connected: -1}, "*");

async function go() {
    Controller.connectToReflector(module.id);

    const controller = await startSession("2d", Shapes, ShapesView, {tps: TPS, optionsFromUrl: ['n']});

    let users = 0;

    window.requestAnimationFrame(frame);
    function frame(timestamp) {
        controller.step(timestamp);

        if (controller.view) controller.view.showStatus(controller.backlog, controller.starvation, 100, 3000);

        if (users !== controller.users) {
            users = controller.users;
            window.top.postMessage({ users }, "*");
        }

        window.requestAnimationFrame(frame);
    }

    window.addEventListener("beforeunload", () => {
        if (controller.island) window.top.postMessage({connected: -1}, "*");
    });
}


go();
