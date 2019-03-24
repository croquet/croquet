
const StartDate = Date.now();
if (typeof performance === "undefined") window.performance = { now: () => Date.now() - StartDate };

const div = document.createElement("div");
div.style.position = "absolute";
div.style.right = 0;
div.style.width = 125;
document.body.appendChild(div);

const fps = document.createElement("div");
div.appendChild(fps);

const canvas = document.createElement("canvas");
canvas.width = canvas.style.width = 120;
canvas.height = canvas.style.height = 360;
div.appendChild(canvas);
const ctx = canvas.getContext("2d");
ctx.lineWidth = 1;

const order = [
    "simulate",
    "events",
    "render",
];

const colors = {
    total: "black",
    events: "blue",
    render: "yellow",
    simulate: "green",
    backlog: "red",
};


const frames = [];
let currentFrame = newFrame(0);

function newFrame(now, opts={}) {
    return {
        start: now,
        total: 0,
        items: {},
        backlog: 0,
        users: 0,
        ...opts
    };
}

export default {
    animationFrame(timestamp) {
        this.endCurrentFrame(timestamp);
        currentFrame = newFrame(timestamp);
    },
    begin(item) {
        const now = performance.now();
        currentFrame.items[item] = (currentFrame.items[item] || 0) - now;
    },
    end(item) {
        const now = performance.now();
        currentFrame.items[item] += now;
    },
    backlog(ms) {
        currentFrame.backlog = Math.max(ms, currentFrame.backlog);
    },
    users(users) {
        currentFrame.users = users;
    },
    endCurrentFrame(timestamp) {
        // add current frame to end
        currentFrame.total = timestamp - currentFrame.start;
        frames.push(currentFrame);

        // get base framerate as minimum of all frames
        const realFrames = frames.filter(f => f.total);
        const minMS = Math.min(...realFrames.map(f => f.total));

        // if this frame took multiple frames, add empty frames to graph
        const n = Math.min(3, Math.round(currentFrame.total / minMS));
        for (let i = 1; i < n; i++) frames.push(newFrame(timestamp, {backlog: currentFrame.backlog}));

        while (frames.length > 120) frames.shift();

        // show average framerate
        const avgMS = realFrames.map(f => f.total).reduce( (a,b) => a + b) / realFrames.length;
        fps.innerText = `${currentFrame.users} users, ${Math.round(1000/avgMS)} fps`;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const map = v => (1 - v / minMS) * 20 + 40;
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const x = i + 0.5;
            let y = map(0);

            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, map(frame.total));
            ctx.strokeStyle = colors["total"];
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

            if (frame.backlog) {
                ctx.moveTo(x, map(-5));
                ctx.lineTo(x, map(-5 -frame.backlog / 10));
                ctx.strokeStyle = colors["backlog"];
                ctx.stroke();
            }
        }
    }
};
