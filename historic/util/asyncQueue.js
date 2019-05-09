const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

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
