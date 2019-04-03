// eslint-disable-next-line import/no-unresolved
//import { server } from "reflector";

const iframe = document.getElementsByTagName("iframe")[0];

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
    const response = await fetch(snapshotURL, { mode: "cors" });
    const snapshot = await response.json();
    const filesToLoad = await loadCode(snapshot.meta.code);
    for (const file of filesToLoad) {
        console.log(file.name, file.generated.js.length, file.id, file.deps);
    }
}


async function loadCode(stored) {
    const { base, entry } = stored;
    const filesToLoad = [];
    const filesToCheck = [entry];
    const checkedFiles = {};

    // eslint-disable-next-line no-await-in-loop
    while (filesToCheck.length) await checkFile(filesToCheck.shift());

    async function checkFile(hash) {
        if (checkedFiles[hash]) return;
        checkedFiles[hash] = true;
        const meta = await fetch(`${base}${hash}.json`).then(r => r.json());
        const {name, imports} = meta;
        filesToLoad.push({
            name,
            id: hash,
            type: "js",
            deps: imports,
            generated: fetch(`${base}${hash}.js`).then(r => r.text()),
        });
        await Promise.all(Object.values(imports||[]).map(checkFile));
    }

    await Promise.all(filesToLoad.map(async file => file.generated = { js: await file.generated }));
    return filesToLoad;
}
