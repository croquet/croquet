import AES from "crypto-js/aes";
import HmacSHA256 from "crypto-js/hmac-sha256";
import WordArray from "crypto-js/lib-typedarrays";
import Base64 from "crypto-js/enc-base64";

import { hashString, baseUrl } from "@croquet/util/modules";
import { App } from "@croquet/util/html";
import urlOptions from "@croquet/util/urlOptions";
import Island from "./island";
import { sessionProps } from "./controller";


const VERSION = '1';

const DATAHANDLE_HASH = Symbol("hash");
const DATAHANDLE_KEY = Symbol("key");
const DATAHANDLE_PATH = Symbol("path");

const HandleCache = new Map();      // map hash => handle

function debug(what) {
    return urlOptions.has("debug", what, false);
}

function dataUrl(hash, path) {
    if (!path) return `${baseUrl('sessiondata')}${hash}`;              // deprecated
    return `${baseUrl('apps')}${path}/data/${hash}`;
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

async function upload(url, data, appId, islandId) {
    if (debug("data")) console.log(`Croquet.Data: Uploading ${data.length} bytes to ${url}`);
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            "X-Croquet-App": appId,
            "X-Croquet-Id": islandId,
        },
        referrer: App.referrerURL(),
        body: data,
    });
    if (!response.ok) throw Error(`Croquet.Data: failed to upload ${url} (${response.status} ${response.statusText})`);
    if (debug("data")) console.log(`Croquet.Data: uploaded (${response.status} ${response.statusText}) ${data.length} bytes to ${url}`);
}

async function download(url, appId, islandId) {
    if (debug("data")) console.log(`Croquet.Data: Downloading from ${url}`);
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "X-Croquet-App": appId,
            "X-Croquet-Id": islandId,
        },
        referrer: App.referrerURL(),
    });
    if (response.ok) return response.text();
    throw Error(`Croquet.Data: failed to download ${url} (${response.status} ${response.statusText})`);
}

/** exposed as Data in API */
export default class DataHandle {
    /**
     * Store data and return an (opaque) handle.
     * @param {String} sessionId the sessionId for authentication
     * @param {ArrayBuffer} data the data to be stored
     * @param {Boolean} doNotWait if true, return before storing finished and resolve `handle.stored` when done
     * @returns {Promise<DataHandle>} return promise for the handle. If requested, `handle.stored` will be another promise that resolves when uploading is done.
     */
    static async store(sessionId, data, doNotWait=false) {
        if (typeof sessionId === "object") {
            console.warn("Deprecated: Croquet.Data.store(sessionId, data) called without sessionId")
            doNotWait = data || false;
            data = sessionId;
        }
        if (Island.hasCurrent()) throw Error("Croquet.Data.store() called from Model code");
        const  { appId, islandId } = sessionProps(sessionId);
        if (!appId) {
            console.warn("Deprecated: Croquet.Data API used without declaring appId in Croquet.Session.join()");
        }
        const key = await randomKey();
        const encrypted = await encrypt(key, data);
        const hash = await hashData(encrypted);
        const path = appId && `${appId}/${islandId}`;
        const handle = new DataHandle(hash, key, path);
        const url = dataUrl(hash, path);
        const promise = upload(url, encrypted, appId, islandId);
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
     * @param {String} sessionId the sessionId for authentication
     * @param {DataHandle} handle created by {@link Data.store}
     * @returns {Promise<ArrayBuffer>} the data
     */
    static async fetch(sessionId, handle) {
        if (typeof sessionId === "object") {
            console.warn("Deprecated: Croquet.Data.fetch(sessionId, handle) called without sessionId")
            handle = sessionId;
        }
        if (Island.hasCurrent()) throw Error("Croquet.Data.fetch() called from Model code");
        const  { appId, islandId } = sessionProps(sessionId);
        if (!appId) {
            console.warn("Deprecated: Croquet.Data API used without declaring appId in Croquet.Session.join()");
        }
        const hash = handle && handle[DATAHANDLE_HASH];
        const key = handle && handle[DATAHANDLE_KEY];
        const path = handle && handle[DATAHANDLE_PATH];
        if (typeof hash !== "string" ||typeof key !== "string") throw Error("Croquet.Data.fetch() called with invalid handle");
        const url = dataUrl(hash, path);
        const encrypted = await download(url, appId, islandId);
        return decrypt(key, encrypted);
    }

    /** @private */
    static fromId(id) {
        const version = id.slice(0, 1);
        switch (version) {
            case '0': {
                const hash = id.slice(1, 1 + 43);
                const key = id.slice(1 + 43);
                return new this(hash, key);
            }
            case '1': {
                const hash = id.slice(1, 1 + 43);
                const key = id.slice(1 + 43, 1 + 43 + 43) + '=';
                const path = id.slice(1 + 43 + 43);
                return new this(hash, key, path);
            }
            default:
                throw Error(`Croquet.Data expected handle v${VERSION} got v${version}`);
        }
    }

    /** @private */
    static toId(handle) {
        if (!handle) return;
        const hash = handle[DATAHANDLE_HASH];
        const key = handle[DATAHANDLE_KEY];
        const path = handle[DATAHANDLE_PATH];
        if (!path) return `0${hash}${key}`; // deprecated
        return `${VERSION}${hash}${key.slice(0, -1)}${path}`;
    }

    constructor(hash, key, path) {
        const existing = HandleCache.get(hash);
        if (existing) {
            if (debug("data")) console.log(`Croquet.Data: using cached handle for ${hash}`);
            return existing;
        }
        // stored under Symbol key to be invisible to user code
        Object.defineProperty(this, DATAHANDLE_HASH, { value: hash });
        Object.defineProperty(this, DATAHANDLE_KEY, { value: key });
        if (path) Object.defineProperty(this, DATAHANDLE_PATH, { value: path });      // non-path is deprecated
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
