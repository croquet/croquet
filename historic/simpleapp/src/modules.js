import hotreload from "./hotreload.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

// this exclude list only works for unmangled moduleIDs during development
// in production, moduleIDs are mangled so essentially all files will be hashed
const exclude = /(index.js|hotreload.js|modules.js|server\/|util\/|view|node_modules)/i;

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

async function hashBuffer(buffer) {
    const bits = await window.crypto.subtle.digest("SHA-256", buffer);
    // condense 256 bit hash into 128 bit hash by XORing first half and last half
    const bytes = new Uint8Array(bits);
    let hash = '';
    for (let i = 0; i < 16; i++) {
        hash += (bytes[i] ^ bytes[i + 16]).toString(16).padStart(2, '0');
    }
    return hash;
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


export async function hashModelCode(name, moduleID) {
    if (!moduleNamed(moduleID)) throw Error("Module not found: " + moduleID);
    // console.time("Hashing " + name);
    const filter = id => !id.match(exclude);
    const mods = Array.from(allDependenciesOf(moduleID, filter)).sort();
    // console.log(`${name} Hashing ${moduleID}: ${mods.join(' ')}`);
    const hashes = await Promise.all(mods.map(hashFile));
    const hash = await hashString([name, ...hashes].join('|'));
    // console.timeEnd("Hashing " + name);
    return hash;
}
