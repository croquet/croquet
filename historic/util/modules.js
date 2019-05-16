import Hashids from "hashids";
import hotreloadEventManager from "./hotreloadEventManager";
import urlOptions from "./urlOptions";

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

// persistent storage of developer settings
export function croquetDev(key, defaultValue=undefined, initFn=null) {
    const dev = JSON.parse(localStorage.croquetDev || "{}");
    if (key in dev) return dev[key];
    if (initFn) {
        dev[key] = initFn();
        if (dev[key] !== defaultValue) localStorage.croquetDev = JSON.stringify(dev);
        return dev[key];
    }
    return defaultValue;
}

// developer user name
if (urlOptions.has("debug", "user", "localhost")) {
    croquetDev("user", "", () => {
        // eslint-disable-next-line no-alert
        return (window.prompt("Please enter developer name (localStorage.croquetDev.user)") || "").toLowerCase();
    });
}

const BASE_URL = baseUrl('code');

// we special-case 'croquet.studio' and 'localhost' which have their own server directories
// all others share a directory but prefix the file name wth the host name
export function baseUrl(what='code') {
    const user = croquetDev("user");
    const host = user ? `dev/${user}` : window.location.hostname;
    return `https://db.croquet.studio/files-v1/${host}/${what}/`;
}

function allModules() {
    return module.bundle.modules;
}

function allModuleIDs() {
    // ignore parcel runtime which is only used in dev builds and
    // changes constantly (because it contains a dynamic port number)
    return Object.keys(allModules()).filter(id => !id.endsWith('hmr-runtime.js'));
}

/**
 * find the given module
 * @param {String} id module ID
 * @returns {[Function, Array<String>]} the module function and its list of imports
 */
function moduleWithID(id) {
    return allModules()[id];
}

function resolveImport(id, name) {
    return moduleWithID(id)[1][name] || name;
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

/** find all modules that directly import a given module */
function allImportersOf(mod) {
    return allModuleIDs().filter(m => importsOf(m).includes(mod));
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

export async function hashString(string) {
    const buffer = encoder.encode(string);
    return hashBuffer(buffer);
}

const fileHashes = {};

hotreloadEventManager.addDisposeHandler("fileHashes", () => { for (const f of (Object.keys(fileHashes))) delete fileHashes[f]; });

export async function hashFile(mod) {
    if (fileHashes[mod]) return fileHashes[mod];
    const source = sourceCodeOf(mod);
    return fileHashes[mod] = await hashString(source);
}


export async function hashNameAndCode(name) {
    const mods = allModuleIDs().sort();
    // console.log(`${name} Hashing ${moduleID}: ${mods.join(' ')}`);
    const hashes = await Promise.all(mods.map(hashFile));
    const hash = await hashString([name, ...hashes].join('|'));
    // console.timeEnd("Hashing " + name);
    return hash;
}

// naming

const names = {};
const assets = [];

// resolve names now, before deduplicating below
resolveNames();

function resolveNames() {
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
    console.warn('No name for ' + mod);
    return mod;
}

// uploading

function createMetadata(name) {
    const meta = {
        name,
        date: (new Date()).toISOString(),
        host: window.location.hostname,
    };
    if (croquetDev("user")) meta.devUser = croquetDev("user");
    return meta;
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
        console.log(`uploading "${meta.name}${meta.name.includes('.') ? '' : ext}" (${hash}): ${body.length} bytes`);
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
    names[entryPoint] = entryPointName;
    uploadHTML();
    for (const mod of allModuleIDs()) {
        uploadModule(mod, mod === entryPoint);
    }
    // for (const asset of assets) {
    //     uploadAsset(asset);
    // }
    return { base: BASE_URL, entry: await hashFile(entryPoint), html: await hashFile(htmlName) };
}


// work around https://github.com/parcel-bundler/parcel/issues/1838

// deduplicate this, every module that directly imports this one,
// plus "hotreloadEventManager" which cannot import this because that would be cyclic
deduplicateImports([module.id, ...allImportersOf(module.id), resolveImport(module.id, "./hotreloadEventManager")]);

export function deduplicateImports(mods) {
    const modSources = mods.map(m => [m, sourceCodeOf(m)]);
    const dupes = new Map();
    // find duplicates of given modules by comparing source code
    for (const dupe of allModuleIDs()) {
        const dupeSource = sourceCodeOf(dupe);
        for (const [mod, modSource] of modSources) {
            if (dupeSource === modSource && dupe !== mod) dupes.set(dupe, mod);
        }
    }
    //for (const [dupe, mod] of dupes) console.log("Found dupe of", mod, dupe);
    // replace references to dupes with the actual modules
    const b = module.bundle;
    const later = new Map();
    const fixed = new Set();
    for (const m of Object.values(b.modules)) {
        for (const [n, dupe] of Object.entries(m[1])) {
            const mod = dupes.get(dupe);
            if (mod && b.modules[mod]) {
                if (b.cache[dupe]) later.set(mod, dupe);   // dupe already loaded
                else {
                    m[1][n] = mod;                         // use mod
                    delete b.modules[dupe];                // delete dupe
                    fixed.add(`${nameOf(mod)} vs. ${nameOf(dupe)} (${n})`);
                }
            }
        }
    }
    for (const m of Object.values(b.modules)) {
        for (const [n, mod] of Object.entries(m[1])) {
            const dupe = later.get(mod);
            if (dupe && b.modules[dupe]) {
                m[1][n] = dupe;                             // use dupe
                delete b.modules[mod];                      // delete mod
                fixed.add(`${nameOf(dupe)} vs. ${nameOf(mod)} (${n})`);
            }
        }
    }
    for (const fix of [...fixed].sort()) console.log("Deduplicating import of", fix);
}
