import Hashids from "hashids";
import hotreload from "./hotreload";

// we include the parcel prelude only so we can get at its source code
import "parcel/src/builtins/prelude";    // eslint-disable-line

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/*
We use the Parcel module system to inspect our own source code:

module.bundle.modules = {
    id: [<Module>, <Imports>],
}

<Module> = function(require,module,exports) {
    ... module code (as pre-processed by Parcel)...
}

<Imports> = {
    path1: id1,
    path2: id2,
}

where "Module" is the module source code wrapped in a function definition
and "Imports" is a dictionary mapping import paths to other module IDs.

A minor complication is that module IDs look like file paths in
development build, but are replaced by random short identifiers in
production. That's why we must not ascribe any meaning to those IDs.
*/

const entryPointName = "entry";
const htmlName = "index.html";

// grab HTML source now before the DOM gets modified
const scripts = Array.from(document.getElementsByTagName('script')).map(script => script.outerHTML);
if (scripts.length > 1) console.warn("More than one script tag!");
const rawHTML = document.getElementsByTagName('html')[0].outerHTML;
// replace main script tag (which changes all the time)
const htmlSource = rawHTML.replace(scripts[0], `<script src="${entryPointName}"></script>`);
if (!htmlSource.includes(entryPointName)) console.error("Entry point substitution failed!");


const BASE_URL = baseUrl('code');

// we special-case 'croquet.studio' and 'localhost' which have their own server directories
// all others share a directory but prefix the file name wth the host name
export function baseUrl(what='code') {
    const hostname = window.location.hostname;
    const isSpecial = ['croquet.studio', 'localhost'].includes(hostname);
    const host = isSpecial ? hostname : "other";
    const prefix = isSpecial ? "" : `${hostname}/`;
    return `https://db.croquet.studio/files-v1/${host}/${what}/${prefix}`;
}

// This exclude list only works for unmangled moduleIDs during development.
// In production, moduleIDs are mangled so essentially all files will be hashed.
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
    // strip the Function(args) { ...source ... } to just the source
    const str = "" + fn;
    const openingBrace = str.indexOf('{');
    const closingBrace = str.lastIndexOf('}');
    return str.slice(openingBrace + 1, closingBrace).trim();
}

/**
 * find source code of a given module (mangled by parcel.js)
 * @param {String} mod module name
 * @returns {String} the module source code
 */
function sourceCodeOf(mod) {
    if (mod === htmlName) return htmlSource; //  little hack
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
const hashIds = new Hashids('croquet');

async function hashBuffer(buffer) {
    const bits = await window.crypto.subtle.digest("SHA-256", buffer);
    const data = new DataView(bits);
    // condense 256 bit hash into 128 bit hash by XORing first half and last half
    const words = [];
    for (let i = 0; i < 16; i += 4) {
        words.push((data.getUint32(i) ^ data.getUint32(i + 16)) >>> 0);
    }
    // use hashIds to generate a shorter encoding than hex
    return hashIds.encode(words);
}

const encoder = new TextEncoder();

async function hashString(string) {
    const buffer = encoder.encode(string);
    return hashBuffer(buffer);
}

const fileHashes = {};

hotreload.addDisposeHandler("fileHashes", () => { for (const f of (Object.keys(fileHashes))) delete fileHashes[f]; });

export async function hashFile(mod) {
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
const assets = [];

function resolveNames(entry) {
    names[entry] = entryPointName;
    // get all path names
    for (const m of allModuleIDs()) {
        for (const [name, id] of Object.entries(namedImportsOf(m))) {
            const existing = names[id] || '';
            const clean = name.replace(/^[./]*/, '');
            if (clean.length > existing) names[id] = clean;
            if (clean.match(/^assets\//)) assets.push({id, code: sourceCodeOf(id)});
        }
    }
}

function nameOf(mod) {
    if (names[mod]) return names[mod];
    // "hmr-runtime.js" is injected by parcel in dev builds
    if (!mod.endsWith("hmr-runtime.js")) console.warn('No name for ' + mod);
    return mod;
}

// uploading

function createMetadata(name) {
    return {
        name,
        date: (new Date()).toISOString(),
        host: window.location.hostname,
    };
}

async function metadataFor(mod, includeAllFiles=false) {
    const meta = createMetadata(nameOf(mod));
    // add imports
    for (const [key, id] of Object.entries(moduleWithID(mod)[1])) {
        if (!meta.imports) meta.imports = {};
        meta.imports[key] = await hashFile(id);   //eslint-disable-line no-await-in-loop
    }
    // add all files if requested
    if (includeAllFiles) {
        meta.files = {};
        for (const id of allModuleIDs()) {
            meta.files[await hashFile(id)] = nameOf(id); //eslint-disable-line no-await-in-loop
        }
        meta.html = await hashFile(htmlName);
    }
    return meta;
}

async function uploadFile(mod, meta, ext=".js") {
    const hash = await hashFile(mod);
    const body = sourceCodeOf(mod);
    try {
        // see if it's already there
        const response = await fetch(`${BASE_URL}${hash}.json`, { method: 'HEAD' });
        // if successfull, return
        if (response.ok) return;
    } catch (ex) { /* ignore */ }
    // not found, so try to upload it
    try {
        console.log(`uploading "${meta.name}" (${hash}): ${body.length} bytes`);
        await fetch(`${BASE_URL}${hash}${ext}`, {
            method: "PUT",
            mode: "cors",
            body,
        });
        // uplod JSON only when uploading JS was succesful
        fetch(`${BASE_URL}${hash}.json`, {
            method: "PUT",
            mode: "cors",
            body: JSON.stringify(meta),
        });
    } catch (error) { /* ignore */}
}

async function uploadModule(mod, includeAllFiles=false) {
    const meta = await metadataFor(mod, includeAllFiles);
    uploadFile(mod, meta);
}

async function uploadHTML() {
    const meta = createMetadata(htmlName);
    uploadFile(htmlName, meta, ".html");
}

/* we don't want to fetch assets to upload for now
async function uploadAsset(asset) {
    const src = sourceCodeOf(asset.id);
    const match = src.match(/^module.exports ?= ?"(.*\.(.*))";$/);
    if (match) {
        const [_, url, ext] = match;
        console.log(asset.id, url, ext);
    } else {
        // not a url (probably JSON)
    }
}
*/

/** upload code for all modules */
export async function uploadCode(entryPoint) {
    resolveNames(entryPoint);
    uploadHTML();
    for (const mod of allModuleIDs()) {
        uploadModule(mod, mod === entryPoint);
    }
    // for (const asset of assets) {
    //     uploadAsset(asset);
    // }
    // prelude is the Parcel loader code, which loads the entrypoint
    const prelude = moduleWithID(module.id)[1]["parcel/src/builtins/prelude"];
    return { base: BASE_URL, prelude: await hashFile(prelude), entry: await hashFile(entryPoint), html: await hashFile(htmlName) };
}
