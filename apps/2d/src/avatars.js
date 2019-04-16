import { Model, View, Controller } from "@croquet/teatime";
import Stats from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";

const LOCALHOST = window.location.hostname === 'localhost';

const THROTTLE = 1000 / 20;     // mouse event throttling
const STEP_MS = 1000 / 20;      // bouncing ball step time in ms
const SPEED = 15;               // bouncing ball speed in virtual pixels / step
const ACTIVE_MS = 500;          // send activity indicator after this (real) time
const INACTIVE_MS = 5000;       // delete inactive users after this (sim) time

const TOUCH ='ontouchstart' in document.documentElement;
const USER = (Math.random()+'').slice(2);

let SCALE = 1;                  // model uses a virtual 1000x1000 space
let OFFSETX = 50;               // top-left corner of view, plus half shape width
let OFFSETY = 50;               // top-left corner of view, plus half shape height

////// Models /////

export class Root extends Model {

    constructor() {
        super();
        this.children = [];
    }

    load(state, allModels) {
        super.load(state, allModels);
        state.children.forEach(id => this.add(allModels[id]));
    }

    save(state) {
        super.save(state);
        state.children = this.children.map(child => child.id);
    }

    start() {
        super.start();
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
    }

    ensureUser(user) {
        let shape = this.children.find(c => c.user === user);
        if (!shape) {
            shape = UserShape.create({user, parent: this});
            this.add(shape);
        }
        shape.active = true;
        this.publish(this.id, `user-shape-${user}`, shape);
    }
}


export class Shape extends Model {

    init(options={}) {
        super.init();
        const r = max => Math.floor(max * this.random());
        this.type = options.type || 'circle';
        this.color = options.color || `hsla(${r(360)},${r(50)+50}%,50%,0.5)`;
        this.pos = [r(1000), r(1000)];
        return this;
    }

    load(state, allModels) {
        super.load(state, allModels);
        this.type = state.type;
        this.color = state.color;
        this.pos = state.pos;
    }

    save(state) {
        super.save(state);
        state.type = this.type;
        state.color = this.color;
        state.pos = this.pos;
    }

    start() {
        super.start();
        this.subscribe(this.id, "move-to", pos => this.moveTo(...pos));
        this.subscribe(this.id, "move-by", delta => this.moveBy(...delta));
    }

    // non-inherited methods below

    moveBy(dx, dy) {
        const [x, y] = this.pos;
        this.moveTo(x + dx, y + dy);
    }

    moveTo(x, y) {
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

    load(state, allModels) {
        super.load(state, allModels);
        this.parent = allModels[state.parent];
        this.user = state.user;
        this.active = state.active;
    }

    save(state) {
        super.save(state);
        state.parent = this.parent.id;
        state.user = this.user;
        state.active = this.active;
    }

    start() {
        super.start();
        this.subscribe(this.id, "user-inactive", () => this.parent.remove(this));
    }

    // non-inherited methods below

    moveTo(x, y) {
        super.moveTo(x, y);
        this.active = true;
    }

    step() {
        if (!this.active) { this.publish(this.id, "user-inactive"); return; }
        this.active = false;
        this.future(INACTIVE_MS).step();
    }

}


export class BouncingShape extends Shape {

    init(state) {
        super.init(state);
        this.speed = this.randomSpeed();
        this.future(STEP_MS).step();
        return this;
    }

    load(state, allModels) {
        super.load(state, allModels);
        this.speed = state.speed;
    }

    save(state) {
        super.save(state);
        state.speed = this.speed;
    }

    // non-inherited methods below

    randomSpeed() {
        const r = this.random() * 2 * Math.PI;
        return [Math.cos(r) * SPEED, Math.sin(r) * SPEED];
    }

    step() {
        this.moveBy(...this.speed);
        this.future(STEP_MS).step();
    }

    moveTo(x, y) {
        super.moveTo(x, y);
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
        this.canvas = document.createElement("canvas");
        this.canvas.className = 'root';
        this.context = this.canvas.getContext("2d");
        this.context.save();
        document.body.appendChild(this.canvas);
        if (TOUCH) this.canvas.ontouchstart = e => e.preventDefault();
        this.resize();
        window.onresize = () => this.resize();
        this.subscribe(model.id, `user-shape-${USER}`, shape => this.gotUserShape(shape));
        this.publish(model.id, 'user-is-active', USER);
        setInterval(() => this.publish(model.id, 'user-is-active', USER), ACTIVE_MS);
        this.enableDragging();
    }

    detach() {
        super.detach();
        try {
            document.body.removeChild(this.canvas);
        } catch (e) {
            console.warn('detach() failed to remove from body:', this.canvas);
        }
    }

    // non-inherited methods below

    resize() {
        const size = Math.max(50, Math.min(window.innerWidth, window.innerHeight));
        this.canvas.width = size;
        this.canvas.height = size;
        SCALE = size / 1100;
        OFFSETX = (window.innerWidth - size) / 2;
        OFFSETY = 0;
        this.canvas.style.left = OFFSETX;
        this.canvas.style.top = OFFSETY;
        OFFSETX += 50 * SCALE;
        OFFSETY += 50 * SCALE;
        this.context.restore();
        this.context.scale(SCALE, SCALE);
        this.context.save();
    }

    gotUserShape(shape) {
        this.userShape = shape;
    }

    enableDragging() {
        const el = this.canvas;
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

    render() {
        const ctx = this.context;
        ctx.clearRect(0, 0, 1100, 1100);
        for (const shape of this.model.children) {
            const [x, y] = shape.pos;
            ctx.beginPath();
            ctx.arc(x + 50, y + 50, 50, 0, 2 * Math.PI);
            ctx.fillStyle = shape.color;
            ctx.fill();
            if (shape === this.userShape) {
                ctx.strokeStyle = "white";
                ctx.lineWidth = 10;
                ctx.stroke();
            }
        }
    }

    showStatus(backlog, starvation, min, max) {
        const color = backlog > starvation ? '255,0,0' : '255,255,255';
        const value = Math.max(backlog, starvation) - min;
        const size = Math.min(value, max) * 100 / max;
        const alpha = size / 100;
        this.canvas.style.boxShadow = alpha < 0.2 ? "" : `inset 0 0 ${size}px rgba(${color},${alpha})`;
    }
}


async function go() {
    Controller.addMessageTranscoder('*', { encode: a => a, decode: a => a });
    const reflector = LOCALHOST
        ? "ws://localhost:9090/"
        : "wss://dev1.os.vision/reflector-v1";
    Controller.connectToReflector(urlOptions.reflector || reflector);

    const controller = new Controller();
    let rootView = null;

    async function bootstrapModelsAndViews(snapshot) {
        // create models on named island
        const models = await controller.createIsland("2d", {
            moduleID: module.id,
            snapshot,
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
        Stats.animationFrame(timestamp);
        Stats.users(controller.users);
        Stats.network(starvation);

        if (users !== controller.users) {
            users = controller.users;
            window.top.postMessage({ users }, "*");
        }

        if (controller.island) {
            controller.simulate(Date.now() + 200);

            Stats.begin("render");
            controller.processModelViewEvents();
            rootView.render();
            Stats.end("render");
        }

        window.requestAnimationFrame(frame);
    }
}


go();
