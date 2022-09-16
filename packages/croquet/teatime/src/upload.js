// this is our UploadWorker

import { deflate } from 'pako/dist/pako_deflate.js'; // eslint-disable-line import/extensions
import Base64 from "crypto-js/enc-base64";
import AES from "crypto-js/aes";
import SHA256 from "crypto-js/sha256";
import WordArray from "crypto-js/lib-typedarrays";
import HmacSHA256 from "crypto-js/hmac-sha256";

/* eslint-disable-next-line */
const NODE = _IS_NODE_; // replaced by rollup

let fetcher, poster, https;
if (NODE) {
    /* eslint-disable global-require */
    https = require('https');
    const { parentPort } = require('worker_threads');
    parentPort.on('message', msg => handleMessage({ data: msg }));
    fetcher = nodeFetch;
    poster = msg => parentPort.postMessage({ data: msg });
} else {
    onmessage = handleMessage;
    fetcher = fetch;
    poster = postMessage;
}

function handleMessage(msg) {
    const { job, cmd, server, path: templatePath, buffer, keyBase64, gzip,
        referrer, id, appId, persistentId, CROQUET_VERSION, debug, what } = msg.data;
    switch (cmd) {
        case "uploadEncrypted": uploadEncrypted(templatePath); break;
        default: console.error("Unknown worker command", cmd);
    }

    function encrypt(bytes) {
        const start = Date.now();
        const plaintext = WordArray.create(bytes);
        const key = Base64.parse(keyBase64);
        const hmac = HmacSHA256(plaintext, key);
        const iv = WordArray.random(16);
        const { ciphertext } = AES.encrypt(plaintext, key, { iv });
        // Version 0 used Based64:
        // const encrypted = "CRQ0" + [iv, hmac, ciphertext].map(wordArray => wordArray.toString(Base64)).join('');
        // Version 1 is binary:
        const encrypted = new ArrayBuffer(4 + iv.sigBytes + hmac.sigBytes + ciphertext.sigBytes);
        const view = new DataView(encrypted);
        let i = 0;
        view.setUint32(i, 0x43525131, false); i += 4; //"CRQ1"
        // CryptoJS WordArrays are big-endian
        for (const array of [iv, hmac, ciphertext]) {
            for (const word of array.words) {
                view.setInt32(i, word, false); i += 4;
            }
        }
        if (debug) console.log(`${id} ${what} encrypted (${encrypted.byteLength} bytes) in ${Date.now() - start}ms`);
        return encrypted;
    }

    function compress(bytes) {
        const start = Date.now();
        const compressed = deflate(bytes, { gzip: true, level: 1 }); // sloppy but quick
        if (debug) console.log(`${id} ${what} compressed (${compressed.length} bytes) in ${Date.now() - start}ms`);
        return compressed;
    }

    function hash(bytes) {
        const start = Date.now();
        const sha256 = SHA256(WordArray.create(bytes));
        const base64 = Base64.stringify(sha256);
        const base64url = base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        if (debug) console.log(`${id} ${what} hashed (${bytes.length} bytes) in ${Date.now() - start}ms`);
        return base64url;
    }

    async function getUploadUrl(path) {
        const start = Date.now();
        const url = `${server.url}/${path}`;
        if (!server.apiKey) return { url, uploadUrl: url };

        const response = await fetcher(url, {
            headers: {
                "X-Croquet-Auth": server.apiKey,
                "X-Croquet-App": appId,
                "X-Croquet-Id": persistentId,
                "X-Croquet-Session": id,
                "X-Croquet-Version": CROQUET_VERSION,
                "X-Croquet-Path": (new URL(referrer)).pathname,
            },
            referrer
            });

        const { ok, status, statusText } = response;
        if (!ok) throw Error(`Error in signing URL: ${status} - ${statusText}`);

        const { error, read, write } = await response.json();
        if (error) throw Error(error);
        if (debug) console.log(`${id} ${what} authorized in ${Date.now() - start}ms`);
        return { url: read, uploadUrl: write };
    }

    async function uploadEncrypted(path) {
        try {
            let body = encrypt(gzip ? compress(buffer) : buffer);
            if (NODE) body = new Uint8Array(body); // buffer needs to be put in an array
            if (path.includes("%HASH%")) path = path.replace("%HASH%", hash(body));
            const { uploadUrl, url } = await getUploadUrl(path);
            const start = Date.now();
            const { ok, status, statusText } = await fetcher(uploadUrl, {
                method: "PUT",
                mode: "cors",
                headers: {
                    "Content-Type": "application/octet-stream",
                    "X-Croquet-App": appId,
                    "X-Croquet-Id": persistentId,
                    "X-Croquet-Session": id,
                    "X-Croquet-Version": CROQUET_VERSION,
                },
                referrer,
                body
            });
            if (!ok) throw Error(`server returned ${status} ${statusText} for PUT ${uploadUrl}`);
            if (debug) console.log(`${id} ${what} uploaded (${status}) in ${Date.now() - start}ms ${url}`);
            poster({ job, url, ok, status, statusText });
        } catch (e) {
            if (debug) console.log(`${id} upload error ${e.message}`);
            poster({ job, ok: false, status: -1, statusText: e.message });
        }
    }
}

function nodeFetch(requestUrl, options) {
    // send a native https request, and respond with an object providing the bare
    // interface of a fetch() response: { ok, status, statusText, json() }.
    // json() is only added if ok is true.
    // options.referrer is currently ignored.
    // We could send the "Referer" [sic] header but in Node there typically is no referrer URL
    return new Promise((resolve, reject) => {
        const urlObj = new URL(requestUrl);
        const requestOptions = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers,
            };

        const req = https.request(requestOptions, res => {
            let json = '';
            res.on('data', chunk => json += chunk);

            res.on('end', () => {
                const { statusCode, statusMessage } = res;
                const ok = statusCode >= 200 && statusCode < 300;
                const report = { ok, status: statusCode, statusText: statusMessage };
                if (ok) report.json = () => JSON.parse(json); // will give an error if json is empty.  caveat emptor.
                resolve(report);
                });
            });

        req.on('error', error => {
            reject(error);
            });

        if (options.body) req.write(options.body);
        req.end();
    });
}
