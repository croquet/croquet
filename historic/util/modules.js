import stableStringify from "fast-json-stable-stringify";
import urlOptions from "./urlOptions";

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
    return `${fileServer()}/${what}/`;
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

const encoder = new TextEncoder();

export async function hashString(string) {
    const buffer = encoder.encode(string);
    const hash = await hashBuffer(buffer);
    if (debugHashing()) debugHashes[hash] = {string, buffer};
    return hash;
}

const hashPromises = [];

export function addClassHash(cls, classId) {
    const source = classSrc(cls);
    const hashPromise = hashString(source);
    hashPromises.push(hashPromise);
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
    hashPromises.push(hashPromise);
    if (debugHashing()) hashPromise.then(hash => {
        //console.log(`hashing Croquet.Constants(${Object.keys(obj).join(', ')}): ${hash}`);
        debugHashes[hash].name = "Croquet Constants";
    });
}

export async function hashSessionAndCode(name, options, sdk_version) {
    // codeHashes are from registered user models and constants (in hashPromises)
    const codeHashes = await Promise.all(hashPromises);
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
