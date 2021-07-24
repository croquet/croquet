// this is our UploadWorker

import { deflate } from 'pako/dist/pako_deflate.js'; // eslint-disable-line import/extensions
import Base64 from "crypto-js/enc-base64";
import AES from "crypto-js/aes";
import SHA256 from "crypto-js/sha256";
import WordArray from "crypto-js/lib-typedarrays";
import HmacSHA256 from "crypto-js/hmac-sha256";

onmessage = msg => {
    const { job, cmd, server, path: templatePath, apiKey, buffer, keyBase64, gzip, referrer, id, appId, islandId, debug, what } = msg.data;
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
        const url = `${server}/${path}`;
        if (!apiKey) return { url, uploadUrl: url };
        const { fault, read, write } = await fetch(url, {
            headers: {
                "X-Croquet-Auth": apiKey,
                "X-Croquet-App": appId,
                "X-Croquet-Id": islandId,
            },
            referrer
        });
        if (fault) throw Error(fault.faultstring);
        return { url: read, uploadUrl: write };
    }

    async function uploadEncrypted(path) {
        try {
            const body = encrypt(gzip ? compress(buffer) : buffer);
            if (path.includes("%HASH%")) path = path.replace("%HASH%", hash(body));
            const { uploadUrl, url } = await getUploadUrl(path);
            const start = Date.now();
            const { ok, status, statusText} = await fetch(uploadUrl, {
                method: "PUT",
                mode: "cors",
                headers: {
                    "Content-Type": "application/octet-stream",
                    "X-Croquet-App": appId,
                    "X-Croquet-Id": islandId,
                },
                referrer,
                body
            });
            if (!ok) throw Error(`server returned ${status} ${statusText} for PUT ${uploadUrl}`);
            if (debug) console.log(`${id} ${what} uploaded (${status}) in ${Date.now() - start}ms ${url}`);
            postMessage({job, url, ok, status, statusText});
        } catch (e) {
            if (debug) console.log(`${id} upload error ${e.message}`);
            postMessage({job, ok: false, status: -1, statusText: e.message});
        }
    }
};
