if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

/** @template {PartOwner} T */
export default class Part {
    /**
     * @param {T} owner
     * @param {String} partId
    */
    constructor(owner, options={}) {
        this.owner = owner;
        this.partId = options.id || this.constructor.defaultPartId();
        owner.addPart(this);
    }

    static defaultPartId() {
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
        if (this.parts[part.partId]) {
            throw new Error(`A part with id ${part.partId} already exists in the parent ${this.constructor.name}. Please use the "id" option to give this part a unique name`);
        }
        this.parts[part.partId] = part;
    }
}
