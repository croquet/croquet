// this is our UploadWorker

import { deflate } from 'pako/dist/pako_deflate.js';

onmessage = msg => {
    const { cmd, gzurl, stringyContent, referrer, id, debug } = msg.data;
    switch (cmd) {
        case "uploadGzipped": uploadGzipped(); break;
        default: console.error("Unknown worker command", cmd);
    }

    async function uploadGzipped() {
        try {
            const start = Date.now();
            const chars = new TextEncoder().encode(stringyContent);
            const bytes = deflate(chars, { gzip: true, level: 1 }); // sloppy but quick
            const ms = Date.now() - start;
            if (debug) console.log(`${id} Snapshot gzipping (${bytes.length} bytes) took ${Math.ceil(ms)}ms`);
            if (debug) console.log(`${id} Uploading snapshot to ${gzurl}`);
            const { ok, status, statusText} = await fetch(gzurl, {
                method: "PUT",
                mode: "cors",
                headers: { "Content-Type": "application/octet-stream" },
                referrer,
                body: bytes
            });
            if (!ok) throw Error(`server returned ${status} ${statusText} for PUT ${gzurl}`);
            if (debug) console.log(`${id} Uploaded (${status}) ${gzurl}`);
            postMessage({url: gzurl, ok, status, statusText});
        } catch(e) {
            if (debug) console.log(`${id} Upload error ${e.message}`);
            postMessage({url: gzurl, ok: false, status: -1, statusText: e.message});
        };
    }
}
