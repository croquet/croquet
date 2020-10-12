// this is our UploadWorker

import { deflate } from 'pako/dist/pako_deflate.js';
import Base64 from "crypto-js/enc-base64";
import AES from "crypto-js/aes";
import WordArray from "crypto-js/lib-typedarrays";
import HmacSHA256 from "crypto-js/hmac-sha256";

onmessage = msg => {
    const { cmd, url, stringyContent, keyBase64, referrer, id, debug } = msg.data;
    switch (cmd) {
        case "uploadGzippedEncrypted": uploadGzippedEncrypted(); break;
        default: console.error("Unknown worker command", cmd);
    }

    function encrypt(bytes) {
        const start = Date.now();
        const plaintext = WordArray.create(bytes);
        const key = Base64.parse(keyBase64);
        const hmac = HmacSHA256(plaintext, key);
        const iv = WordArray.random(16);
        const { ciphertext } = AES.encrypt(plaintext, key, { iv });
        const encrypted = "CRQ0" + [iv, hmac, ciphertext].map(wordArray => wordArray.toString(Base64)).join('');
        if (debug) console.log(`${id} Snapshot encryption (${encrypted.length} bytes) took ${Math.ceil(Date.now() - start)}ms`);
        return encrypted;
    }

    async function uploadGzippedEncrypted() {
        try {
            const start = Date.now();
            const chars = new TextEncoder().encode(stringyContent);
            const gzipped = deflate(chars, { gzip: true, level: 1 }); // sloppy but quick
            if (debug) console.log(`${id} Snapshot gzipping (${gzipped.length} bytes) took ${Math.ceil(Date.now() - start)}ms`);
            const encrypted = encrypt(gzipped);
            if (debug) console.log(`${id} Uploading snapshot to ${url}`);
            const { ok, status, statusText} = await fetch(url, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/octet-stream" },
                referrer,
                body: encrypted
            });
            if (!ok) throw Error(`server returned ${status} ${statusText} for PUT ${url}`);
            if (debug) console.log(`${id} Uploaded (${status}) ${url}`);
            postMessage({url, ok, status, statusText});
        } catch(e) {
            if (debug) console.log(`${id} Upload error ${e.message}`);
            postMessage({url, ok: false, status: -1, statusText: e.message});
        };
    }
}
