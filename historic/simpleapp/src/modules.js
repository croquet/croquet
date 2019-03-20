import hotreload from "./hotreload.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** prefix to identify our own source files, as opposed to node modules etc */
const prefix = "../src/";
if (prefix + 'modules.js' !== module.id) throw Error("source structure changed!");
const exclude = /(index.js|hotreload.js|modules.js|server\/|util\/|view)/i;

/**
 * find the given module
 * @param {String} mod module name
 * @returns {[Function, Array<String>]} the module function and its list of imports
 */
function moduleNamed(mod) {
    return module.bundle.modules[mod];
}

/**
 * find source code of a given module (mangled by parcel.js)
 * @param {String} mod module name
 * @returns {String} the module source code
 */
function sourceCodeOf(mod) {
    return "" + moduleNamed(mod)[0];
}

/** find all files that are directly imported by a given module */
function dependenciesOf(mod) {
    return Object.values(moduleNamed(mod)[1]);
}

/** find all files that are (transitively) imported by a given module */
function allDependenciesOf(mod, filter, result = new Set([mod])) {
    for (const imp of dependenciesOf(mod).filter(filter)) {
        if (!result.has(imp)) {
            result.add(imp, result);
            allDependenciesOf(imp, filter, result);
        }
    }
    return result;
}


// hashing

const toHex = bits => (new Uint8Array(bits))
    .reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');

async function hashBuffer(buffer) {
    const hash = await window.crypto.subtle.digest("SHA-256", buffer);
    return toHex(hash);
}

const encoder = new TextEncoder();

async function hashString(string) {
    const buffer = encoder.encode(string);
    return hashBuffer(buffer);
}

let fileHashes = {};
hotreload.addDisposeHandler("fileHashes", () => fileHashes = {});

async function hashFile(mod) {
    if (fileHashes[mod]) return fileHashes[mod];
    const source = sourceCodeOf(mod);
    return hashString(source);
}


export async function hashModelCode(filePath) {
    if (!moduleNamed(prefix + filePath)) throw Error("Module not found: " + prefix + filePath);
    const filter = name=>name.startsWith(prefix) && !name.match(exclude);
    const mods = allDependenciesOf(prefix + filePath, filter);
    //console.log("hashing:", mods);
    const hashes = await Promise.all(Array.from(mods).sort().map(mod => hashFile(mod)));
    const hash = await hashString(filePath + hashes.join('|'));
    return hash;
}
