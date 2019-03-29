const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const StartDate = Date.now();
if (typeof performance === "undefined") window.performance = { now: () => Date.now() - StartDate };

const order = [
    "simulate",
    "update",
    "render",
];

const colors = {
    total: "black",
    update: "blue",
    render: "magenta",
    simulate: "yellow",
    backlog: "red",
};

const div = document.createElement("div");
div.style.position = "absolute";
div.style.right = 0;
div.style.width = 125;
div.style.background = "rgba(255,255,255,0.2)";
document.body.appendChild(div);

const fps = document.createElement("div");
fps.style.padding = 5;
fps.style.background = "rgba(255,255,255,0.2)";
div.appendChild(fps);

const canvas = document.createElement("canvas");
canvas.title = Object.entries(colors).map(([k,c])=>`${c}: ${k}`).join('\n');
canvas.style.width = 120;
canvas.style.height = 300;
canvas.width = 120 * window.devicePixelRatio;
canvas.height = 360 * window.devicePixelRatio;
div.appendChild(canvas);
const ctx = canvas.getContext("2d");
ctx.scale(window.devicePixelRatio, window.devicePixelRatio);


const frames = [];
let currentFrame = newFrame(0);

function newFrame(now) {
    return {
        start: now,
        total: 0,
        items: {},
        backlog: 0,
        users: 0,
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
        const avgMS = realFrames.map(f => f.total).reduce( (a,b) => a + b) / realFrames.length;
        const maxBacklog = Math.max(1000, ...realFrames.map(f => f.backlog));

        while (frames.length > 120) frames.shift();

        // show average framerate
        fps.innerText = `${currentFrame.users} users, ${Math.round(1000/avgMS)} fps,
            backlog: ${currentFrame.backlog < 100 ? '0.0' : (currentFrame.backlog/1000).toFixed(1)} s`;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const oneFrame = 1000 / 60;
        const map = v => (1 - v / oneFrame) * 20 + 60;
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
                ctx.lineTo(x, map(-5 -frame.backlog / maxBacklog * 60));
                ctx.strokeStyle = colors["backlog"];
                ctx.stroke();
            }
        }
    }
};
