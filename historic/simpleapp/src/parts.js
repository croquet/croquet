/** @template {PartOwner} T */
export default class Part {
    /**
     * @param {T} owner
     * @param {String} partName
    */
    constructor(owner, partName) {
        this.owner = owner;
        this.partName = partName;
        owner.addPart(this);
    }
}

/** @template {Part} T */
export class PartOwner {
    constructor() {
        /** @type {{[string]: T}} */
        this.parts = {};
    }

    /** @param {T} part */
    addPart(part) {
        this.parts[part.partName] = part;
    }
}
