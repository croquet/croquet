import hotreload from "./hotreload.js";

// we include the parcel prelude only so we can get at its source code
import "parcel/lib/builtins/prelude.js";    // eslint-disable-line

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

// this exclude list only works for unmangled moduleIDs during development
// in production, moduleIDs are mangled so essentially all files will be hashed
const exclude = /(index.js|hotreload.js|modules.js|server\/|util\/|view|node_modules)/i;

function allModules() {
    return module.bundle.modules;
}

function allModuleIDs() {
    return Object.keys(allModules());
}

/**
 * find the given module
 * @param {String} id module ID
 * @returns {[Function, Array<String>]} the module function and its list of imports
 */
function moduleWithID(id) {
    return allModules()[id];
}

function functionSource(fn) {
    // some browsers add a space when stringifying a Function
    return ("" + fn).replace(/^.*?\{/s, '').slice(0, -1).trim();
}

/**
 * find source code of a given module (mangled by parcel.js)
 * @param {String} mod module name
 * @returns {String} the module source code
 */
function sourceCodeOf(mod) {
    const source = functionSource(moduleWithID(mod)[0]);
    /*
    // verify that code survives stringification
    const fn = new Function('require', 'module', 'exports', source);
    const src = functionSource(fn);
    if (src !== source) throw Error("source does not match");
    */
    return source;
}

/** find all import names and IDs that are directly imported by a given module */
function namedImportsOf(mod) {
    return moduleWithID(mod)[1];
}


/** return all module IDs that are directly imported by a given module */
function importsOf(mod) {
    return Object.values(namedImportsOf(mod));
}

/** find all files that are (transitively) imported by a given module */
function allImportsOf(mod, filter, result = new Set([mod])) {
    for (const imp of importsOf(mod).filter(filter)) {
        if (!result.has(imp)) {
            result.add(imp, result);
            allImportsOf(imp, filter, result);
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
    return fileHashes[mod] = await hashString(source);
}


export async function hashModelCode(name, moduleID) {
    if (!moduleWithID(moduleID)) throw Error("Module not found: " + moduleID);
    // console.time("Hashing " + name);
    const filter = id => !id.match(exclude);
    const mods = Array.from(allImportsOf(moduleID, filter)).sort();
    // console.log(`${name} Hashing ${moduleID}: ${mods.join(' ')}`);
    const hashes = await Promise.all(mods.map(hashFile));
    const hash = await hashString([name, ...hashes].join('|'));
    // console.timeEnd("Hashing " + name);
    return hash;
}

// naming

const names = {};

function resolveNames(entry) {
    names[entry] = "entry";
    // get all path names
    for (const m of allModuleIDs()) {
        for (const [name, dep] of Object.entries(namedImportsOf(m))) {
            const existing = names[dep] || '';
            const clean = name.replace(/^[./]*/, '');
            if (clean.length > existing) names[dep] = clean;
        }
    }
}

function nameOf(mod) {
    if (names[mod]) return names[mod];
    console.warn('No name for ' + mod);
    return mod;
}

// uploading

async function metadataFor(mod, includeAllFiles=false) {
    const meta = {
        name: nameOf(mod),
        date: (new Date()).toISOString(),
        host: window.location.hostname,
    };
    // add imports
    for (const [key, dep] of Object.entries(moduleWithID(mod)[1])) {
        if (!meta.imports) meta.imports = {};
        meta.imports[key] = await hashFile(dep);   //eslint-disable-line no-await-in-loop
    }
    // add all files if requested
    if (includeAllFiles) {
        meta.files = {};
        for (const id of allModuleIDs()) {
            meta.files[await hashFile(id)] = nameOf(id); //eslint-disable-line no-await-in-loop
        }
    }
    return meta;
}

async function uploadModule(mod, includeAllFiles=false) {
    const hash = await hashFile(mod);
    const url = 'https://db.croquet.studio/files-v1/code';
    try {
        // see if it's already there
        const response = await fetch(`${url}/${hash}.js`, { method: 'HEAD' });
        // if successfull, return
        if (response.ok) return;
    } catch (ex) { /* ignore */ }
    // not found, so try to upload it
    try {
        const meta = await metadataFor(mod, includeAllFiles);
        const code = sourceCodeOf(mod);
        console.log(`uploading "${meta.name}" (${hash}): ${code.length} bytes`);
        fetch(`${url}/${hash}.js`, {
            method: "PUT",
            mode: "cors",
            body: code,
        });
        fetch(`${url}/${hash}.json`, {
            method: "PUT",
            mode: "cors",
            body: JSON.stringify(meta),
        });
    } catch (error) { /* ignore */}
}

/** upload code for all modules */
export async function uploadCode(entryPoint) {
    resolveNames(entryPoint);
    for (const mod of allModuleIDs()) {
        uploadModule(mod, mod === entryPoint);
    }
    // prelude is the Parcel loader code, which loads the entrypoint
    const prelude = moduleWithID(module.id)[1]["parcel/lib/builtins/prelude.js"];
    return { prelude: await hashFile(prelude), entry: await hashFile(entryPoint) };
}
