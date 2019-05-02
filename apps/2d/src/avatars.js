import Stats from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";
import { Model, View, Controller } from "@croquet/teatime";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


const LOCALHOST = window.location.hostname === 'localhost';

const TPS = "10x3";             // reflector ticks per sec x local multiplier
const THROTTLE = 1000 / 20;     // mouse event throttling
const STEP_MS = 1000 / 30;      // bouncing ball step time in ms
const SPEED = 10;               // bouncing ball speed in virtual pixels / step
const ACTIVE_MS = 1000;         // send activity indicator after this (real) time
const INACTIVE_MS = 5000;       // delete inactive users after this (sim) time

const TOUCH ='ontouchstart' in document.documentElement;
const USER = (Math.random()+'').slice(2);
//const USER = new Array(53).fill(0).map(() => (Math.random()+'').slice(2)).join('');

let SCALE = 1;                  // model uses a virtual 1000x1000 space
let OFFSETX = 50;               // top-left corner of view, plus half shape width
let OFFSETY = 50;               // top-left corner of view, plus half shape height

////// Models /////

export class Root extends Model {

    constructor() {
        super();
        this.children = [];
    }

    init() {
        super.init();
        this.subscribe(this.id, "user-is-active", user => this.ensureUser(user));
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
        this.random(); // force random to diverge if we have a sync bug
    }

    ensureUser(user) {
        let shape = this.children.find(c => c.user === user);
        if (!shape) {
            shape = UserShape.create({user, parent: this});
            this.add(shape);
        }
        shape.active = true;
        this.publish(this.id, `user-shape-${user}`, shape);
        this.random(); // force random to diverge if we have a sync bug
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


export class UserShape extends Shape {

    init(options) {
        super.init();
        this.parent = options.parent;
        this.user = options.user;
        this.active = true;
        this.future(INACTIVE_MS).step();
        return this;
    }

    // non-inherited methods below

    moveTo(pos) {
        super.moveTo(pos);
        this.active = true;
    }

    step() {
        if (!this.active) this.parent.remove(this);
        else {
            this.active = false;
            this.future(INACTIVE_MS).step();
        }
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


////// Views /////

class RootView extends View {

    constructor(model) {
        super(model);
        this.model = model;
        this.element = document.createElement("div");
        this.element.className = 'root';
        document.body.appendChild(this.element);
        if (TOUCH) this.element.ontouchstart = e => e.preventDefault();
        this.resize();
        window.onresize = () => this.resize();
        model.children.forEach(child => this.attachChild(child));
        this.subscribe(model.id, 'child-added', child => this.attachChild(child));
        this.subscribe(model.id, 'child-removed', child => this.detachChild(child));
        this.subscribe(model.id, `user-shape-${USER}`, shape => this.gotUserShape(shape));
        this.publish(model.id, 'user-is-active', USER);
        this.ticker = setInterval(() => this.publish(model.id, 'user-is-active', USER), ACTIVE_MS);
    }

    detach() {
        super.detach();
        clearInterval(this.ticker);
        try {
            document.body.removeChild(this.element);
        } catch (e) {
            console.warn('detach() failed to remove from body:', this.element);
        }
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

    gotUserShape(shape) {
        this.userShape = shape;
        const el = document.getElementById(shape.id);
        el.classList.add("user");
        this.enableDragging();
    }

    enableDragging() {
        const el = this.element;
        let x, y, timeStamp = 0;
        const move = evt => {
            evt.preventDefault();
            x = evt.clientX - OFFSETX;
            y = evt.clientY - OFFSETY;
            if (evt.timeStamp - timeStamp > THROTTLE) {
                this.publish(this.userShape.id, "move-to", [x / SCALE, y / SCALE]);
                timeStamp = evt.timeStamp;
            }
        };
        if (TOUCH) el.ontouchstart = start => {
            move(start.touches[0]);
            el.ontouchmove = evt => move(evt.touches[0]);
            el.ontouchend = el.ontouchcancel = () => el.ontouchmove = null;
        }; else el.onmousedown = start => {
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


async function go() {
    Controller.addMessageTranscoder('*', { encode: a => a, decode: a => a });
    const reflector = LOCALHOST
        ? "ws://localhost:9090/"
        : "wss://dev1.os.vision/reflector-v1";
    Controller.connectToReflector(module.id, urlOptions.reflector || reflector);

    const controller = new Controller();
    let rootView = null;

    async function bootstrapModelsAndViews(snapshot) {
        // create models on named island
        const models = await controller.createIsland("2d", {
            snapshot,
            tps: TPS,
            creatorFn() {
                const root = Root.create();
                root.add(BouncingShape.create({pos: [500, 500], color: "white"}));
                return {root};
            },
            destroyerFn(prevSnapshot) {
                window.top.postMessage({connected: -1}, "*");
                if (rootView) rootView.detach();
                bootstrapModelsAndViews(prevSnapshot);
            }
        });

        // create views
        controller.inViewRealm(() => {
            rootView = new RootView(models.root);
        });

        // tell many.html
        window.top.postMessage({connected: +1}, "*");
    }

    await bootstrapModelsAndViews();

    let users = 0;

    window.requestAnimationFrame(frame);
    function frame(timestamp) {
        const starvation = Date.now() - controller.lastReceived;
        const backlog = controller.backlog;
        rootView.showStatus(backlog, starvation, 100, 3000);
        Stats.animationFrame(timestamp, {backlog, starvation, users: controller.users});


        if (users !== controller.users) {
            users = controller.users;
            window.top.postMessage({ users }, "*");
        }

        if (controller.island) {
            controller.simulate(Date.now() + 200);

            Stats.begin("render");
            controller.processModelViewEvents();
            Stats.end("render");
        }

        window.requestAnimationFrame(frame);
    }

    window.onbeforeunload = () => {
        if (controller.island) window.top.postMessage({connected: -1}, "*");
    };
}


go();
