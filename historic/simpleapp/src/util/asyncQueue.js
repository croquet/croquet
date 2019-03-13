export default class AsyncQueue {
    constructor() {
        this.values = [];
        this.resolves = [];
    }

    async next() {
        const value = this.values.shift();
        if (value) return value;
        return new Promise(resolve => this.resolves.push(resolve));
    }

    put(value) {
        const resolve = this.resolves.shift();
        if (resolve) resolve(value);
        else this.values.push(value);
    }

    nextNonBlocking() {
        return this.values.shift();
    }
}
