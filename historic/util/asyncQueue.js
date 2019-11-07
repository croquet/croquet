export default class AsyncQueue {
    constructor() {
        this.values = [];
        this.resolves = [];
    }

    async next() {
        if (this.values.length > 0) return this.values.shift();
        return new Promise(resolve => this.resolves.push(resolve));
    }

    put(value) {
        const resolve = this.resolves.shift();
        if (resolve) resolve(value);
        else this.values.push(value);
    }

    putAll(values) {
        for (const value of values) this.put(value);
    }

    peek() {
        return this.values[0];
    }

    nextNonBlocking() {
        return this.values.shift();
    }

    allNonBlocking() {
        if (this.values.length === 0) return [];
        const values = this.values;
        this.values = [];
        return values;
    }

    get size() { return this.values.length - this.resolves.length; }
}
