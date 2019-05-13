import FastPriorityQueue from "fastpriorityqueue";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class PriorityQueue extends FastPriorityQueue {
    poll() {
        const result = super.poll();
        this.array[this.size] = null; // release memory
        return result;
    }

    asArray() {
        const array = [];
        this.forEach(item => array.push(item));
        return array;
    }

    asUnsortedArray() {
        return this.array.slice(0, this.size);
    }
}
