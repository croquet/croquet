export default class AsyncQueue {
    constructor() {
        this.values = [];
        this.resolves = [];
    }

    async next() {
        if (this.values.length > 0) this.values.shift();
        return new Promise(resolve => this.resolves.push(resolve));
    }

    put(value) {
        const resolve = this.resolves.shift();
        if (resolve) resolve(value);
        else this.values.push(value);
    }

    peek() {
        return this.values[0];
    }

    nextNonBlocking() {
        return this.values.shift();
    }
}
