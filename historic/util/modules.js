import hotreloadEventManager from "./hotreloadEventManager";
import urlOptions from "./urlOptions";
import { getUser } from "./user";

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

export const CROQUET_HOST = window.location.hostname.endsWith("croquet.studio") ? window.location.hostname : "croquet.studio";

export function fileServer() {
    const server = typeof urlOptions.files === "string" ? urlOptions.files : `https://${CROQUET_HOST}`;
    if (server.endsWith('/')) return server.slice(0, -1);
    return server;
}

// we use a separate directory for each host (e.g. "croquet.studio")
// but replace 'localhost' and '*.ngrok.io' by 'dev/username' for developers
export function baseUrl(what='code') {
    const dev = urlOptions.has("dev", "host", "localhost");
    const host = dev ? `dev/${getUser("name", "GUEST")}` : window.location.hostname;
    return `${fileServer()}/files-v1/${host}/${what}/`;
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

function _resolveImport(id, name) {
    return moduleWithID(id)[1][name] || name;
}

function functionSource(fn) {
    // strip the Function(args) { ...source ... } to just the source
    const str = "" + fn;
    const openingBrace = str.indexOf('{');
    const closingBrace = str.lastIndexOf('}');
    return str.slice(openingBrace + 1, closingBrace).trim();
}

function classSrc(cls) {
    // strip whitespace around head and class body, and leading whitespace
    const str = "" + cls;
    const openingBrace = str.indexOf('{');
    const closingBrace = str.lastIndexOf('}');
    const head = str.slice(0, openingBrace).replace(/\s+/g, ' ').trim();
    const body = str.slice(openingBrace + 1, closingBrace).trim();
    return `${head} {\n${body.replace(/^\s+/gm, '')}}`;
}

/**
 * find source code of a given module (mangled by parcel.js)
 * @param {String} mod module name
 * @returns {String} the module source code
 */
function sourceCodeOf(mod) {
    const source = mod === htmlName ? htmlSource : functionSource(moduleWithID(mod)[0]);

    // verify that code survives stringification
    const fn = new Function('require', 'module', 'exports', source);
    const src = functionSource(fn);
    if (src !== source) throw Error("source does not match");

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
function _allImportersOf(mod) {
    return allModuleIDs().filter(m => importsOf(m).includes(mod));
}


export function fromBase64url(base64) {
    return new Uint8Array(atob(base64.padEnd((base64.length + 3) & ~3, "=")
        .replace(/-/g, "+")
        .replace(/_/g, "/")).split('').map(c => c.charCodeAt(0)));
}

export function toBase64url(bits) {
    return btoa(String.fromCharCode(...new Uint8Array(bits)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

/** return buffer hashed into 256 bits encoded using base64 (suitable in URL) */
export async function hashBuffer(buffer) {
    const bits = await window.crypto.subtle.digest("SHA-256", buffer);
    return toBase64url(bits);
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
    const source = sourceCodeOf(mod).replace(/\s+/gm, ''); // a side effect of parcel is some whitespace mangling that can be different on different platforms.  hash on a version with no whitespace at all.
    return fileHashes[mod] = await hashString(source);
}

const extraHashes = [];

export function addClassHash(cls) {
    const source = classSrc(cls).replace(/\s+/gm, ''); // whitespace treatment, as above
    extraHashes.push(hashString(source));
}

export async function hashNameAndCode(name) {
    const mods = allModuleIDs().filter(id => {
        // we don't want to be encoding any package.json, because it includes a build-specific path name.  ar.js also causes trouble, for some as yet unknown reason.
        // @@ this could be switched on or off under control of a process.env setting.
        const exclude = id.endsWith("package.json") || id.endsWith("ar.js");
        if (exclude) console.warn(`excluding ${id} from code hash`);
        return !exclude;
        }).sort();
    // console.log(`${name} Hashing ${moduleID}: ${mods.join(' ')}`);
    const hashes = await Promise.all([...mods.map(hashFile), ...extraHashes]);
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
            if (clean.length > existing.length) names[id] = clean;
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

const BASE_URL = baseUrl('code');

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
