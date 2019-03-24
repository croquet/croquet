
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
let currentFrame = null;

function newFrame(now) {
    currentFrame = {
        start: now,
        items: {},
    };
}
newFrame(performance.now());


export default {
    animationFrame(timestamp) {
        //const now = performance.now();
        this.endCurrentFrame(timestamp);
        newFrame(timestamp);
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
        currentFrame.backlog = ms;
    },
    endCurrentFrame(now) {
        currentFrame.total = now - currentFrame.start;
        frames.push(currentFrame);
        if (frames.length > 120) frames.shift();

        const avgMS = frames.map(f => f.total).reduce( (a,b) => a + b) / frames.length;
        fps.innerText = `${avgMS.toFixed(1)} ms | ${Math.round(1000/avgMS)} fps`;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const map = v => (1 - v / (1000/60)) * 20 + 40;
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
