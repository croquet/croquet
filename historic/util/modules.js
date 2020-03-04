import stableStringify from "fast-json-stable-stringify";
//import hotreloadEventManager from "./hotreloadEventManager";
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
    // a session ID.  we do some minimal cleanup to unify the class strings as
    // provided by different browsers.
    const str = "" + cls;
    const openingBrace = str.indexOf('{');
    const closingBrace = str.lastIndexOf('}');
    const head = str.slice(0, openingBrace).replace(/\s+/g, ' ').trim();
    const body = str.slice(openingBrace + 1, closingBrace).trim();
    return `${head} {\n${body}}`;

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

/** return buffer hashed into 256 bits encoded using base64 (suitable in URL) */
export async function hashBuffer(buffer) {
    // MS Edge does not like empty buffer
    if (buffer.length === 0) return "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU";
    const bits = await window.crypto.subtle.digest("SHA-256", buffer);
    return toBase64url(bits);
}

const encoder = new TextEncoder();

export async function hashString(string) {
    const buffer = encoder.encode(string);
    return hashBuffer(buffer);
}

const fileHashes = {};

/*
hotreloadEventManager.addDisposeHandler("fileHashes", () => { for (const f of (Object.keys(fileHashes))) delete fileHashes[f]; });
*/

export async function hashFile(mod) {
    if (fileHashes[mod]) return fileHashes[mod];
    const source = sourceCodeOf(mod).replace(/\s+/g, ' '); // a side effect of parcel is some whitespace mangling that can be different on different platforms.  hash on a version in which each run of whitespace is converted to a single space.
    return fileHashes[mod] = await hashString(source);
}

const extraHashes = [];

export function addClassHash(cls) {
    const source = classSrc(cls);
    const hashPromise = hashString(source);
    hashPromise.then(hash => console.log(`hashing ${cls.name}: ${hash}`));
    extraHashes.push(hashPromise);
}

export function addConstantsHash(constants) {
    // replace functions with their source
    const json = JSON.stringify(constants, (_, val) => typeof val === "function" ? ""+val : val);
    if (json === "{}") return;
    // use a stable stringification
    const obj = JSON.parse(json);
    const string = stableStringify(obj);
    const hashPromise = hashString(string);
    hashPromise.then(hash => console.log(`hashing Croquet.Constants(${Object.keys(obj).join(', ')}): ${hash}`));
    extraHashes.push(hashPromise);
}

export async function hashNameAndCode(name, sdk_version) {
    // if the application is not using parcel to bundle, we will not have any modules @@@
    const mods = allModuleIDs().filter(id => {
        // we don't want to be encoding any package.json, because it includes a build-specific path name.  ar.js also causes trouble, for some as yet unknown reason.
        // @@ this could be switched on or off under control of a process.env setting.
        const exclude = id.endsWith("/package.json") || id.endsWith("/ar.js");
        if (exclude) console.warn(`excluding ${id} from code hash`);
        return !exclude;
        }).sort();
    // console.log(`${name} Hashing ${moduleID}: ${mods.join(' ')}`);
    // if (mods.length) console.log(`hashing ${mods.length} SDK modules`);
    // else console.log(`hashing SDK`);
    const hashes = await Promise.all([...mods.map(hashFile), ...extraHashes]);
    const codeHash = await hashString([sdk_version, ...hashes].join('|'));
    const hash = await hashString([name, codeHash].join('|'));
    return { hash, codeHash };
}
