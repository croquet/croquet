const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const PART_PATH_SEPARATOR = ".";
const PATH_PART_SEPARATOR_SPLIT_REGEXP = /\.(.+)/;

/** @typedef {string} PartPath */

/** @template {Part} SubPart */
export default class Part {
    constructor() {
        /** @type {Object<string, SubPart>} */
        this.parts = {};
        this.id = null;
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
}
