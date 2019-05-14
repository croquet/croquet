// const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
// if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class MockContext {
    constructor() {
        this.filledRects = []; // [{x, y, w, h, style}]
        this.strokeRects = []; // [{x, y, w, h, style}]
        this.drawnStrings = []; // [{x, y, string, font, style}]

        this.fillStyle = 'black';
        this.originX = 0;
        this.originY = 0;
        this.lineWidth = 1;
        this.strokeStyle = 'black';
        this.textAlign = 'left';
        this.textBaseline = 'alphabetic';
        this.savedState = [];
        //[{fillStyle: style, originX, number, originY: number,
        //  lineWidth: number, strokeStyle: style,
        //  textAlign: string, textBaseline: string }]
        this.save();

    }

    makeStateObj() {
        return {fillStyle: this.fillStyle, originX: this.originX, originY: this.originY,
                lineWidth: this.lineWidth, strokeStyle: this.strokeStyle,
                textAlign: this.textAlign, textBaseline: this.textBaseline};
    }

    save() {
        this.savedState.push(this.makeStateObj());
    }

    restore() {
        let state = this.savedState.pop();
        this.fillStyle = state.fillStyle;
        this.originX = state.originX;
        this.originY = state.originY;
        this.lineWidth = state.lineWidth;
        this.strokeWidth = state.strokeWidth;
        this.textAlign = state.textAlign;
        this.textBaseline = state.textBaseline;
    }

    beginPath() {}
    moveTo() {}
    lineTo() {}
    quadraticCurveTo() {}
    closePath() {}

    fill() {
    }
    stroke() {}

    clearRect() {}

    fillRect(x, y, w, h) {
        this.filledRects.push({x: x, y: y, w: w, h: h, style: this.fillStyle});
    }

    strokeRect(x, y, w, h) {
        this.strokeRects.push({x: x, y: y, w: w, h: h, style: this.strokeStyle});
    }

    translate(x, y) {
        this.originX = x;
        this.originY = y;
    }

    fillText(str, left, baseline) {
        this.drawnStrings.push({x: left, y: baseline, string: str, font: this.font, style: this.fillStyle});
    }
}
