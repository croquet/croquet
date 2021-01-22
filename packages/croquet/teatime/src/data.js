import stableStringify from "fast-json-stable-stringify";
import WordArray from "crypto-js/lib-typedarrays";
import Base64 from "crypto-js/enc-base64";
import SHA256 from "crypto-js/sha256";
import { baseUrl } from "@croquet/util/hashing";
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

function dataUrl(path, hash) {
    if (!path) return `${baseUrl('sessiondata')}${hash}`;              // deprecated
    return `${baseUrl('apps')}${path}/data/${hash}`;
}

function hashFromUrl(url) {
    return url.replace(/.*\//, '');
}

/** exposed as Data in API */
export default class DataHandle {
    /**
     * Store data and return an (opaque) handle.
     * @param {String} sessionId the sessionId for authentication
     * @param {ArrayBuffer} data the data to be stored
     * @param {Boolean} keep if true, keep the data intact (do not detach buffer)
     * @returns {Promise<DataHandle>} return promise for the handle. If requested, `handle.stored` will be another promise that resolves when uploading is done.
     */
    static async store(sessionId, data, keep=false) {
        if (typeof sessionId === "object") {
            console.warn("Deprecated: Croquet.Data.store(sessionId, data) called without sessionId")
            data = sessionId;
        }
        if (Island.hasCurrent()) throw Error("Croquet.Data.store() called from Model code");
        const  { appId, islandId, uploadEncrypted } = sessionProps(sessionId);
        if (!appId) {
            console.warn("Deprecated: Croquet.Data API used without declaring appId in Croquet.Session.join()");
        }
        const key = WordArray.random(32).toString(Base64);
        const path = appId && `${appId}/${islandId}`;
        const url = await uploadEncrypted({ url: dataUrl(path, "%HASH%"), content: data, key, keep, debug: debug("data"), what: "data" });
        const hash = hashFromUrl(url);
        return new DataHandle(hash, key, path);

        // TODO: publish events and handle in island to track assets even if user code fails to do so
        // publish(sessionId, "data-storing", handle);
        // promise.then(() => publish(sessionId, "data-stored", handle));
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
        const  { appId, downloadEncrypted } = sessionProps(sessionId);
        if (!appId) {
            console.warn("Deprecated: Croquet.Data API used without declaring appId in Croquet.Session.join()");
        }
        const hash = handle && handle[DATAHANDLE_HASH];
        const key = handle && handle[DATAHANDLE_KEY];
        const path = handle && handle[DATAHANDLE_PATH];
        if (typeof hash !== "string" ||typeof key !== "string") throw Error("Croquet.Data.fetch() called with invalid handle");
        const url = dataUrl(path, hash);
        return downloadEncrypted({ url, key, debug: debug("data"), what: "data" });
    }

    /**
     * Answer a hash for the given data.
     * Strings and binary arrays are hashed directly, other objects use a stable JSON stringification
     * @param {ArrayBuffer|String|*} data the data to be hashed
     * @param {"hex"|"base64"|"base64url"} output hash encoding (default: "base64url")
     * @returns {String} SHA256 hash
     */
    static hash(data, output='base64url') {
        if (typeof data === "function") data = Function.prototype.toString.call(data);
        if (typeof data === "string") data = new TextEncoder().encode(data);
        else if (data && data.constructor === DataView) data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        else if (data && data.constructor === ArrayBuffer) data = new Uint8Array(data);
        else if (!ArrayBuffer.isView(data)) data = new TextEncoder().encode(stableStringify(data));
        const result = SHA256(WordArray.create(data));
        switch (output) {
            case "hex": return result.toString();
            case "base64": return result.toString(Base64);
            case "base64url": return result.toString(Base64).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
            default: throw Error(`Croquet.Data: unknown hash output "${output}", expected "hex"/"base64"/"base64url"`);
        }
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
