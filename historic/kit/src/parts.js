import { Model, View, currentRealm } from "@croquet/teatime";

export const MODEL_PATH_SEPARATOR = "#";
export const PART_PATH_SEPARATOR = ".";
export const PATH_PART_SEPARATOR_SPLIT_REGEXP = /\.(.+)/;

/**
 * @typedef {string} PartPath
 * */

const WithParts = BaseClass => class Part extends BaseClass {
    constructor(...args) {
        super(...args);
        /** @type {Object<string, Part>} */
        this.parts = {};
    }

    /** Get a (potentially nested) sub part
     * @arg {PartPath} path
     * @returns {Part} */
    lookUp(path) {
        if (!path) return this;
        const [first, rest] = path.split(PATH_PART_SEPARATOR_SPLIT_REGEXP);
        if (rest) {
            return this.parts[first].lookUp(rest);
        }
        return this.parts[first];
    }

    /** Get an absolute sub part id from a relative path
     * @arg {PartPath} relativePath
     * @returns {string}
    */
    absoluteId(relativePath) {
        return this.lookUp(relativePath).id;
    }

    forEachPart(fn) {
        for (const [name, part] of Object.entries(this.parts)) {
            fn(part, name);
        }
    }
};

export class ModelPart extends WithParts(Model) {
    init(options={}, idForPart) {
        const isModel = !idForPart;
        if (isModel) {
            super.init();
        } else {
            this.id = idForPart;
            this.__realm = currentRealm();
        }
        this.forEachPart((part, name) => {
            const partID = this.id + (isModel ? MODEL_PATH_SEPARATOR : PART_PATH_SEPARATOR) + name;
            part.init(options[name], partID);
            if (part.id !== partID) throw Error(`Did ${part} forget to call super.init(options, id)?`);
        });
    }
}

export class ViewPart extends WithParts(View) {
    constructor() {
        super();

        /** @type {import('THREE').Object3D | null} */
        this.threeObj = null;
    }

    forwardDimensionChange() {
        for (const part of Object.values(this.parts)) {
            this.subscribe(part.id, { event: ViewEvents.changedDimensions, handling: "oncePerFrame" }, () => this.publish(this.id, ViewEvents.changedDimensions));
        }
    }

    /** @returns {import('THREE').Object3D[]} */
    threeObjs() {
        if (this.threeObj) {
            return [this.threeObj];
        }

        const threeObjs = [];
        for (const part of Object.values(this.parts)) {
            if (part instanceof ViewPart) {
                threeObjs.push(...part.threeObjs());
            }
        }
        return threeObjs;
    }
}

export const ViewEvents = {
    changedDimensions: "view-changedDimensions"
};
