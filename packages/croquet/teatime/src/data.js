import stableStringify from "fast-json-stable-stringify";
import WordArray from "crypto-js/lib-typedarrays";
import Base64 from "crypto-js/enc-base64";
import SHA256 from "crypto-js/sha256";
import urlOptions from "@croquet/util/urlOptions";
import VirtualMachine from "./vm";
import { sessionProps, OLD_DATA_SERVER } from "./controller";


const VERSION = '3';

const DATAHANDLE_HASH = Symbol("hash");
const DATAHANDLE_KEY = Symbol("key");
const DATAHANDLE_URL = Symbol("url");

const HandleCache = new Map();      // map hash => handle

function debug(what) {
    return urlOptions.has("debug", what, false);
}

function hashFromUrl(url) {
    return url.replace(/.*\//, '');
}

function toBase64Url(base64) {
    return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(base64url) {
    return base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd((base64url.length + 3) & ~3, "=");
}

function scramble(key, string) {
    return string.replace(/[\s\S]/g, c => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(0)));
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
            console.warn("Deprecated: Croquet.Data.store(sessionId, data) called without sessionId");
            data = sessionId;
        }
        if (VirtualMachine.hasCurrent()) throw Error("Croquet.Data.store() called from Model code");
        const  { appId, persistentId, uploadEncrypted } = sessionProps(sessionId);
        const key = WordArray.random(32).toString(Base64);
        const path = `apps/${appId}/${persistentId}/data/"%HASH%"`;
        const url = await uploadEncrypted({ path, content: data, key, keep, debug: debug("data"), what: "shared data" });
        const hash = hashFromUrl(url);
        return new DataHandle(hash, key, url);

        // TODO: publish events and handle in vm to track assets even if user code fails to do so
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
            console.warn("Deprecated: Croquet.Data.fetch(sessionId, handle) called without sessionId");
            handle = sessionId;
        }
        if (VirtualMachine.hasCurrent()) throw Error("Croquet.Data.fetch() called from Model code");
        const  { downloadEncrypted } = sessionProps(sessionId);
        const hash = handle && handle[DATAHANDLE_HASH];
        const key = handle && handle[DATAHANDLE_KEY];
        const url = handle && handle[DATAHANDLE_URL];
        if (typeof hash !== "string" || typeof key !== "string" || typeof url !== "string" ) throw Error("Croquet.Data.fetch() called with invalid handle");
        return downloadEncrypted({ url, key, debug: debug("data"), what: "shared data" });
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
            case "base64url": return toBase64Url(result.toString(Base64));
            default: throw Error(`Croquet.Data: unknown hash output "${output}", expected "hex"/"base64"/"base64url"`);
        }
    }

    /** @private */
    static fromId(id) {
        const version = id.slice(0, 1);
        let hash, key, url, path;
        switch (version) {
            case '0':
                hash = id.slice(1, 1 + 43);
                key = id.slice(1 + 43);
                url = `${OLD_DATA_SERVER}/sessiondata/${hash}`;
                break;
            case '1':
                hash = id.slice(1, 1 + 43);
                key = id.slice(1 + 43, 1 + 43 + 43) + '=';
                path = id.slice(1 + 43 + 43);
                url = `${OLD_DATA_SERVER}/apps/${path}/data/${hash}`;
                break;
            case '2':
                hash = id.slice(1, 1 + 43);
                key = fromBase64Url(id.slice(1 + 43, 1 + 43 + 43));
                path = scramble(key, atob(fromBase64Url(id.slice(1 + 43 + 43))));
                url = `${OLD_DATA_SERVER}/apps/${path}/data/${hash}`;
                break;
            case '3':
                key = fromBase64Url(id.slice(1, 1 + 43));
                url = scramble(key, atob(fromBase64Url(id.slice(1 + 43))));
                hash = url.slice(-43);
                break;
            default:
                throw Error(`Croquet.Data expected handle v0-v${VERSION} got v${version}`);
        }
        return new this(hash, key, url);
    }

    /** @private */
    static toId(handle) {
        if (!handle) return '';
        const hash = handle[DATAHANDLE_HASH];
        const key = handle[DATAHANDLE_KEY];
        const url = handle[DATAHANDLE_URL];
        if (url.slice(-43) !== hash) throw Error("Croquet Data: malformed URL");
        // key is plain Base64, make it url-safe
        const encodedKey = toBase64Url(key);
        // the only reason for obfuscation here is so devs do not rely on any parts of the id
        const encodedUrl = toBase64Url(btoa(scramble(key, url)));
        return `${VERSION}${encodedKey}${encodedUrl}`;
    }

    constructor(hash, key, url) {
        const existing = HandleCache.get(hash);
        if (existing) {
            if (debug("data")) console.log(`Croquet.Data: using cached handle for ${hash}`);
            return existing;
        }
        if (url.slice(-43) !== hash) throw Error("Croquet Data: malformed URL");
        // stored under Symbol key to be invisible to user code
        Object.defineProperty(this, DATAHANDLE_HASH, { value: hash });
        Object.defineProperty(this, DATAHANDLE_KEY, { value: key });
        Object.defineProperty(this, DATAHANDLE_URL, { value: url });
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
