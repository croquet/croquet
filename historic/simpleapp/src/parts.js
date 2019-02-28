/** @template {PartOwner} T */
export default class Part {
    /**
     * @param {T} owner
     * @param {String} partName
    */
    constructor(owner, options={}) {
        this.owner = owner;
        this.partName = options.partName || this.constructor.defaultPartName();
        owner.addPart(this);
    }

    static defaultPartName() {
        const name = this.name.replace("Part", "");
        return name.charAt(0).toLowerCase() + name.slice(1);
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
