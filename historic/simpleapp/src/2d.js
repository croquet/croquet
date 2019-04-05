import Island, { connectToReflector, Controller, addMessageTranscoder } from "./island.js";
import Model from "./model.js";
import View from "./view.js";
import Stats from "./util/stats.js";

const THROTTLE = 1000 / 60;

let SCALE = 1; // model uses virtual 1000x1000 space

addMessageTranscoder('*', a => a, a => a);

export class Root extends Model {

    constructor(state) {
        super(state);
        this.island.set('root', this);
        this.children = [];
    }

    restoreObjectReferences(state, objectsByID) {
        this.children = state.children.map(id => objectsByID[id]);
    }

    toState(state) {
        super.toState(state);
        state.children = this.children.map(child => child.id);
    }

    // non-inherited methods below

    add(child) {
        this.children.push(child);
        this.publish(this.id, null, 'child-added', child.id);
    }

}


export class Shape extends Model {

    constructor(state={}) {
        super(state);
        this.island.set('text', this);
        const r = max => Math.floor(max * this.island.random());
        this.type = state.type || 'circle';
        this.color = state.color || `hsl(${r(360)},${r(50)+50}%,50%)`;
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
        this.pos[0] = Math.max(0, Math.min(1000, this.pos[0] + dx));
        this.pos[1] = Math.max(0, Math.min(1000, this.pos[1] + dy));
        this.publish(this.id, null, 'pos-changed', this.pos);
    }
}


class RootView extends View {

    attach(model) {
        super.attach(model);
        this.element = document.createElement("div");
        this.element.className = "root";
        this.resize();
        document.body.appendChild(this.element);
        window.onresize = () => this.resize();
        model.children.forEach(child => this.attachChild(child.id));
        this.subscribePart(this.modelId, null, 'child-added', null, "attachChild", true);
    }

    // non-inherited methods below

    attachChild(childID) {
        const model = this.island.modelsById[childID];
        const view = new ShapeView(this.island);
        view.attach(model);
        this.element.appendChild(view.element);
    }

    resize() {
        const size = Math.max(200, Math.min(window.innerWidth, window.innerHeight) - 20);
        SCALE = size / 1100;
        this.element.style.transform = `translate(${(window.innerWidth - size) / 2}px,${10}px) scale(${SCALE})`;
        this.element.style.transformOrigin = "0 0";
    }

}


class ShapeView extends View {

    attach(model) {
        super.attach(model);
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
                    this.model.moveBy(dx / SCALE, dy / SCALE);
                    dx = dy = 0;
                    timeStamp = evt.timeStamp;
                }
            };
            document.onmouseup = () => {
                document.onmouseup = null;
                document.onmousemove = null;
            };
        };
        this.subscribePart(this.modelId, null, 'pos-changed', null, "move", true);
        this.move(model.pos);
    }

    // non-inherited methods below

    move(pos) {
        this.element.style.left = pos[0];
        this.element.style.top = pos[1];
    }

}


async function go() {
    connectToReflector("wss://dev1.os.vision/reflector-v1");

    const controller = new Controller();
    const island = await controller.createIsland("2d", {
        moduleID: module.id,
        creatorFn(state) {
            return new Island(state, () => {
                const root = new Root();
                for (let i = 0; i < 100; i++) {
                    root.add(new Shape());
                }
            });
        }
    });

    const rootView = new RootView(island);
    rootView.attach(island.get('root'));


    window.requestAnimationFrame(frame);
    function frame(timestamp) {
        Stats.animationFrame(timestamp);
        Stats.users(controller.users);
        Stats.network(Date.now() - controller.lastReceived);

        controller.simulate(Date.now() + 200);

        Stats.begin("render");
        island.processModelViewEvents();
        Stats.end("render");

        window.requestAnimationFrame(frame);
    }
}


go();
