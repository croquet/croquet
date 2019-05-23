import "./deduplicate";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

class UrlOptions {
    constructor() {
        if (typeof document === "undefined" || !document.location) return;
        parseUrlOptionString(this, document.location.search.slice(1));
        parseUrlOptionString(this, document.location.hash.slice(1));
        if (document.location.pathname.indexOf('/ar.html') >= 0) this.ar = true;
    }

    /**
     * has("debug", "recv", false) matches debug=recv and debug=send,recv
     *
     * has("debug", "recv", true) matches debug=norecv and debug=send,norecv
     *
     * has("debug", "recv", "localhost") defaults to true on localhost, false otherwise
     *
     * @param {String} key - key for list of items
     * @param {String} item - value to look for in list of items
     * @param {Boolean|String} defaultValue - if string, true on that hostname, false otherwise
     */
    has(key, item, defaultValue) {
        if (typeof defaultValue !== "boolean") defaultValue = this.isHost(defaultValue);
        if (defaultValue === true) item =`no${item}`;
        const urlItems = this[key];
        if (typeof urlItems !== "string") return defaultValue;
        if (urlItems.split(',').includes(item)) return !defaultValue;
        return defaultValue;
    }

    firstInHash() {
        return document.location.hash.slice(1).split("&")[0];
    }

    isHost(hostname) {
        const actualHostname = window.location.hostname;
        if (actualHostname === hostname) return true;
        if (hostname !== "localhost") return false;
        // answer true for a variety of localhost equivalents
        if (actualHostname.endsWith(".ngrok.io")) return true;
        return ["127.0.0.1", "::1"].includes(actualHostname);
    }

    isLocalhost() {
        return this.isHost("localhost");
    }
}

function parseUrlOptionString(target, optionString) {
    if (!optionString) return;
    for (const arg of optionString.split("&")) {
        const keyAndVal = arg.split("=");
        const key = keyAndVal[0];
        let val = true;
        if (keyAndVal.length > 1) {
            val = decodeURIComponent(keyAndVal.slice(1).join("="));
            if (val.match(/^(true|false|null|[0-9.]*|["[{].*)$/)) {
                try { val = JSON.parse(val); } catch (e) {
                    if (val[0] === "[") val = val.slice(1, -1).split(","); // handle string arrays
                    // if not JSON use string itself
                }
            }
        }
        target[key] = val;
    }
}

const urlOptions = new UrlOptions();
export default urlOptions;
