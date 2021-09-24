import stableStringify from "fast-json-stable-stringify";
import urlOptions from "./urlOptions";


function funcSrc(func) {
    // this is used to provide the source code for hashing, and hence for generating
    // a session ID.  we do some minimal cleanup to unify the class / function strings
    // as provided by different browsers.
    function cleanup(str) {
        const openingBrace = str.indexOf('{');
        const closingBrace = str.lastIndexOf('}');
        if (openingBrace === -1 || closingBrace === -1 || closingBrace < openingBrace) return str;
        const head = str.slice(0, openingBrace).replace(/\s+/g, ' ').replace(/\s\(/, '(');
        const body = str.slice(openingBrace + 1, closingBrace);
        return `${head.trim()}{${body.trim()}}`;
    }
    let src = cleanup("" + func);
    if (!src.startsWith("class")) {
        // possibly class has been minified and replaced with function definition
        // add source of prototype methods
        const p = func.prototype;
        if (p) src += Object.getOwnPropertyNames(p).map(n => `${n}:${cleanup("" + p[n])}`).join('');
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

/** return string hashed into 256 bits encoded using base64 (suitable in URL)  */
export async function hashString(string) {
    const buffer = encoder.encode(string);
    const hash = await hashBuffer(buffer);
    if (debugHashing()) debugHashes[hash] = {string, buffer};
    return hash;
}

const hashPromises = [];
const codeHashCache = {}; // persistentID to { codeHashes, computedCodeHash }, cached on first JOIN in case additional code or constants (presumably for a different session) get registered later, and the user explicitly leaves and re-joins

export function addClassHash(cls, classId) {
    const source = funcSrc(cls);
    const hashPromise = hashString(`${classId}:${source}`);
    hashPromises.push(hashPromise);
    if (debugHashing()) hashPromise.then(hash => {
        // console.log(`hashing model class ${classId}: ${hash}`);
        debugHashes[hash].what = `Class ${classId}`;
    });
}

export function addConstantsHash(constants) {
    // replace functions with their source
    const json = JSON.stringify(constants, (_, val) => typeof val === "function" ? funcSrc(val) : val);
    if (json === "{}") return;
    // use a stable stringification
    const obj = JSON.parse(json);
    const string = stableStringify(obj);
    const hashPromise = hashString(string);
    hashPromises.push(hashPromise);
    if (debugHashing()) hashPromise.then(hash => {
        //console.log(`hashing Croquet.Constants(${Object.keys(obj).join(', ')}): ${hash}`);
        debugHashes[hash].what = "Croquet Constants";
    });
}

/** generate persistentId for the vm */
export async function hashNameAndOptions(appIdAndName, options) {
    if (!window.crypto || !window.crypto.subtle || typeof window.crypto.subtle.digest !== "function") {
        throw Error(`Croquet: Crypto API not available.\nPlease access this page via https or localhost.`);
    }
    return hashString(appIdAndName + stableStringify(options));
}

const logged = new Set();

export async function hashSessionAndCode(persistentId, developerId, params, sdk_version) {
    // codeHashes are from registered user models and constants (in hashPromises).
    // jul 2021: note that if multiple sessions are loaded in the same tab, *all*
    // sessions' models and constants registered up to this point will be taken into
    // account.  later we'd like to provide an interface (perhaps through App) for
    // registering each session's resources separately.
    let codeHashes;
    /** identifies the code being executed - user code, constants, croquet */
    let computedCodeHash;
    const cached = codeHashCache[persistentId];
    let cacheAnnotation = "";
    if (cached) {
        // the cached codeHashes list is only used in logging, and logging will
        // only happen if the final derived session ID has changed.
        codeHashes = cached.codeHashes;
        computedCodeHash = cached.computedCodeHash;
        cacheAnnotation = " (code hashing from cache)";
    } else {
        codeHashes = await Promise.all(hashPromises);
        computedCodeHash = await hashString([sdk_version, ...codeHashes].join('|'));
        codeHashCache[persistentId] = { codeHashes, computedCodeHash };
    }
    // let developer override hashing (at their own peril)
    const { hashOverride, ...effectiveParams } = params;
    const effectiveCodeHash = hashOverride || computedCodeHash;
    /** identifies the session */
    const id = await hashString(persistentId + '|' + developerId + stableStringify(effectiveParams) + effectiveCodeHash);
    // log all hashes if debug=hashing
    if (debugHashing() && !logged.has(id)) {
        const charset = [...document.getElementsByTagName('meta')].find(el => el.getAttribute('charset'));
        if (!charset) console.warn('Croquet: Missing <meta charset="..."> declaration. Croquet model code hashing might differ between browsers.');
        debugHashes[computedCodeHash].what = "Version ID";
        debugHashes[persistentId].what = "Persistent ID";
        debugHashes[id].what = "Session ID";
        if (effectiveCodeHash !== computedCodeHash) {
            codeHashes.push(computedCodeHash); // for allHashes
            debugHashes[computedCodeHash].what = "Computed Version ID (replaced by overrideHash)";
            debugHashes[effectiveCodeHash] = { what: "Version ID (as specified by overrideHash)"};
        }
        const allHashes = [...codeHashes, effectiveCodeHash, persistentId, id].map(each => ({ hash: each, ...debugHashes[each]}));
        console.log(`Croquet: Debug Hashing for session ${id}${cacheAnnotation}`, allHashes);
        logged.add(id);
    }
    return { id, persistentId, codeHash: effectiveCodeHash, computedCodeHash };
}
