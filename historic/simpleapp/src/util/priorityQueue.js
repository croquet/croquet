import FastPriorityQueue from "fastpriorityqueue";

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
