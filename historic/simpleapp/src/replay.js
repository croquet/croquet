// eslint-disable-next-line import/no-unresolved
//import { server } from "reflector";

const iframe = document.getElementsByTagName("iframe")[0];
const textarea = document.getElementsByTagName("textarea")[0];

function log(...args) {
    console.log(...args);
    textarea.value += args.join(' ') + '\n';
    textarea.scrollTop = textarea.scrollHeight;
}


const snapshotURL = window.location.hash.slice(1);
//const indexURL = `${window.location.protocol}//${window.location.host}/index.html`;

//console.log("REPLAY SERVER", server._url);

if (snapshotURL) {
//    iframe.setAttribute("src", `${indexURL}?reflector=${server._url}&replay=${snapshotURL}`);
    start();
} else {
    const html = `<html><body>No snapshot provided</body></html>`;
    iframe.setAttribute("src", "data:text/html;charset=utf-8," + escape(html));
}

async function start() {
    log(`fetching snapshot ${snapshotURL}`);
    const response = await fetch(snapshotURL, { mode: "cors" });
    const snapshot = await response.json();
    const {prelude, files, html} = await loadCode(snapshot.meta.code);
    const {entry} = snapshot.meta.code;

    // the Parcel prelude defines the main function
    //     parcelRequire = function (modules, cache, entry, globalName) {...}
    // which we want to call as
    //     parcelRequire(modules, {}, [entry], null)
    // where modules is the definition of all modules:
    //     modules = {
    //         id: [
    //             function(require,module,exports) { ...source... },
    //             { ... dependencies ...}
    //         ],
    //     }

    const modules = [];

    for (const {name, hash, imports, _source} of files) {
        const deps = Object.entries(imports||[]).map(([k,v]) => `"${k}":"${v}"`);
        modules.push(`"${hash}":/*${name}*/[function(require,module,exports) {\n \n}, {${deps.join(',')}}]`);
    }


    const combinedSources = `debugger;${prelude}\nparcelRequire({\n${modules.join(',\n')}\n}, {}, ["${entry}"], null)`
        .split("<!--").join("<\\!--")
        .split("<script").join("<\\script")
        .split("</script").join("<\\/script");          // eslint-disable-line newline-per-chained-call

    const combinedHtml = html.replace('<script src="entry.js"></script>', `<script>${combinedSources}</script>`);

    fetch('https://db.croquet.studio/files-v1/bert-test/test.html', {
            method: "PUT",
            mode: "cors",
            body: combinedHtml,
        });

    iframe.contentWindow.document.open();
    iframe.contentWindow.document.write(combinedHtml);
    iframe.contentWindow.document.close();
}


async function loadCode(stored) {
    const { base, prelude, entry, html } = stored;
    const filesToLoad = [];
    const filesToCheck = [entry];
    const checkedFiles = {};

    log(`loading code from ${base} ...`);

    // eslint-disable-next-line no-await-in-loop
    while (filesToCheck.length) await checkFile(filesToCheck.shift());

    async function fetchFile(file, ext) { return fetch(`${base}${file}.${ext}`).then(r => r[ext === 'json' ? 'json' : 'text']()); }

    async function checkFile(hash) {
        if (checkedFiles[hash]) return;
        checkedFiles[hash] = true;
        const meta = await fetchFile(hash, 'json');
        const {name, imports} = meta;
        log(`fetching ${name} from ${hash}.js`);
        filesToLoad.push({ name, hash, imports, source: fetchFile(hash, 'js') });
        await Promise.all(Object.values(imports||[]).map(checkFile));
    }

    await Promise.all(filesToLoad.map(async file => file.source = await file.source ));
    return {prelude: await fetchFile(prelude, 'js'), files: filesToLoad, html: await fetchFile(html, 'html')};
}
