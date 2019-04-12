import { Model, View, Controller } from "../teatime";
import Stats from "../../arcos/simpleapp/src/util/stats";
import urlOptions from "../../arcos/simpleapp/src/util/urlOptions";

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

const TEST = !!urlOptions.test;

////// Models /////

export class Root extends Model {

    constructor() {
        super();
        this.children = [];
    }

    load(state, allObjects) {
        super.load(state, allObjects);
        state.children.forEach(id => this.add(allObjects[id]));
    }

    save(state) {
        super.save(state);
        state.children = this.children.map(child => child.id);
    }

    start() {
        super.start();
        this.subscribe(this.id, 'user-added', user => this.userAdded(user));
    }

    // non-inherited methods below

    add(child) {
        this.children.push(child);
        if (child.user) this.subscribe(child.id, "user-inactive", () => this.remove(child));
        this.publish(this.id, 'child-added', child);
    }

    remove(child) {
        const index = this.children.findIndex(c => c === child);
        this.children.splice(index, 1);
        this.publish(this.id, 'child-removed', child);
        child.destroy();
    }

    userAdded(user) {
        let shape = this.children.find(c => c.user === user);
        if (!shape) {
            shape = new UserShape().init({user});
            this.add(shape);
        }
        shape.active = true;
        this.publish(this.id, `user-shape-${user}`, shape.id);
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

    load(state, allObjects) {
        super.load(state, allObjects);
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
        this.user = options.user;
        this.active = true;
        this.future(INACTIVE_MS).step();
        return this;
    }

    load(state, allObjects) {
        super.load(state, allObjects);
        this.user = state.user;
        this.active = state.active;
    }

    save(state) {
        super.save(state);
        state.user = this.user;
        state.active = this.active;
    }

    start() {
        super.start();
        this.subscribe(this.id, "user-is-active", () => this.active = true);
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

    load(state, allObjects) {
        super.load(state, allObjects);
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
        this.element = document.createElement("div");
        this.element.className = "root";
        if (TOUCH) this.element.ontouchstart = e => e.preventDefault();
        this.resize();
        document.body.appendChild(this.element);
        window.onresize = () => this.resize();
        model.children.forEach(child => this.attachChild(child));
        this.subscribe(model.id, 'child-added', child => this.attachChild(child));
        this.subscribe(model.id, 'child-removed', child => this.detachChild(child));
        this.subscribe(model.id, `user-shape-${USER}`, id => this.gotUserShape(id));
        if (TEST) this.publish(model.id, 'user-added', USER);
    }

    detach() {
        super.detach();
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
        if (!TEST) childView.enableDragging(child.id, childView.element, false);
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

    gotUserShape(id) {
        const el = document.getElementById(id);
        if (!el || this.userElement === el) return;
        el.classList.add("user");
        el.view.enableDragging(el.id, this.element, true);
        el.style.transform = `translate(-10px,-10px)`;  // compensate border
        this.userElement = el;
        setInterval(() => this.publish(id, 'user-is-active'), ACTIVE_MS);
    }
}


class ShapeView extends View {

    constructor(model) {
        super(model);
        const el = this.element = document.createElement("div");
        el.className = model.type;
        el.id = model.id;
        el.style.backgroundColor = model.color;
        this.subscribe(model.id, 'pos-changed', 'move');
        this.move(model.pos);
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

    enableDragging(id, el, jump) {
        if (TOUCH) el.ontouchstart = start => {
            start.preventDefault();
            let x = start.touches[0].clientX - OFFSETX;
            let y = start.touches[0].clientY - OFFSETY;
            let timeStamp = 0;
            if (jump) {
                this.publish(id, "move-to", [x / SCALE, y / SCALE]);
                timeStamp = start.timeStamp;
            }
            el.ontouchmove = evt => {
                const dx = evt.touches[0].clientX - OFFSETX - x;
                const dy = evt.touches[0].clientY - OFFSETY - y;
                if (evt.timeStamp - timeStamp > THROTTLE) {
                    this.publish(id, "move-by", [dx / SCALE, dy / SCALE]);
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
            if (jump) {
                const x = start.clientX - OFFSETX;
                const y = start.clientY - OFFSETY;
                this.publish(id, "move-to", [x / SCALE, y / SCALE]);
                timeStamp = start.timeStamp;
            }
            document.onmousemove = evt => {
                dx += evt.movementX;
                dy += evt.movementY;
                if (evt.timeStamp - timeStamp > THROTTLE) {
                    this.publish(id, "move-by", [dx / SCALE, dy / SCALE]);
                    dx = dy = 0;
                    timeStamp = evt.timeStamp;
                }
            };
            el.onmouseup = () => document.onmousemove = null;
        };
    }
}


async function go() {
    Controller.addMessageTranscoder('*', { encode: a => a, decode: a => a });
    const reflector = window.location.hostname === 'localhost'
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
            options: {test: TEST},
            creatorFn(options) {
                const root = new Root().init();
                if (!options.test) for (let i = 0; i < 99; i++) root.add(new Shape().init());
                root.add(new BouncingShape().init({pos: [500, 500], color: "white"}));
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
        Stats.animationFrame(timestamp);
        Stats.users(controller.users);
        Stats.network(Date.now() - controller.lastReceived);

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
}


go();
