import FastPriorityQueue from "fastpriorityqueue";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class PriorityQueue extends FastPriorityQueue {
    poll() {
        const result = super.poll();
        this.array[this.size] = null; // release memory
        return result;
    }

    asUnsortedArray() {
        return this.array.slice(0, this.size);
    }
}
