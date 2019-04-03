export default class OperationTransformer {
    constructor() {
        this.operations = []; // [{type: <insert or erase>, text: [run], pos: integer, eve}]
        this.timezone = 0;
    }

    length(ary) {
        return ary.map(c => c.text).reduce((s, x) => x.length + s, 0);
    }

    insert(runs, pos) {
        this.operations.push({type: "insert", text: runs, length: this.length(runs), pos: pos, timezone: this.timezone});
    }

    erase(start, end) {
        this.operations.push({type: "erase", start: start, end: end, timezone: this.timezone});
    }

    contents() {
        return this.operations;
    }

    reset() {
        this.operations = [];
    }

    setTimezone(value) {
        this.timezone = value;
    }
}
