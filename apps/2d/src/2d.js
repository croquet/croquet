// work around https://github.com/parcel-bundler/parcel/issues/1838
import Stats from "@croquet/teatime/node_modules/@croquet/util/stats";
import { Model, View, Controller } from "@croquet/teatime";
import urlOptions from "@croquet/util/urlOptions";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


const LOCALHOST = window.location.hostname === 'localhost';

const THROTTLE = 1000 / 20;     // mouse event throttling
const STEP_MS = 1000 / 20;      // bouncing ball step time in ms
const SPEED = 15;               // bouncing ball speed in virtual pixels / step

const TOUCH ='ontouchstart' in document.documentElement;

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
                for (let i = 0; i < 99; i++) root.add(Shape.create());
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
}


go();
