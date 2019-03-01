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
        /** @type {Object<string, T>} */
        this.parts = {};
    }

    /** @param {T} part */
    addPart(part) {
        if (this.parts[part.partName]) {
            throw new Error(`A part of name ${part.partName} already exists in the parent ${this.constructor.name}. Please use the "partName" option to give this part a unique name`);
        }
        this.parts[part.partName] = part;
    }
}
