const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const urlOptions = {};

function parseUrl() {
    if (typeof document === "undefined" || !document.location) return;
    parseUrlOptionString(document.location.search.slice(1));
    parseUrlOptionString(document.location.hash.slice(1));
    if (document.location.pathname.indexOf('ar.html') >= 0) urlOptions.ar = true;
}

function parseUrlOptionString(optionString) {
    if (!optionString) return;
    for (const arg of optionString.split("&")) {
        const keyAndVal = arg.split("=");
        const key = keyAndVal[0];
        let val = true;
        if (keyAndVal.length > 1) {
            val = decodeURIComponent(keyAndVal.slice(1).join("="));
            if (val.match(/^(true|false|null|[0-9"[{].*)$/)) {
                try { val = JSON.parse(val); } catch (e) {
                    if (val[0] === "[") val = val.slice(1, -1).split(","); // handle string arrays
                    // if not JSON use string itself
                }
            }
        }
        urlOptions[key] = val;
    }
}

parseUrl();

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
urlOptions.has = (key, item, defaultValue) => {
    if (typeof defaultValue !== "boolean") defaultValue = window.location.hostname === defaultValue;
    if (defaultValue === true) item =`no${item}`;
    const urlItems = urlOptions[key];
    if (typeof urlItems !== "string") return defaultValue;
    if (urlItems.split(',').includes(item)) return !defaultValue;
    return defaultValue;
};

urlOptions.firstInHash = () => {
    return document.location.hash.slice(1).split("&")[0];
};

export default urlOptions;


/*
 * The following code is completely unrelated. It's only in here because urlOptions.js
 * has no imports, so it will be loaded very early.
 */

// work around https://github.com/parcel-bundler/parcel/issues/1838
deduplicateModules();
function deduplicateModules() {
    const b = module.bundle;
    const later = new Map();
    const fixed = new Set();
    for (const [k, m] of Object.entries(b.modules)) {
        for (const [n, long] of Object.entries(m[1])) {
            const short = long.replace("/teatime/node_modules/@croquet/util/", "/util/");
            if (long !== short && b.modules[short]) {
                if (b.cache[long]) later.set(short, long);   // longer name already loaded
                else {
                    m[1][n] = short;                         // use shortened name
                    delete b.modules[long];                  // delete duplicate
                    fixed.add(long);
                }
            }
        }
    }
    for (const [k, m] of Object.entries(b.modules)) {
        for (const [n, short] of Object.entries(m[1])) {
            const long = later.get(short);
            if (long && b.modules[long]) {
                m[1][n] = long;                              // use longer name
                delete b.modules[short];                     // delete duplicate
                fixed.add(long);
            }
        }
    }
    for (const fix of fixed) console.log("Deduplicating import of", fix);
}
