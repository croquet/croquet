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

    addUser(userId) {
        if (this.shapes[userId]) { console.warn("shape already exists for joining user", userId); return; }
        const shape = Shape.create();
        shape.hash = "";
        for (let i = 0; i < 16; i++) shape.hash += (this.random() * 16 | 0).toString(16);
        this.shapes[userId] = shape;
        this.subscribe(shape.id, 'path-extended', this.testForIntersect);
        this.publish(this.id, 'shape-added', shape);
        this.publish(this.id, `user-shape-${userId}`, shape);
    }

    removeUser(userId) {
        const shape = this.shapes[userId];
        if (!shape) { console.warn("shape not found for leaving user", userId); return; }
        delete this.shapes[userId];
        this.unsubscribe(shape.id, 'path-extended');
        this.publish(this.id, 'shape-removed', shape);
    }

    testForIntersect(data) {
        const { id: extendedId, segment } = data;
        // order doesn't matter, for now
        Object.keys(this.shapes).forEach(userId => {
            const shape = this.shapes[userId];
            shape.testForIntersect(segment, shape.id === extendedId);
            });
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
        this.path = [ this.pos.slice() ];
        this.subscribe(this.id, "move-to", this.moveTo); // published by view
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
        const path = this.path;
        path.push(this.pos.slice());
        while (this.path.length > 50) path.shift();
        const segment = [path[path.length - 2], path[path.length - 1]];
        this.publish(this.id, 'path-extended', { id: this.id, segment });
        this.publish(this.id, 'pos-changed', this.pos);
    }

    testForIntersect(segment, isOwnPath) {
        // from Fernando van Loenhout's fiddle at https://jsfiddle.net/ferrybig/eokwL9mp/
        // referenced from https://stackoverflow.com/questions/563198/how-do-you-detect-where-two-line-segments-intersect
        function computeIntersection(a, b, c, d) {
            const h1 = computeH(a, b, c, d);
            const h2 = computeH(c, d, a, b);
            const isParallel = isNaN(h1) || isNaN(h2);
            const f = { x: d.x - c.x, y: d.y - c.y };
            return {
                intersection: h1 >= 0 && h1 <= 1 && h2 >= 0 && h2 <= 1,
                isParallel,
                point: isParallel ? undefined :
                    // C + F*h
                    {
                        x: c.x + f.x * h1,
                        y: c.y + f.y * h1,
                    },
                };
        }
        function computeH(a, b, c, d) {
            // E = B-A = ( Bx-Ax, By-Ay )
            const e = { x: b.x - a.x, y: b.y - a.y }
            // F = D-C = ( Dx-Cx, Dy-Cy )
            const f = { x: d.x - c.x, y: d.y - c.y }
            // P = ( -Ey, Ex )
            const p = { x: -e.y, y: e.x }
            // h = ( (A-C) * P ) / ( F * P )
            const intersection = f.x * p.x + f.y * p.y;
            if (intersection === 0) {
                // Parallel lines
                return NaN;
            }
            return ((a.x - c.x) * p.x + (a.y - c.y) * p.y) / intersection;
        }

        const path = this.path;
        const otherStart = { x: segment[0][0], y: segment[0][1] }, otherEnd = { x: segment[1][0], y: segment[1][1] };
        let chopPoint = null;
        let segEnd = path.length - (isOwnPath ? 3 : 1);
        for (; segEnd >= 1; segEnd--) {
            const thisEnd = { x: path[segEnd][0], y: path[segEnd][1] };
            const thisStart = { x: path[segEnd-1][0], y: path[segEnd-1][1] };
            const intersect = computeIntersection(otherStart, otherEnd, thisStart, thisEnd);
            if (intersect.intersection && intersect.point) {
                chopPoint = [ intersect.point.x, intersect.point.y ];
                break;
            }
        }

        if (chopPoint) {
            path[segEnd - 1] = chopPoint;
            path.splice(0, segEnd - 1);
        }
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
        const bouncer = BouncingShape.create({pos: [500, 500], color: "white"});
        this.shapes["bounce"] = bouncer;
        this.subscribe(bouncer.id, 'path-extended', this.testForIntersect);
    }
}
Shapes.register("Shapes");


////// Views /////

const WORLD_SIZE = 1100;  // model uses a virtual 1000x1000 space within an 1100x1100 element
let SCALE = 1;
let OFFSETX = 50;         // top-left corner of view, plus half shape width
let OFFSETY = 50;         // top-left corner of view, plus half shape height

const TOUCH ='ontouchstart' in document.documentElement;

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
        this.setUpTrailSVG();
        Object.values(model.shapes).forEach(shape => this.attachShape(shape));
        this.subscribe(model.id, 'shape-added', this.attachShape);
        this.subscribe(model.id, 'shape-removed', this.detachShape);
        this.subscribe(model.id, `user-shape-${this.viewId}`, this.gotUserShape);
        this.future(500).refreshPaths();
    }

    setUpTrailSVG() {
        this.svg = d3.select(this.element).append("svg")
            .attr("viewBox", [0, 0, WORLD_SIZE, WORLD_SIZE]);
    }

    refreshPaths() {
        const shapes = this.model.shapes;
        const allSeries = this.svg.selectAll("g")
            .data(Object.keys(shapes), userId => userId);
        allSeries.enter().append("g")
            .append("path")
                .attr("fill", "none")
                .attr("stroke", userId => shapes[userId].color)
                .attr("stroke-width", "8")
                .datum(id => shapes[id].path);
        allSeries.selectAll("path")
            .attr("d", d3.line()
                .x(d => d[0] + 50)
                .y(d => d[1] + 50));
        allSeries.exit().remove();

        this.future(100).refreshPaths();
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
    }

    detachShape(shape) {
        const el = document.getElementById(shape.id);
        if (el) el.view.detach();
    }

    resize() {
        const size = Math.max(50, Math.min(window.innerWidth, window.innerHeight));
        SCALE = size / WORLD_SIZE;
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
        const move = (moveDetails, sourceEvt = moveDetails) => {
            sourceEvt.preventDefault();
            const newX = moveDetails.clientX - OFFSETX;
            const newY = moveDetails.clientY - OFFSETY;

            // never announce a zero-length move
            if (newX === x && newY === y) return;

            x = newX;
            y = newY;

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
                el.ontouchmove = null;
            };
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
}

class ShapeView extends View {

    constructor(model) {
        super(model);
        const el = this.element = document.createElement("div");
        el.className = model.type;
        el.id = model.id;
        el.style.backgroundColor = model.color;
        if (model.hash) el.style.backgroundImage = `url("https://www.gravatar.com/avatar/${model.hash}?d=robohash&f=y&s=100")`;
        this.subscribe(model.id, { event: 'pos-changed', handling: "oncePerFrame" }, this.move); // published by model
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

    const session = await Session.join(`tails-${App.autoSession("q")}`, Shapes, ShapesView, { step: "manual", tps: TPS });
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
