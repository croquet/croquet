import Island, { connectToReflector, Controller, addMessageTranscoder } from "./island.js";
import { StatePart, ViewPart, currentRealm, inViewRealm } from "./modelView.js";
import Stats from "./util/stats.js";
import urlOptions from "./util/urlOptions.js";

const THROTTLE = 1000 / 60;     // mouse event throttling
const SPEED = 10;               // bouncing ball speed
let SCALE = 1;                  // model uses a virtual 1000x1000 space

addMessageTranscoder('*', a => a, a => a);

export class Root extends StatePart {

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
        this.publish('child-added', child.id);
    }

}


export class Shape extends StatePart {

    applyState(state={}) {
        const r = max => Math.floor(max * currentRealm().random());
        this.type = state.type || 'circle';
        this.color = state.color || `hsla(${r(360)},${r(50)+50}%,50%,0.5)`;
        this.pos = state.pos || [r(1000), r(1000)];
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
        this.publish('pos-changed', this.pos);
    }
}


export class BouncingShape extends Shape {

    applyState(state={}) {
        super.applyState(state);
        this.speed = state.speed || randomSpeed();
        if (!state.speed) this.step();

        function randomSpeed() {
            const r = currentRealm().random() * 2 * Math.PI;
            return [Math.cos(r) * SPEED, Math.sin(r) * SPEED];
        }
    }

    toState(state) {
        super.toState(state);
        state.speed = this.speed;
    }

    // non-inherited methods below

    step() {
        this.moveBy(...this.speed);
        this.future(1000/30).step();
    }

    moveTo(x, y) {
        let dx = x < 0 ? 1 : x >= 1000 ? -1 : 0;
        let dy = y < 0 ? 1 : y >= 1000 ? -1 : 0;
        if (dx || dy) {
            if (!dx) dx = Math.sign(this.speed[0]);
            if (!dy) dy = Math.sign(this.speed[1]);
            const r = currentRealm().random() * 2 * Math.PI;
            this.speed = [
                dx * Math.abs(Math.cos(r)) * SPEED,
                dy * Math.abs(Math.sin(r)) * SPEED,
            ];
        }
        super.moveTo(x, y);
    }
}


class RootView extends ViewPart {

    constructor(model) {
        super(model);
        this.element = document.createElement("div");
        this.element.className = "root";
        this.resize();
        document.body.appendChild(this.element);
        window.onresize = () => this.resize();
        model.children.forEach(child => this.attachChild(child));
        this.subscribe('child-added', 'attachChild', this.modelId);
    }

    detach() {
        super.detach();
        document.body.removeChild(this.element);
    }

    // non-inherited methods below

    attachChild(child) {
        const view = new ShapeView(child);
        this.element.appendChild(view.element);
    }

    resize() {
        const size = Math.max(50, Math.min(window.innerWidth, window.innerHeight) - 10);
        SCALE = size / 1100;
        this.element.style.transform = `translate(${(window.innerWidth - size) / 2}px,${5}px) scale(${SCALE})`;
        this.element.style.transformOrigin = "0 0";
    }

}


class ShapeView extends ViewPart {

    constructor(model) {
        super(model);
        this.element = document.createElement("div");
        this.element.className = model.type;
        this.element.style.backgroundColor = model.color;
        this.element.onmousedown = () => {
            let dx = 0;
            let dy = 0;
            let timeStamp = 0;
            document.onmousemove = evt => {
                dx += evt.movementX;
                dy += evt.movementY;
                if (evt.timeStamp - timeStamp > THROTTLE) {
                    this.modelPart().moveBy(dx / SCALE, dy / SCALE);
                    dx = dy = 0;
                    timeStamp = evt.timeStamp;
                }
            };
            document.onmouseup = () => {
                document.onmouseup = null;
                document.onmousemove = null;
            };
        };
        this.subscribe('pos-changed', 'move', this.modelId);
        this.move(model.pos);
    }

    // non-inherited methods below

    move(pos) {
        this.element.style.left = pos[0];
        this.element.style.top = pos[1];
    }

}


async function go() {
    const reflector = window.location.hostname === 'localhost'
        ? "ws://localhost:9090/"
        : "wss://dev1.os.vision/reflector-v1";
    connectToReflector(urlOptions.reflector || reflector);

    const controller = new Controller();
    let rootView = null;

    async function setup(snapshot) {
        const mainIsland = await controller.createIsland("2d", {
            moduleID: module.id,
            snapshot,
            creatorFn(state) {
                return new Island(state, island => {
                    const root = new Root().init();
                    island.set('root', root);
                    for (let i = 0; i < 99; i++) {
                        root.add(new Shape().init());
                    }
                    root.add(new BouncingShape().init({pos: [500, 500], color: "white"}));
                });
            },
            destroyerFn(prevSnapshot) {
                window.top.postMessage({connected: -1}, "*");
                rootView.detach();
                setup(prevSnapshot);
            }
        });

        inViewRealm(mainIsland, () => {
            rootView = new RootView(mainIsland.get('root'));
        });

        window.top.postMessage({connected: +1}, "*");
    }

    await setup();

    window.requestAnimationFrame(frame);
    function frame(timestamp) {
        Stats.animationFrame(timestamp);
        Stats.users(controller.users);
        Stats.network(Date.now() - controller.lastReceived);

        if (controller.island) {
            controller.simulate(Date.now() + 200);

            Stats.begin("render");
            controller.island.processModelViewEvents();
            Stats.end("render");
        }

        window.requestAnimationFrame(frame);
    }
}


go();
