const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

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

export default urlOptions;
