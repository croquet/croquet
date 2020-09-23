import stableStringify from "fast-json-stable-stringify";
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


// croquet.io and pi.croquet.io provide file servers themselves
// everything else uses croquet.io via CORS
export const CROQUET_HOST = window.location.hostname.endsWith("croquet.io") ? window.location.host : "croquet.io";

export function fileServer() {
    const server = typeof urlOptions.files === "string" ? urlOptions.files : `https://${CROQUET_HOST}/files/v1`;
    if (server.endsWith('/')) return server.slice(0, -1);
    return server;
}

// we put everything into the "all/" directory
// but replace 'localhost' and '*.ngrok.io' by 'dev/username' for developers
export function baseUrl(what='code') {
    const dev = urlOptions.has("dev", "host", "localhost"); // true on localhost or ngrok
    const host = dev ? `dev/${getUser("name", "GUEST")}/` : '';
    return `${fileServer()}/${host}${what}/`;
}

function allModules() {
    return module.bundle ? module.bundle.modules : [];
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
    // this is used to provide the source code for hashing, and hence for generating
    // a session ID.  we do some minimal cleanup to unify the class / function strings
    // as provided by different browsers.
    function cleanup(str) {
        const openingBrace = str.indexOf('{');
        const closingBrace = str.lastIndexOf('}');
        const head = str.slice(0, openingBrace).replace(/\s+/g, ' ').replace(/\s\(/, '(');
        const body = str.slice(openingBrace + 1, closingBrace);
        return `${head.trim()}{${body.trim()}}`;
    }
    const str = "" + cls;
    let src = cleanup(str);
    if (!str.startsWith("class")) {
        // likely class has been minified and replaced with function definition
        // add source of prototype methods
        const p = cls.prototype;
        src += Object.getOwnPropertyNames(p).map(n => `${n}:${cleanup("" + p[n])}`).join('');
    }
    return src;
    // remnants of an experiment (june 2019) in deriving the same hash for code
    // that is semantically equivalent, even if formatted differently - so that
    // tools such as Codepen, which mess with white space depending on the
    // requested view type (e.g., debug or not), would nonetheless generate
    // the same session ID for all views.
    // our white-space standardisation involved stripping space immediately
    // inside a brace, and at the start of each line:

    // .replace(/\{\s+/g, '{').replace(/\s+\}/g, '}').replace(/^\s+/gm, '')}}`;

    // upon realising that Codepen also reserves the right to inject code, such
    // as into "for" loops to allow interruption, we decided to abandon this
    // approach.  users should just get used to different views having different
    // session IDs.
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

if (!window.crypto || !window.crypto.subtle || typeof window.crypto.subtle.digest !== "function") {
    console.error(`ERROR: crypto.subtle.digest() browser API not available. Please access this page via https or localhost.`);
}

/** return buffer hashed into 256 bits encoded using base64 (suitable in URL) */
export async function hashBuffer(buffer) {
    // MS Edge does not like empty buffer
    if (buffer.length === 0) return "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU";
    const bits = await window.crypto.subtle.digest("SHA-256", buffer);
    return toBase64url(bits);
}

function debugHashing() { return urlOptions.has("debug", "hashing", false); }

const debugHashes = {};
const debugModuleNames = { was_initialized: false };

function resolveDebugModuleNames() {
    for (const m of allModuleIDs()) {
        for (const [name, id] of Object.entries(namedImportsOf(m))) {
            const existing = debugModuleNames[id] || '';
            const clean = name.replace(/^[./]*/, '');
            if (clean.length > existing.length) debugModuleNames[id] = clean;
        }
    }
    debugModuleNames.was_initialized = true;
}

function debugNameOf(mod) {
    if (!debugModuleNames.was_initialized) resolveDebugModuleNames();
    return debugModuleNames[mod] || mod;
}

const encoder = new TextEncoder();

export async function hashString(string) {
    const buffer = encoder.encode(string);
    const hash = await hashBuffer(buffer);
    if (debugHashing()) debugHashes[hash] = {string, buffer};
    return hash;
}

const fileHashes = {};

export async function hashFile(mod) {
    if (fileHashes[mod]) return fileHashes[mod];
    const source = sourceCodeOf(mod).replace(/\s+/g, ' '); // a side effect of parcel is some whitespace mangling that can be different on different platforms.  hash on a version in which each run of whitespace is converted to a single space.
    const hash = await hashString(source);
    if (debugHashing()) debugHashes[hash].name = `Module ${debugNameOf(mod)}`;
    return fileHashes[mod] = hash;
}

const extraHashes = [];

export function addClassHash(cls, classId) {
    const source = classSrc(cls);
    const hashPromise = hashString(source);
    extraHashes.push(hashPromise);
    if (debugHashing()) hashPromise.then(hash => {
        // console.log(`hashing model class ${classId}: ${hash}`);
        debugHashes[hash].name = `Class ${classId}`;
    });
}

export function addConstantsHash(constants) {
    // replace functions with their source
    const json = JSON.stringify(constants, (_, val) => typeof val === "function" ? ""+val : val);
    if (json === "{}") return;
    // use a stable stringification
    const obj = JSON.parse(json);
    const string = stableStringify(obj);
    const hashPromise = hashString(string);
    hashPromise.then(hash => {
        console.log(`hashing Croquet.Constants(${Object.keys(obj).join(', ')}): ${hash}`);
        if (debugHashing()) debugHashes[hash].name = "Croquet Constants";
    });
    extraHashes.push(hashPromise);
}

export async function hashSessionAndCode(name, options, sdk_version) {
    // if the application is not using parcel to bundle, we will not see any modules
    // but only the registered models. So when building the npm in production mode
    // we do not even look at the parcel modules.
    const production = process.env.NODE_ENV === "production";
    const mods = production ? [] : allModuleIDs().filter(id => {
        // we don't want to be encoding any package.json, because it includes a build-specific path name.  ar.js also causes trouble, for some as yet unknown reason.
        // @@ this could be switched on or off under control of a process.env setting.
        const exclude = id.endsWith("/package.json") || id.endsWith("/ar.js");
        if (exclude) console.warn(`excluding ${id} from code hash`);
        return !exclude;
        }).sort();
    // codeHashes are from registered user models and constants (in extraHashes)
    // and possibly other modules if built in dev mode with parcel as mentioned above
    const codeHashes = await Promise.all([...mods.map(hashFile), ...extraHashes]);
    /** identifies the code being executed - user code, constants, SDK */
    const codeHash = await hashString([sdk_version, ...codeHashes].join('|'));
    /** identifies the session - not yet true unless name or options are unique */
    const sessionHash = await hashString([name, stableStringify(options)].join('|'));
    /** this will be the session ID */
    const id = await hashString([sessionHash, codeHash].join('|'));
    // log all hashes if debug=hashing
    if (debugHashing()) {
        const charset = [...document.getElementsByTagName('meta')].find(el => el.getAttribute('charset'));
        if (!charset) console.warn('Missing <meta charset="..."> declaration. Croquet model code hashing might differ between browsers.');
        debugHashes[codeHash].name = "All code hashes";
        debugHashes[sessionHash].name = "Session name and options";
        debugHashes[id].name = "Session ID";
        const allHashes = [...codeHashes, codeHash, sessionHash, id].map(each => ({ hash: each, ...debugHashes[each]}));
        console.log(`Debug Hashing for session ${id}`, allHashes);
    }
    return { id, sessionHash, codeHash };
}
