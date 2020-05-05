import { hashBuffer } from "@croquet/util/modules";
import urlOptions from "@croquet/util/urlOptions";
import Model from "./model";
import Island from "./island";


const DATAHANDLE_HASH = Symbol("hash");

const HandleCache = new Map();      // map hash => handle

// TODO: encryption
function getSessionKey(_sessionId) { return null; }
async function encrypt(_key, data) { return data; }
async function decrypt(_key, encrypted) { return encrypted; }

function debug(what) {
    return urlOptions.has("debug", what, false);
}

function dataUrl(_sessionId, hash) {
    // I thought we could use sessionId as part of the path for very easy tracking
    // but then transferring the data to another sessionId (see issue #425) would be harder
    return `https://croquet.io/files/v1/sessiondata/${hash}`;
}

async function hashData(data) {
    return hashBuffer(data);
}

async function upload(url, data) {
    if (debug("data")) console.log(`Uploading ${data.byteLength} bytes to ${url}`);
    const response = await fetch(url, { method: 'PUT', body: data});
    if (!response.ok) throw Error(`Croquet.Data: failed to upload ${url} (${response.status} ${response.statusText})`);
    if (debug("data")) console.log(`Croquet.Data: uploaded (${response.status} ${response.statusText}) ${data.byteLength} bytes to ${url}`);
}

async function download(url) {
    if (debug("data")) console.log(`Downloading from ${url}`);
    const response = await fetch(url);
    if (response.ok) return response.arrayBuffer();
    throw Error(`Croquet.Data: failed to download ${url} (${response.status} ${response.statusText})`);
}

/** exposed as Data in API */
export default class DataHandle {
    static async store(sessionId, data) {
        if (Island.hasCurrent()) throw Error("Croquet.Data.store() called from Model code");
        const key = getSessionKey(sessionId);
        const encrypted = await encrypt(key, data);
        const hash = await hashData(encrypted);
        const existing = HandleCache.get(hash);
        if (existing) return existing;
        const url = dataUrl(sessionId, hash);
        await upload(url, encrypted);
        return new DataHandle(hash);
    }

    static async fetch(sessionId, handle) {
        if (Island.hasCurrent()) throw Error("Croquet.Data.fetch() called from Model code");
        const url = dataUrl(sessionId, handle[DATAHANDLE_HASH]);
        const encrypted = await download(url);
        const key = getSessionKey(sessionId);
        return decrypt(key, encrypted);
    }

    constructor(hash) {
        const existing = HandleCache.get(hash);
        if (existing) {
            if (debug("data")) console.log(`Croquet.Data: using cached handle for ${hash}`);
            return existing;
        }
        // stored under Symbol key to be invisible to user code
        Object.defineProperty(this, DATAHANDLE_HASH, { value: hash });
        HandleCache.set(hash, this);
        if (debug("data")) console.log(`Croquet.Data: created new handle for ${hash}`);
    }

    // no other methods - API is static
}

class DataHandleModel extends Model {
    static types() {
        return {
            "@croquet.data": {
                cls: DataHandle,
                write: handle => handle[DATAHANDLE_HASH],
                read: state => new DataHandle(state),
            }
        };
    }
}
DataHandleModel.register();
