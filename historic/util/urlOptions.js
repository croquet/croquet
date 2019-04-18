const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const urlOptions = {};

function parseUrl() {
    if (typeof document === "undefined" || !document.location) return;
    parseUrlOptionString(document.location.search.slice(1));
    parseUrlOptionString(document.location.hash.slice(1));
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

// has('debug', 'recv') matches debug=recv and debug=send,recv
urlOptions.has = (key, optVal) => {
    const val = urlOptions[key];
    if (!val || !optVal) return val;
    if (val === optVal) return true;
    if (typeof val !== "string") return false;
    const vals = string.split(',');
    return vals.includes(optVal);
}


export default urlOptions;
