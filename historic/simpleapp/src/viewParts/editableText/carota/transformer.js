export default class OperationTransformer {
    constructor() {
        this.operations = []; // [{type: <insert or erase>, text: [run], pos: integer, eve}]
        this.timezone = 0;
        this.userID = null;
    }

    length(ary) {
        return ary.map(c => c.text.value).reduce((s, x) => x.length + s, 0);
    }

    insert(runs, pos) {
        if (!this.userID) {return;}
        this.operations.push({user: this.userID, type: "insert", text: runs, length: this.length(runs), pos: pos, timezone: this.timezone});
    }

    erase(start, end) {
        if (!this.userID) {return;}
        this.operations.push({user: this.userID, type: "erase", start: start, end: end, timezone: this.timezone});
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

    setUserID(string) {
        this.userID = string;
    }
}
