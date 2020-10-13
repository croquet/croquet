import AES from "crypto-js/aes";
import HmacSHA256 from "crypto-js/hmac-sha256";
import WordArray from "crypto-js/lib-typedarrays";
import Base64 from "crypto-js/enc-base64";

import { hashString } from "@croquet/util/modules";
import { App } from "@croquet/util/html";
import urlOptions from "@croquet/util/urlOptions";
import Island from "./island";


const VERSION = '0';

const DATAHANDLE_HASH = Symbol("hash");
const DATAHANDLE_KEY = Symbol("key");

const HandleCache = new Map();      // map hash => handle

function debug(what) {
    return urlOptions.has("debug", what, false);
}

function dataUrl(hash) {
    return `https://croquet.io/files/v1/sessiondata/${hash}`;
}

async function hashData(data) {
    return hashString(data);
}

async function randomKey() {
    return WordArray.random(32).toString(Base64);
}

// string, arraybuffer => string
async function encrypt(keyBase64, data) {
    const start = Date.now();
    const plaintext = WordArray.create(data);
    const key = Base64.parse(keyBase64);
    const hmac = HmacSHA256(plaintext, key);
    const iv = WordArray.random(16);
    const { ciphertext } = AES.encrypt(plaintext, key, { iv });
    const encrypted = "CRQ0" + [iv, hmac, ciphertext].map(wordArray => wordArray.toString(Base64)).join('');
    if (debug("data")) console.log(`Croquet.Data: encryption (${data.byteLength} bytes) took ${Math.ceil(Date.now() - start)}ms`);
    return encrypted;
}

// string, string => arraybuffer
async function decrypt(keyBase64, encrypted) {
    const start = Date.now();
    const key = Base64.parse(keyBase64);
    const version = encrypted.slice(0, 4);
    const iv = Base64.parse(encrypted.slice(4, 4 + 24));
    const mac = Base64.parse(encrypted.slice(4 + 24, 4 + 24 + 44));
    const ciphertext = encrypted.slice(4 + 24 + 44);
    const decrypted = AES.decrypt(ciphertext, key, { iv });
    decrypted.clamp(); // clamping manually because of bug in HmacSHA256
    const hmac = HmacSHA256(decrypted, key);
    if (!compareHmacs(mac.words, hmac.words)) console.warn("decryption hmac mismatch"); // ¯\_(ツ)_/¯
    const result = cryptoJsWordArrayToUint8Array(decrypted);
    if (debug("data")) console.log(`Croquet.Data: decryption (${result.length} bytes) took ${Math.ceil(Date.now() - start)}ms`);
    return result.buffer;
}

function compareHmacs(fst, snd) {
    let ret = fst.length === snd.length;
    for (let i=0; i<fst.length; i++) {
        if (!(fst[i] === snd[i])) {
            ret = false;
        }
    }
    return ret;
}

function cryptoJsWordArrayToUint8Array(wordArray) {
    const l = wordArray.sigBytes;
    const words = wordArray.words;
    const result = new Uint8Array(l);
    let i = 0, j = 0;
    while (true) {
        if (i === l) break;
        const w = words[j++];
        result[i++] = (w & 0xff000000) >>> 24; if (i === l) break;
        result[i++] = (w & 0x00ff0000) >>> 16; if (i === l) break;
        result[i++] = (w & 0x0000ff00) >>> 8;  if (i === l) break;
        result[i++] = (w & 0x000000ff);
    }
    return result;
}

async function upload(url, data) {
    if (debug("data")) console.log(`Croquet.Data: Uploading ${data.length} bytes to ${url}`);
    const response = await fetch(url, { method: 'PUT', referrer: App.referrerURL(), body: data});
    if (!response.ok) throw Error(`Croquet.Data: failed to upload ${url} (${response.status} ${response.statusText})`);
    if (debug("data")) console.log(`Croquet.Data: uploaded (${response.status} ${response.statusText}) ${data.length} bytes to ${url}`);
}

async function download(url) {
    if (debug("data")) console.log(`Croquet.Data: Downloading from ${url}`);
    const response = await fetch(url, { referrer: App.referrerURL() });
    if (response.ok) return response.text();
    throw Error(`Croquet.Data: failed to download ${url} (${response.status} ${response.statusText})`);
}

/** exposed as Data in API */
export default class DataHandle {
    /**
     * Store data and return an (opaque) handle.
     * @param {ArrayBuffer} data the data to be stored
     * @param {Boolean} doNotWait if true, return before storing finished and resolve `handle.stored` when done
     * @returns {Promise<DataHandle>} return promise for the handle. If requested, `handle.stored` will be another promise that resolves when uploading is done.
     */
    static async store(data, doNotWait=false, thirdArg=false) {
        if (typeof data === "string" && typeof doNotWait === "object") {
            console.warn("Deprecated: Croquet.Data.store(data) called with sessionID")
            data = doNotWait;
            doNotWait = thirdArg;
        }
        if (Island.hasCurrent()) throw Error("Croquet.Data.store() called from Model code");
        const key = await randomKey();
        const encrypted = await encrypt(key, data);
        const hash = await hashData(encrypted);
        const handle = new DataHandle(hash, key);
        const url = dataUrl(hash);
        const promise = upload(url, encrypted);
        // if we uploaded the same file in this same session before, then the promise already exists
        if (!handle.stored) {
            Object.defineProperty(handle, "stored", { value: () => Island.hasCurrent() ? undefined : promise });
            // TODO: do not ignore upload failure
        }

        // TODO: publish events and handle in island to track assets even if user code fails to do so
        // publish(sessionId, "data-storing", handle);
        // promise.then(() => publish(sessionId, "data-stored", handle));

        // wait for upload to complete unless doNotWait requested
        if (!doNotWait) await promise;
        return handle;
    }

    /**
     * Fetch data for a given data handle
     * @param {DataHandle} handle created by {@link Data.store}
     * @returns {Promise<ArrayBuffer>} the data
     */
    static async fetch(handle, secondArg) {
        if (typeof handle === "string" && typeof secondArg === "object") {
            console.warn("Deprecated: Croquet.Data.fetch(handle) called with sessionID")
            handle = secondArg;
        }
        if (Island.hasCurrent()) throw Error("Croquet.Data.fetch() called from Model code");
        const hash = handle && handle[DATAHANDLE_HASH];
        const key = handle && handle[DATAHANDLE_KEY];
        if (typeof hash !== "string" ||typeof key !== "string") throw Error("Croquet.Data.fetch() called with invalid handle");
        const url = dataUrl(hash);
        const encrypted = await download(url);
        return decrypt(key, encrypted);
    }

    /** @private */
    static fromId(id) {
        const version = id.slice(0, 1);
        if (version !== VERSION) throw Error(`Croquet.Data expected handle v${VERSION} got v${version}`);
        const hash = id.slice(1, 1 + 43);
        const key = id.slice(1 + 43);
        return new this(hash, key);
    }

    /** @private */
    static toId(handle) {
        return handle && `${VERSION}${handle[DATAHANDLE_HASH]}${handle[DATAHANDLE_KEY]}`;
    }

    constructor(hash, key) {
        const existing = HandleCache.get(hash);
        if (existing) {
            if (debug("data")) console.log(`Croquet.Data: using cached handle for ${hash}`);
            return existing;
        }
        // stored under Symbol key to be invisible to user code
        Object.defineProperty(this, DATAHANDLE_HASH, { value: hash });
        Object.defineProperty(this, DATAHANDLE_KEY, { value: key });
        HandleCache.set(hash, this);
        if (debug("data")) console.log(`Croquet.Data: created new handle for ${hash}`);
    }

    // no other methods - API is static
}

export const DataHandleSpec = {
    cls: DataHandle,
    write: handle => DataHandle.toId(handle),
    read: state => DataHandle.fromId(state),
};
