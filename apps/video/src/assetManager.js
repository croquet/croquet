import Toastify from 'toastify-js';
import { Video2DView } from "./video";

const urlOptions = { has: () => false }; // dummy object; use defaults

function getUser(key, defaultValue = undefined, initFn = null) {
    let user = {};
    try { user = JSON.parse(localStorage.croquetUser || "{}"); } catch (e) { /* ignore */ }
    if (key in user) return user[key];
    if (initFn) {
        user[key] = initFn();
        if (user[key] !== defaultValue) localStorage.croquetUser = JSON.stringify(user);
        return user[key];
    }
    return defaultValue;
}

const CROQUET_HOST = window.location.hostname.endsWith("croquet.studio") ? window.location.hostname : "croquet.studio";

function fileServer() {
    const server = typeof urlOptions.files === "string" ? urlOptions.files : `https://${CROQUET_HOST}/files-v1`;
    if (server.endsWith('/')) return server.slice(0, -1);
    return server;
}

function baseUrl(what = 'code') {
    const dev = urlOptions.has("dev", "host", "localhost");
    const host = dev ? `dev/${getUser("name", "GUEST")}/` : 'all/';
    return `${fileServer()}/${host}${what}/`;
}

function addToastifyStyle() {
    // inject toastify's standard css
    let toastifyCSS = `/*!
        * Toastify js 1.5.0
        * https://github.com/apvarun/toastify-js
        * @license MIT licensed
        *
        * Copyright (C) 2018 Varun A P
        */
        .toastify {
            padding: 12px 20px;
            color: #ffffff;
            display: inline-block;
            box-shadow: 0 3px 6px -1px rgba(0, 0, 0, 0.12), 0 10px 36px -4px rgba(77, 96, 232, 0.3);
            background: -webkit-linear-gradient(315deg, #73a5ff, #5477f5);
            background: linear-gradient(135deg, #73a5ff, #5477f5);
            position: fixed;
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.215, 0.61, 0.355, 1);
            border-radius: 2px;
            cursor: pointer;
            text-decoration: none;
            max-width: calc(50% - 20px);
            z-index: 2147483647;
        }
        .toastify.on {
            opacity: 1;
        }
        .toast-close {
            opacity: 0.4;
            padding: 0 5px;
        }
        .toastify-right {
            right: 15px;
        }
        .toastify-left {
            left: 15px;
        }
        .toastify-top {
            top: -150px;
        }
        .toastify-bottom {
            bottom: -150px;
        }
        .toastify-rounded {
            border-radius: 25px;
        }
        .toastify-avatar {
            width: 1.5em;
            height: 1.5em;
            margin: 0 5px;
            border-radius: 2px;
        }
        @media only screen and (max-width: 360px) {
            .toastify-right, .toastify-left {
                margin-left: auto;
                margin-right: auto;
                left: 0;
                right: 0;
                max-width: fit-content;
            }
        }
`;
    // add our own preferences
    toastifyCSS += `
        .toastify { font-family: sans-serif; border-radius: 8px; }
`;
    const toastifyStyle = document.createElement("style");
    toastifyStyle.innerHTML = toastifyCSS;
    document.head.appendChild(toastifyStyle);
}

addToastifyStyle();

export function displayError(msg, options) {
    return msg && displayToast(msg, { backgroundColor: "red", ...options });
}

export function displayWarning(msg, options) {
    return msg && displayToast(msg, { backgroundColor: "gold", ...options });
}

export function displayStatus(msg, options) {
    return msg && displayToast(msg, { backgroundColor: "#aaa", ...options });
}

export function displayAppError(where, error) {
    const userStack = error.stack.split("\n").filter(l => !l.match(/croquet-.*\.min.js/)).join('\n');
    displayError(`<b>Error during ${where}: ${error.message}</b>\n\n${userStack}`.replace(/\n/g, "<br>"), {
        duration: 10000,
        stopOnFocus: true,
    });
}

function displayToast(msg, options) {
    const toastOpts = {
        text: msg,
        duration: 3000,
        //close: true,
        gravity: 'bottom', // `top` or `bottom`
        position: 'left', // `left`, `center` or `right`
        backgroundColor: 'linear-gradient(to right, #00b09b, #96c93d)',
        stopOnFocus: true, // Prevents dismissing of toast on hover
        ...options
    };
    return Toastify(toastOpts).showToast();
}

export function toBase64url(bits) {
    return btoa(String.fromCharCode(...new Uint8Array(bits)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

async function hashBuffer(buffer) {
    const bits = await window.crypto.subtle.digest("SHA-256", buffer);
    return toBase64url(bits);
}

const BASE_URL = baseUrl('assets');
const makeBlobUrl = blobHash => `${BASE_URL}${blobHash}.blob`;

const MAX_IMPORT_FILES = 10; // reject any drop over this number
const MAX_IMPORT_MB = 100; // aggregate

export class AssetManager {
    constructor(frame) {
        this.frame = frame;
        this.assetCache = {};
        this.knownAssetURLs = {};
    }

    async handleFileDrop(items, roomModel, roomView) {
        // build one or more assetDescriptors: each an object { displayName, fileDict, loadType,
        // loadPaths } where fileDict is a dictionary mapping file paths (relative to the drop)
        // to file specs with blobs and hashes; loadType is a string that directs loading
        // to the appropriate import function; loadPaths is a dictionary mapping the
        // aliases used by the import functions to the corresponding file paths.
        const importSizeChecker = this.makeImportChecker();
        const specPromises = [];

        // a DataItemsList doesn't support forEach
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const entry =
                item.getAsEntry ? item.getAsEntry() :
                    item.webkitGetAsEntry ? item.webkitGetAsEntry() :
                        null;

            if (entry) {
                let specArrayPromise = Promise.resolve().then(() => importSizeChecker.withinLimits);

                if (entry.isDirectory) {
                    specArrayPromise = specArrayPromise.then(ok => ok
                        ? this.analyzeDirectory(entry, importSizeChecker)
                        : null
                    );
                } else {
                    // a single file
                    const file = item.getAsFile(); // getAsFile() is a method of DataTransferItem
                    const fileType = this.getFileType(file.name);
                    specArrayPromise = specArrayPromise.then(ok => ok
                        ? this.fetchSpecForDroppedFile(file, fileType).then(fileSpec => {
                            if (fileSpec && importSizeChecker.addItem(fileSpec)) {
                                fileSpec.path = file.name;
                                fileSpec.depth = 1;
                                return [fileSpec];
                            }
                            return null;
                        })
                        : null
                    );
                }
                specPromises.push(specArrayPromise);
            }
        }

        const specArrays = (await Promise.all(specPromises)).filter(Boolean); // filter out any nulls.
        this.displayAssets(specArrays, importSizeChecker, { roomModel, roomView });
    }

    async displayAssets(specArrays, importSizeChecker, options = {}) {
        if (!importSizeChecker.withinLimits) {
            displayError(importSizeChecker.limitReason, { duration: 5000 });
            return;
        }
        if (!specArrays.length) return; // empty for some reason other than overflow

        const assetDescriptors = (await Promise.all(specArrays.map(specs => this.deriveAssetDescriptor(specs, importSizeChecker.totalBytes)))).filter(Boolean); // each spec will track its own upload progress.  unrecognised file type will give a null.
        if (!assetDescriptors.length) return;

        // sort by displayName (name of the main file that will be loaded)
        if (assetDescriptors.length > 1) assetDescriptors.sort((a, b) => a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0);
        console.log(assetDescriptors.map(loadSpec => loadSpec.displayName));

        // from each assetDescriptor obtain one or more maker functions - functions that will
        // each make an object to be displayed in the world.
        // a spreadsheet with multiple sheets, for example, will provide a function for
        // each sheet.
        const makerFnArrays = await Promise.all(assetDescriptors.map(assetDescriptor => this.prepareMakerFunctions(assetDescriptor)));
        const makerFns = [];
        makerFnArrays.forEach(arr => { if (arr) makerFns.push(...arr); });
        if (makerFns.length === 0) return;

        const loadOptions = Object.assign({}, options);
        if (makerFns.length > 1) displayWarning(`only loading first of ${makerFns.length} dropped objects`);
        makerFns[0](loadOptions);
    }

    getFileType(fileName) {
        const fileExtensionTest = /\.([0-9a-z]+)(?=[?#])|(\.)(?:[\w]+)$/;
        const match = fileName.match(fileExtensionTest);
        return match ? match[0].toLowerCase() : "";
    }

    async fetchSpecForDroppedFile(file, fileType) {
        const reader = new FileReader();
        try {
            const buffer = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
            const mimeType = fileType === ".mp4" ? "video/mp4" : null; // so far, mp4 is the only case that seems to matter (in Safari); see fetchSharedBlob()
            return { name: file.name, type: fileType, blob: file, buffer, mimeType };
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    async fetchSpecForURL(urlStr) {
        // NB: now returns a fileSpec with a buffer, suitable for a caller to hash iff
        // it decides to go ahead with the load
        const response = await fetch(urlStr, { mode: "cors" });
        if (!response.ok) return null;

        const buffer = await response.arrayBuffer();
        const pathAndName = urlStr.match(/^(.*\/)?([^/]*)$/);
        const fileName = pathAndName[2], type = this.getFileType(fileName);
        return { path: urlStr, name: fileName, type, buffer };
    }

    async analyzeDirectory(dirEntry, importSizeChecker) {
        // recursively examine the directory contents, returning a collection of
        // { depth, path, name, type, blob, hash } objects

        const filePromises = [];
        const todo = [{ path: '', entry: dirEntry, depth: 0 }];

        return new Promise(resolve => {
            const processEntries = () => {
                if (todo.length === 0) {
                    resolve(); // no more files to read.  move along.
                    return;
                }

                const { path, entry, depth } = todo.pop();
                if (entry.isDirectory) {
                    entry.createReader().readEntries(entries => {
                        for (const entryInDir of entries) {
                            todo.push({ path: (path && path + '/') + entryInDir.name, entry: entryInDir, depth: depth + 1 });
                        }
                        processEntries(); // keep going, including whatever we just added
                    });
                } else {
                    // file() is a method of FileSystemFileEntry
                    filePromises.push(new Promise(resolve1 => {
                        if (!importSizeChecker.withinLimits) resolve1(null);

                        entry.file(async file => {
                            const fileType = this.getFileType(file.name);
                            const spec = await this.fetchSpecForDroppedFile(file, fileType);
                            spec.path = path;
                            spec.depth = depth;
                            resolve1(importSizeChecker.addItem(spec) ? spec : null);
                        });
                    })
                    );
                    processEntries(); // keep going (without waiting)
                }
            };
            processEntries(); // get started
        }).then(() => Promise.all(filePromises)
        ).then(fileSpecs => importSizeChecker.withinLimits ? fileSpecs : null);
    }

    makeImportChecker() {
        let totalFiles = 0, totalSize = 0;
        const checker = {
            addItem(spec) {
                if (!this.withinLimits) return false;

                totalFiles++;
                totalSize += spec.buffer.byteLength;
                return this.withinLimits;
            },
            get withinLimits() {
                return totalFiles <= MAX_IMPORT_FILES && totalSize <= 1048576 * MAX_IMPORT_MB;
            },
            get limitReason() {
                return totalFiles > MAX_IMPORT_FILES ? `exceeded limit of ${MAX_IMPORT_FILES} files`
                    : totalSize > 1048576 * MAX_IMPORT_MB ? `exceeded limit of ${MAX_IMPORT_MB}MB`
                        : "";
            },
            get totalBytes() { return totalSize; }
        };
        return checker;
    }

    async deriveAssetDescriptor(fileSpecs, totalBytes) {
        const loadPaths = {};
        const byType = {};
        const topSpecs = fileSpecs.filter(spec => spec.depth === 1);
        if (topSpecs.length === 0) return null;
        topSpecs.forEach(spec => {
            const type = spec.type;
            let typeFiles = byType[type];
            if (!typeFiles) typeFiles = byType[type] = [];
            typeFiles.push(spec);
        });
        const priorityTypes = [ /* ".js", */ ".obj", ".gltf", ".glb"]; // if any of these is found, it defines the load type
        let ti = 0, loadType = null, displayName;
        while (!loadType && ti < priorityTypes.length) {
            const type = priorityTypes[ti];
            const typeFiles = byType[type];
            if (typeFiles) {
                if (typeFiles.length > 1) return null; // ambiguous; just reject
                displayName = typeFiles[0].name;
                const mainPath = typeFiles[0].path;
                if (type === ".obj") {
                    const mtls = byType['.mtl'];
                    if (mtls) {
                        if (mtls.length > 1) return null; // ambiguous
                        loadPaths.mtlSource = mtls[0].path;
                    }
                    loadPaths.objSource = mainPath;
                } else {
                    loadPaths.source = mainPath;
                }
                loadType = type;
            }
            ti++;
        }
        if (!loadType) {
            const handledTypes = [ ".mp4" ];
            const handlableSpecs = topSpecs.filter(spec => handledTypes.indexOf(spec.type) >= 0);
            if (handlableSpecs.length) {
                if (handlableSpecs.length > 1) displayError(`Ambiguous drop (${handlableSpecs.map(spec => spec.type).join(", ")})`, { duration: 5000 });
                else {
                    const spec = handlableSpecs[0];
                    displayName = spec.name;
                    loadPaths.source = spec.path;
                    switch (spec.type) {
                        case ".mp4":
                            loadType = spec.type;
                            break;
                        default:
                    }
                }
            }
        }
        if (!loadType) {
            displayError("No loadable file found", { duration: 5000 });
            return null;
        }

        const start = Date.now();
        let statusToast = null, bytesSoFar = 0;
        const reportBytes = bytes => {
            bytesSoFar += bytes;
            const statusMsg = `uploading assets... ${Math.round(bytesSoFar / totalBytes * 100)}%`;
            if (!statusToast && Date.now() - start > 500) {
                statusToast = displayStatus(statusMsg, { duration: 600000 }); // stick around until we remove explicitly
            } else if (statusToast) {
                statusToast.toastElement.textContent = statusMsg;
            }
        };
        await Promise.all(fileSpecs.map(spec => this.hashAndStoreIfNeeded(spec, reportBytes)));
        if (statusToast) statusToast.hideToast();
        const fileDict = {};
        fileSpecs.forEach(spec => fileDict[spec.path] = spec);
        return { displayName, fileDict, loadType, loadPaths };
    }

    async hashAndStoreIfNeeded(fileSpec, reportBytes) {
        const buffer = fileSpec.buffer;
        delete fileSpec.buffer;
        if (!fileSpec.blob) fileSpec.blob = new Blob([buffer], { type: 'application/octet-stream' });

        const hash = await hashBuffer(buffer);
        this.assetCache[hash] = fileSpec.blob;
        fileSpec.hash = hash;
        fileSpec.blobURL = makeBlobUrl(hash);
        await this.ensureBlobIsShared(fileSpec.blobURL, fileSpec.blob, fileSpec.name, reportBytes);

        return fileSpec;
    }

    prepareMakerFunctions(assetDescriptor) {
        // assetDescriptor is { displayName, fileDict, loadType, loadPaths }
        // return an array of one or more functions which, if invoked with options
        // (that on arcos would include containment: raw, window etc),
        // will build a suitable shared Model.
        return [options => this.makeImportedModel(assetDescriptor, options)];
    }

    makeImportedModel(assetDescriptor, options) {
        const { roomModel: model, roomView: view } = options;
        const modelId = model.parts ? model.parts.elements.id : model.id;
        //roomView.parts.elementViewManager.addElementManipulators = false;
        view.publish(modelId, "addAsset", { assetDescriptor: this.makeShareableDescriptor(assetDescriptor) });
    }

    makeDescriptor(loadType, loadPaths) {
        return { fileDict: {}, loadType, loadPaths };
    }

    makeShareableDescriptor(assetDescriptor) {
        // need to strip the supplied assetDescriptor of any blobs
        const { displayName, fileDict, loadType, loadPaths } = assetDescriptor;
        const newFileDict = {};
        Object.keys(fileDict).forEach(path => {
            const fileSpec = fileDict[path];
            const newFileSpec = Object.assign({}, fileSpec);
            delete newFileSpec.blob;
            delete newFileSpec.depth;
            newFileDict[path] = newFileSpec;
        });
        return { displayName, fileDict: newFileDict, loadType, loadPaths };
    }

    ensureBlobIsShared(blobURL, blob, name = "", reportBytes) {
        let promise = this.knownAssetURLs[blobURL];
        if (!promise) {
            promise = this.knownAssetURLs[blobURL] = new Promise((resolve, reject) => {
                const upload = () => {
                    try {
                        console.log(`uploading ${name} to shared asset store`);
                        const xhr = new XMLHttpRequest();

                        let bytesSoFar = 0;
                        xhr.upload.addEventListener("progress", e => {
                            if (e.lengthComputable && reportBytes) {
                                const bytesNow = e.loaded;
                                reportBytes(bytesNow - bytesSoFar);
                                bytesSoFar = bytesNow;
                            }
                        });

                        xhr.upload.addEventListener("load", () => {
                            console.log(`${name} upload finished`);
                            resolve();
                        });

                        xhr.open("PUT", blobURL);
                        xhr.send(blob);
                    } catch (error) { reject(); }
                };

                // see if it's already there
                fetch(blobURL, { method: 'HEAD' })
                    .then(response => {
                        if (response.ok) resolve(); // apparently it is
                        else upload();
                    }).catch(_err => upload());
            });
        }
        return promise;
    }

    fetchSharedBlob(blobURL, optionalType) {
        const retryDelay = 1000;
        let retries = 60;
        return new Promise(resolved => {
            const getBlob = () => fetch(blobURL, { mode: "cors" })
                .then(response => {
                    // build the Blob ourselves, so we can set its type (introduced as a workaround to Safari refusing to play an untyped mp4 blob)
                    if (response.ok) return response.arrayBuffer();
                    throw new Error('Network response was not ok.');
                })
                .then(arrayBuffer => {
                    this.knownAssetURLs[blobURL] = true;
                    const options = optionalType ? { type: optionalType } : {};
                    const blob = new Blob([arrayBuffer], options);
                    resolved(blob);
                })
                .catch(() => {
                    if (retries === 0) console.error(`blob never arrived: ${blobURL}`);
                    else {
                        console.log(`waiting for blob: ${blobURL}`);
                        retries--;
                        setTimeout(getBlob, retryDelay);
                    }
                });
            getBlob();
        });
    }

    loadThroughCache(key, promiseFn) {
        let promise = this.assetCache[key];
        if (!promise) promise = this.assetCache[key] = promiseFn();
        return promise;
    }

    async objectURLForName(assetDescriptor, loadPathName) {
        const path = assetDescriptor.loadPaths[loadPathName];
        return path ? this.objectURLForPath(assetDescriptor, path) : null;
    }

    async objectURLForPath(assetDescriptor, path) {
        const blob = await this.blobForPath(assetDescriptor, path);
        const url = URL.createObjectURL(blob);
        const revoke = () => { URL.revokeObjectURL(url); return null; }; // return null to support "urlObj.revoke() || result" usage
        return { url, revoke };
    }

    async blobForPath(assetDescriptor, path) {
        // if there is no record for the specified path (i.e., URL),
        // fill in its details as part of this fetch
        let fileSpec = assetDescriptor.fileDict[path];
        if (!fileSpec) {
            fileSpec = await this.fetchSpecForURL(path);
            if (fileSpec) await this.hashAndStoreIfNeeded(fileSpec);
            assetDescriptor.fileDict[path] = fileSpec; // null in case of error
        }
        if (!fileSpec) return fileSpec;

        let blob;
        // if there is a hash, use it to create a cache key.  if not, don't try to cache.
        if (fileSpec.hash) {
            const cacheKey = fileSpec.hash;
            const promiseFn = () => fileSpec.blob || this.fetchSharedBlob(fileSpec.blobURL, fileSpec.mimeType);
            blob = await this.loadThroughCache(cacheKey, promiseFn);
        } else blob = fileSpec.blob; // assuming it's there.
        return blob;
    }

    ensureFetchesAreRecorded(assetDescriptor) {
        // check that there is a fileSpec for every path in loadPaths, and for
        // every other existing entry in the fileDict
        const { fileDict, loadPaths } = assetDescriptor;
        Object.values(loadPaths).forEach(urlStr => { if (fileDict[urlStr] === undefined) fileDict[urlStr] = null; });
        const pendingFetches = [];
        Object.keys(fileDict).forEach(urlStr => {
            if (fileDict[urlStr] === null) {
                console.warn(`recording fetch of ${urlStr}`);
                pendingFetches.push(this.fetchSpecForURL(urlStr).then(fileSpec => {
                    if (fileSpec) { // successful fetch
                        fileDict[urlStr] = fileSpec;
                        return this.hashAndStoreIfNeeded(fileSpec);
                    }

                    console.warn(`failed fetch for ${urlStr}`);
                    delete fileDict[urlStr];
                    return null;
                }));
            }
        });
        return Promise.all(pendingFetches);
    }

    async ensureAssetsAvailable(assetDescriptor) {
        const blobURLDict = {};
        Object.values(assetDescriptor.fileDict).forEach(fileSpec => blobURLDict[fileSpec.blobURL] = true);
        // ids, retryMessage, retryDelay, maxRetries
        const status = await this.ensureBlobsAvailable(Object.keys(blobURLDict),
            "waiting for asset docs to appear on server...",
            1000, 60);
        if (status !== 'ok') throw Error("failed to find assets");

        Object.keys(blobURLDict).forEach(blobURL => this.knownAssetURLs[blobURL] = true);
        return status;
    }

    ensureBlobsAvailable(blobURLs, retryMessage, retryDelay, maxRetries) {
        let retries = maxRetries;
        const waitingFor = {};
        blobURLs.forEach(blobURL => waitingFor[blobURL] = true);
        const runAssetCheck = whenReady => {
            const urls = Object.keys(waitingFor);
            Promise.all(urls.map(blobURL => fetch(blobURL, { method: 'HEAD' })
                .then(response => {
                    // if successful, remove from list
                    if (response.ok) delete waitingFor[blobURL];
                }).catch(_err => { /* ignore */ })
            )).then(() => {
                if (Object.keys(waitingFor).length === 0) whenReady("ok");
                else {
                    // still some URLs to process

                    /* eslint-disable-next-line no-lonely-if */
                    if (retries === 0) whenReady(null);
                    else {
                        if (retryMessage) console.log(retryMessage);
                        retries--;
                        setTimeout(() => runAssetCheck(whenReady), retryDelay);
                    }
                }
            });
        };
        return new Promise(runAssetCheck);
    }

    async importVideo(assetDescriptor) {
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        return (new Video2DView(urlObj.url)).readyPromise; // must hold off from revoking URL until object is destroyed; see Video2DView.dispose()
    }
}
export const theAssetManager = new AssetManager();
