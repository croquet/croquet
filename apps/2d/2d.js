import { Model, View, Controller } from "../teatime";
import Stats from "../../arcos/simpleapp/src/util/stats";
import urlOptions from "../../arcos/simpleapp/src/util/urlOptions";

const THROTTLE = 1000 / 20;     // mouse event throttling
const STEP_MS = 1000 / 20;      // bouncing ball step time in ms
const SPEED = 15;               // bouncing ball speed in virtual pixels / step

const TOUCH ='ontouchstart' in document.documentElement;

let SCALE = 1;                  // model uses a virtual 1000x1000 space


export class Root extends Model {

    applyState(state={}, topLevelPartsById) {
        this.children = (state.children || []).map(id => topLevelPartsById[id]);
    }

    toState(state) {
        super.toState(state);
        state.children = this.children.map(child => child.id);
    }

    // non-inherited methods below

    add(child) {
        this.children.push(child);
        this.publish(this.id, 'child-added', child);
    }

}


export class Shape extends Model {

    applyState(state={}) {
        const r = max => Math.floor(max * this.random());
        this.type = state.type || 'circle';
        this.color = state.color || `hsla(${r(360)},${r(50)+50}%,50%,0.5)`;
        this.pos = state.pos || [r(1000), r(1000)];
        this.subscribe(this.id, "move-to", pos => this.moveTo(...pos));
        this.subscribe(this.id, "move-by", delta => this.moveBy(...delta));
    }

    toState(state) {
        super.toState(state);
        state.type = this.type;
        state.color = this.color;
        state.pos = this.pos;
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


export class BouncingShape extends Shape {

    init(state) {
        super.init(state);

        this.future(STEP_MS).step();
        return this;
    }

    applyState(state={}) {
        super.applyState(state);
        this.speed = state.speed || this.randomSpeed();
    }

    toState(state) {
        super.toState(state);
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
        const view = new ShapeView(child);
        this.element.appendChild(view.element);
    }

    resize() {
        const size = Math.max(50, Math.min(window.innerWidth, window.innerHeight));
        SCALE = size / 1100;
        this.element.style.transform = `translate(${(window.innerWidth - size) / 2}px,0px) scale(${SCALE})`;
        this.element.style.transformOrigin = "0 0";
    }

}


class ShapeView extends View {

    constructor(model) {
        super(model);
        const el = this.element = document.createElement("div");
        el.className = model.type;
        el.style.backgroundColor = model.color;
        if (TOUCH) el.ontouchstart = start => {
            start.preventDefault();
            let x = start.touches[0].clientX;
            let y = start.touches[0].clientY;
            let timeStamp = 0;
            el.ontouchmove = evt => {
                const dx = evt.touches[0].clientX - x;
                const dy = evt.touches[0].clientY - y;
                if (evt.timeStamp - timeStamp > THROTTLE) {
                    this.publish(model.id, "move-by", [dx / SCALE, dy / SCALE]);
                    x += dx;
                    y += dy;
                    timeStamp = evt.timeStamp;
                }
            };
            el.ontouchend = el.ontouchcancel = () => el.ontouchmove = null;
        }; else el.onmousedown = () => {
            let dx = 0;
            let dy = 0;
            let timeStamp = 0;
            document.onmousemove = evt => {
                dx += evt.movementX;
                dy += evt.movementY;
                if (evt.timeStamp - timeStamp > THROTTLE) {
                    this.publish(model.id, "move-by", [dx / SCALE, dy / SCALE]);
                    dx = dy = 0;
                    timeStamp = evt.timeStamp;
                }
            };
            document.onmouseup = () => document.onmousemove = null;
        };
        this.subscribe(model.id, {event: "pos-changed", oncePerFrame: true}, pos => this.setPos(pos));
        this.setPos(model.pos);
    }

    // non-inherited methods below

    setPos(pos) {
        this.element.style.left = pos[0];
        this.element.style.top = pos[1];
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
            creatorFn() {
                const root = new Root().init();
                for (let i = 0; i < 99; i++) {
                    root.add(new Shape().init());
                }
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
