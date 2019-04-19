import { Model, View } from "@croquet/teatime";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

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
    init(options={}, id) {
        if (id) {
            this.id = id;
        } else {
            super.init();
        }
        this.forEachPart((part, name) => part.init(options[name], this.id + PART_PATH_SEPARATOR + name));
    }

    load(state, allObjects) {
        this.forEachPart((part, name) => part.load(state[name], allObjects));
    }

    save(state) {
        this.forEachPart((part, name) => {
            state[name] = {};
            part.save(state[name]);
        });
    }
}

export class ViewPart extends WithParts(View) {
    constructor() {
        super();

        /** @type {import('THREE').Object3D | null} */
        this.threeObj = null;
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
