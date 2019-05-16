import urlOptions from "./urlOptions";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const StartDate = Date.now();
if (typeof performance === "undefined") window.performance = { now: () => Date.now() - StartDate };

const order = [
    "simulate",
    "update",
    "render",
    "snapshot",
];

const colors = {
    total: "black",
    update: "blue",
    render: "magenta",
    simulate: "yellow",
    snapshot: "green",
    backlog: "red",
    network: "lightgray",
};

const div = !urlOptions.nostats && document.getElementById("stats");
let fps = null;
let canvas = null;
let ctx = null;

if (div) {
    while (div.firstChild) div.removeChild(div.firstChild);

    fps = document.createElement("div");
    fps.style.padding = 5;
    fps.style.background = "rgba(255,255,255,0.2)";
    div.appendChild(fps);

    canvas = document.createElement("canvas");
    canvas.title = Object.entries(colors).map(([k,c])=>`${c}: ${k}`).join('\n');
    canvas.style.width = Math.min(120, window.innerWidth);
    canvas.style.height = 300;
    canvas.width = Math.min(120, window.innerWidth) * window.devicePixelRatio;
    canvas.height = 360 * window.devicePixelRatio;
    div.appendChild(canvas);
    ctx = canvas.getContext("2d");
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

const frames = [];
let maxBacklog = 0;
let connected = false;
let currentFrame = newFrame(0);

function newFrame(now) {
    return {
        start: now,
        total: 0,
        items: {},
        users: 0,
        backlog: 0,
        network: 0,
        connected
    };
}

function endCurrentFrame(timestamp) {
    // add current frame to end
    currentFrame.total = timestamp - currentFrame.start;
    frames.push(currentFrame);

    // get base framerate as minimum of all frames
    const realFrames = frames.slice(1).filter(f => f.total);
    const avgMS = realFrames.map(f => f.total).reduce( (a,b) => a + b, 0) / realFrames.length;
    const newMax = Math.max(...realFrames.map(f => Math.max(f.backlog, f.network)));
    maxBacklog = Math.max(newMax, maxBacklog * 0.98); // reduce scale slowly

    while (frames.length > Math.min(120, window.innerWidth)) frames.shift();

    // show average framerate
    if (!fps.parentElement) { console.warn("who broke the stats div and canvas?"); div.appendChild(fps); div.appendChild(canvas); }
    fps.innerText = `${currentFrame.users} users, ${Math.round(1000/avgMS)} fps,
        backlog: ${currentFrame.backlog < 100 ? '0.0' : (currentFrame.backlog/1000).toFixed(1)} s`;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const oneFrame = 1000 / 60;
    const map = v => (1 - v / oneFrame) * 20 + 60;
    const mapBacklog = v => map(v / Math.max(3000, maxBacklog) * -200) + 5;
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const x = i + 0.5;
        let y = map(0);

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, map(frame.total));
        ctx.strokeStyle = colors[frame.connected ? "total" : "network"];
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x, y);
        y = map(frame.total);
        let ms = 0;
        for (const item of order) {
            if (!frame.items[item]) continue;
            ms += frame.items[item];
            y = map(ms);
            ctx.lineTo(x, y);
            ctx.strokeStyle = colors[item];
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y);
        }

        if (frame.network) {
            ctx.beginPath();
            ctx.moveTo(x, mapBacklog(0));
            ctx.lineTo(x, mapBacklog(frame.network));
            ctx.strokeStyle = colors["network"];
            ctx.stroke();
        }
        if (frame.backlog) {
            ctx.beginPath();
            ctx.moveTo(x, mapBacklog(0));
            ctx.lineTo(x, mapBacklog(frame.backlog));
            ctx.strokeStyle = colors["backlog"];
            ctx.stroke();
        }
    }
    // draw horizontal lines over graph, one per frame
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    for (let y = 0; y < 60; y += oneFrame) {
        ctx.moveTo(0, map(y));
        ctx.lineTo(120, map(y));
        ctx.stroke();
    }

    if (maxBacklog > 500) {
        // draw lines with labels for backlog
        // use log10 to draw lines every 1s, or 10s, or 100s etc.
        const unit = 10 ** Math.floor(Math.log10(Math.max(3000, maxBacklog)));
        ctx.font = '10pt sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 1)';
        for (let i = 1; i < 11; i++) {
            const value = i * unit;
            const y = mapBacklog(value);
            ctx.moveTo(0, y);
            ctx.lineTo(120, y);
            ctx.stroke();
            ctx.fillText(`${value / 1000}s`, 0, y - 5);
            if (value > maxBacklog) break;
        }
    }

    div.style.bottom = mapBacklog(Math.max(1000, maxBacklog)) - 350;
}

const stack = [];

const Stats = {
    animationFrame(timestamp, stats={}) {
        endCurrentFrame(timestamp);
        currentFrame = newFrame(timestamp);
        for (const [key, value] of Object.entries(stats)) this[key](value);
    },
    begin(item) {
        // start inner measurement
        const now = performance.now();
        currentFrame.items[item] = (currentFrame.items[item] || 0) - now;
        // stop outer measurement
        const outer = stack[stack.length - 1];
        if (outer) currentFrame.items[outer] += now;
        stack.push(item);
        return now;
    },
    end(item) {
        // stop inner measurement
        const now = performance.now();
        currentFrame.items[item] += now;
        // start outer measurement
        if (stack.pop() !== item) throw Error("Unmatched stats calls for " + item);
        const outer = stack[stack.length - 1];
        if (outer) currentFrame.items[outer] -= now;
        return now;
    },
    backlog(ms) {
        currentFrame.backlog = Math.max(ms, currentFrame.backlog);
    },
    network(ms) {
        currentFrame.network = ms;
    },
    starvation(ms) {
        currentFrame.network = ms;
    },
    users(users) {
        currentFrame.users = users;
    },
    connected(bool) {
        currentFrame.connected = connected = bool;
    },
};

const NoStats = {};
const Noop = () => {};
for (const key of (Object.keys(Stats))) {
    NoStats[key] = Noop;
}

export default div ? Stats : NoStats;
