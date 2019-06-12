import * as THREE from 'three';
import JSZip from "jszip";
import { baseUrl, hashBuffer } from "@croquet/util/modules";
import SpatialPart from './modelParts/spatial';
import Tracking from './viewParts/tracking';
import Clickable from './viewParts/clickable';
import { makePointerSensitive, ignorePointer, PointerEvents } from "./viewParts/pointer";
import { ModelPart, ViewPart, ViewEvents } from './parts';
import SVGIcon from "./util/svgIcon";
import soundOn from "../assets/sound-on.svg";
import remoteHand from "../assets/pointing-hand.svg";

// @@ some (Bert-sanctioned) contortions needed to get the imports working.  all libraries (including inflate, needed for FBXLoader) were downloaded from https://github.com/mrdoob/three.js/tree/master/src/loaders and https://github.com/mrdoob/three.js/tree/master/examples/js/libs on 4 jun 2019
window.THREE = THREE;
const Zlib = require("../thirdparty/three/inflate.min").Zlib;
window.Zlib = Zlib;
require("../thirdparty/three/OBJLoader");
require("../thirdparty/three/ColladaLoader");
require("../thirdparty/three/OBJLoader");
require("../thirdparty/three/MTLLoader");
require("../thirdparty/three/GLTFLoader");
require("../thirdparty/three/LegacyGLTFLoader");
require("../thirdparty/three/FBXLoader");
require("../thirdparty/three/STLLoader");

// DRACOLoader is a bit more complicated
require("../thirdparty/three/DRACOLoader");
const DracoDecoderModule = require("../thirdparty/three/draco/gltf/draco_decoder");
THREE.DRACOLoader.setDecoderConfig({ type: 'js' });
THREE.DRACOLoader.decoderModulePromise = Promise.resolve({ decoder: DracoDecoderModule(THREE.DRACOLoader.decoderConfig) });
require("../thirdparty/three/SkeletonUtils"); // for cloning models with SkinnedMeshes
//THREE.DRACOLoader.setDecoderPath("http://localhost:8000/croquet/kit/thirdparty/draco/gltf/"); the standard way of pointing DRACOLoader to its decoders.  if we can figure out a way to work this in with Parcel

const BASE_URL = baseUrl('assets');
const makeBlobUrl = blobHash => `${BASE_URL}${blobHash}.blob`;

const MAX_IMPORT_FILES = 100; // reject any drop over this number
const MAX_IMPORT_MB = 100; // aggregate

const TOUCH = 'ontouchstart' in document.documentElement;

// adapted from arcos TImporter.
// handle the dragging in of one or more file or directory objects.
//    - a top-level - directly dragged-in - directory, only, is treated as potentially
//      defining a single object.
//    - all non-top-level directories (directories within a dragged-in directory) are treated
//      as potential asset resources only; their files' contents are read in, but no attempt
//      will be made to analyse the file types for loadability.
//    - for now, we don't have an equivalent of the TSlideShow that would be created if multiple objects are defined by whatever files are
//      dragged in - i.e., if the drag directly includes multiple files that are each of loadable
//      type (including obj, fbx etc); or if the drag includes one or more directories that
//      between them turn out to define more than one loadable object.
//    - a .zip file will be analysed in the same way as a directory.
export class AssetManager {
    constructor(frame) {
        this.frame = frame;
        this.assetCache = {};
        this.knownAssetURLs = {};
    }

    // ### NOT USED YET (what urls might we want to let users drag into croquet?)
    async handleStringDrop(string, overTObject) {
        const frame = this.frame;
        let urlObj;
        try { urlObj = new URL(string); }
        catch (e) { /* ignore */ }
        if (urlObj) {
            const anchorDef = urlObj.searchParams.get("anchor");
            if (anchorDef) {
                let initOptions;
                if (anchorDef.startsWith('x-comp.')) {
                    initOptions = { viewAnchorID: anchorDef };
                } else {
                    const pathSegments = anchorDef.split(":");
                    if (pathSegments.length > 1) {
                        const anchorRoomName = pathSegments.slice(0, pathSegments.length-1).join(":");
                        const anchorLocalName = pathSegments[pathSegments.length-1];
                        initOptions = { anchorRoomName, anchorLocalName };
                    }
                }

                if (initOptions) {
                    if (overTObject && overTObject.isPortal && overTObject.compositeObject) overTObject.addAction("specifyAnchor", initOptions);
                    else TPortal.makeSharedPortal(frame, initOptions);
                }
            }
        }
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
        for (let i=0; i<items.length; i++) {
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

    // ###
    async simulateFileDrop(urls, options={}) {
        const importSizeChecker = this.makeImportChecker();
        const specPromises = [];
        urls.forEach(urlStr => {
            const specArrayPromise = Promise.resolve()
                .then(() => importSizeChecker.withinLimits)
                .then(ok => ok
                    ? this.fetchSpecForURL(urlStr).then(fileSpec => {
                        if (fileSpec && importSizeChecker.addItem(fileSpec)) {
                            fileSpec.depth = 1;
                            return [fileSpec];
                        }
                        return null;
                        })
                    : null);
            specPromises.push(specArrayPromise);
            });
        const specArrays = (await Promise.all(specPromises)).filter(Boolean); // filter out any nulls.
        const loadOptions = Object.assign({}, options, { roomModel, roomView }); // ###
        this.displayAssets(specArrays, importSizeChecker, loadOptions);
    }

    async displayAssets(specArrays, importSizeChecker, options={}) {
        if (!importSizeChecker.withinLimits) {
            this.frame.alert(importSizeChecker.limitReason, 5000); // ### and all other alerts
            return;
        }
        if (!specArrays.length) return; // empty for some reason other than overflow

        const assetDescriptors = (await Promise.all(specArrays.map(specs => this.deriveAssetDescriptor(specs)))).filter(Boolean); // unrecognised file type will give a null
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

        const loadOptions = Object.assign({}, options); // @@ might want to add a loadRoomContentImmediately here??
        if (makerFns.length === 1) { // if just one object, it goes in a regular TWindow
            loadOptions.containment = 'window';
            makerFns[0](loadOptions);
        } else { // multiple objects are turned into slides in a TSlideShow
            // @@ we don't got no SlideShow yet
            if (false) {
                const slideShowOptions = { init: { slideShow: { title: "dropped files" } } };
                new ShareableComposite(this.frame, null, TSlideShow.compositionSpec(), slideShowOptions).readyPromise.then(slideShowComposite => {
                    const slideShow = slideShowComposite.components.slideShow;
                    loadOptions.containment = 'raw';
                    const slidePromises = makerFns.map(fn => fn(loadOptions));
                    Promise.all(slidePromises).then(slideComposites => {
                        let slideIndex = 0;
                        slideComposites.forEach(comp => {
                            if (comp) slideShow.slideFromComposite(comp, slideIndex++);
                            });
                        });
                    });
            }
        }
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
        const loader = new THREE.FileLoader();
        loader.setResponseType('arraybuffer');
        try {
            // NB: if the promise is rejected, the Chrome debugger will
            // treat it as an uncaught exception (despite the try/catch),
            // and will halt if halting on uncaught exceptions is enabled.
            const buffer = await new Promise((resolve, reject) => loader.load(urlStr, resolve, null, reject));
            const pathAndName = urlStr.match(/^(.*\/)?([^/]*)$/);
            const fileName = pathAndName[2], type = this.getFileType(fileName);
            return { path: urlStr, name: fileName, type, buffer };
        } catch (e) {
            console.warn(`error in loading ${urlStr}:`, e);
            return null;
        }
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
                            todo.push({ path: (path && path + '/') + entryInDir.name, entry: entryInDir, depth: depth+1 });
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

    async unpackZip(assetDescriptor) {
        const importSizeChecker = this.makeImportChecker();
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        const loader = new THREE.FileLoader();
        loader.setResponseType('arraybuffer');
        let buffer;
        try {
            // NB: if the promise is rejected, the Chrome debugger will
            // treat it as an uncaught exception (despite the try/catch),
            // and will halt if halting on uncaught exceptions is enabled.
            buffer = await new Promise((resolve, reject) => loader.load(urlObj.url, resolve, null, reject)).then(result => urlObj.revoke() || result);
        } catch (e) {
            console.warn(`error in fetching zip`, e);
            return null;
        }
        const zipList = await new JSZip().loadAsync(buffer);
        const fileSpecPromises = [];
        zipList.forEach((zipPath, zipEntry) => {
            if (!zipEntry.dir) { // ignore directory entries.
                // zips apparently include the zip name at the start of
                // every file path.  e.g., for Foo.zip all files will be Foo/bar.baz etc.
                // to match the effect of dragging in a directory, remove that
                // first path segment.
                const firstSlash = zipPath.indexOf("/");
                const relativePath = zipPath.slice(firstSlash+1);
                const pathAndName = relativePath.match(/^(.*\/)?([^/]*)$/);
                const name = pathAndName[2], type = this.getFileType(name);
                const depth = relativePath.split("/").length; // ...given that we've removed one
                fileSpecPromises.push(zipEntry.async("arraybuffer").then(buf => {
                    const fileSpec = { depth, path: relativePath, name, type, buffer: buf };
                    return importSizeChecker.addItem(fileSpec) ? fileSpec : null;
                    })
                    );
                }
            });
        const fileSpecs = await Promise.all(fileSpecPromises);
        if (!importSizeChecker.withinLimits) {
            this.frame.alert(importSizeChecker.limitReason + " in zip", 5000);
            return null;
        }
        return this.deriveAssetDescriptor(fileSpecs);
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
                return totalFiles <= MAX_IMPORT_FILES && totalSize <= 1048576*MAX_IMPORT_MB;
            },
            get limitReason() {
                return totalFiles > MAX_IMPORT_FILES ? `exceeded limit of ${MAX_IMPORT_FILES} files`
                    : totalSize > 1048576*MAX_IMPORT_MB ? `exceeded limit of ${MAX_IMPORT_MB}MB`
                    : "";
            }
            };
        return checker;
    }

    async deriveAssetDescriptor(fileSpecs) {
        const loadPaths = {};
        const byType = {};
        const topSpecs = fileSpecs.filter(spec => spec.depth===1);
        if (topSpecs.length===0) return null;
        topSpecs.forEach(spec => {
            const type = spec.type;
            let typeFiles = byType[type];
            if (!typeFiles) typeFiles = byType[type] = [];
            typeFiles.push(spec);
            });
        const priorityTypes = [ ".js", ".obj", ".gltf", ".glb" ]; // if any of these is found, it defines the load type
        let ti = 0, loadType = null, displayName;
        while (!loadType && ti < priorityTypes.length) {
            const type = priorityTypes[ti];
            const typeFiles = byType[type];
            if (typeFiles) {
                if (typeFiles.length > 1) return null; // ambiguous; just reject
                displayName = typeFiles[0].name;
                const mainPath = typeFiles[0].path;
                if (type===".obj") {
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
            const handledTypes = [ ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".dae", ".fbx", ".stl", ".svg", ".csv", ".xlsx", ".mp4", ".zip", ".xls" ];
            const handlableSpecs = topSpecs.filter(spec => handledTypes.indexOf(spec.type)>=0);
            if (handlableSpecs.length) {
                if (handlableSpecs.length > 1) this.frame.alert(`Ambiguous drop (${handlableSpecs.map(spec => spec.type).join(", ")})`, 5000);
                else {
                    const spec = handlableSpecs[0];
                    displayName = spec.name;
                    loadPaths.source = spec.path;
                    switch (spec.type) {
                        case ".png":
                        case ".jpg":
                        case ".jpeg":
                        case ".bmp":
                        case ".gif":
                            loadType = (spec.name.search("360.") >= 0) ? "texture360" : "texture";
                            break;
                        case ".dae":
                        case ".fbx":
                            loadType = "fbx";
                            break;
                        case ".stl":
                            loadType = "stl";
                            break;
                        case ".svg":
                        case ".csv":
                        case ".xlsx":
                        case ".mp4":
                            loadType = spec.type;
                            break;
                        case ".zip":
                            loadType = "zip";
                            break;
                        case ".xls":
                            this.frame.alert("XLS not supported! Use XLSX", 5000);
                            break;
                        default:
                    }
                }
            }
        }
        if (!loadType) {
            this.frame.alert("No loadable file found", 5000);
            return null;
        }

        await Promise.all(fileSpecs.map(spec => this.hashAndStoreIfNeeded(spec)));
        const fileDict = {};
        fileSpecs.forEach(spec => fileDict[spec.path] = spec);
        return { displayName, fileDict, loadType, loadPaths };
    }

    async hashAndStoreIfNeeded(fileSpec) {
        const buffer = fileSpec.buffer;
        delete fileSpec.buffer;
        if (!fileSpec.blob) fileSpec.blob = new Blob([buffer], { type: 'application/octet-stream' });
        if (fileSpec.type !== ".zip") {
            const hash = await hashBuffer(buffer);
            this.assetCache[hash] = fileSpec.blob;
            fileSpec.hash = hash;
            fileSpec.blobURL = makeBlobUrl(hash);
            this.ensureBlobIsShared(fileSpec.blobURL, fileSpec.blob, fileSpec.name); // async, but we don't need to wait
        }
        return fileSpec;
    }

    prepareMakerFunctions(assetDescriptor) {
        // assetDescriptor is { displayName, fileDict, loadType, loadPaths }
        // return an array of one or more functions which, if invoked with options
        // (that can include containment: raw, window etc),
        // will return a ShareableComposite (which doesn't have to have resolved
        // its readyPromise yet).
        const loadType = assetDescriptor.loadType;
        switch (loadType){
            /*
            case ".js":
                return new Promise(resolve => {
                    // runJS() will supply the properties needed for the code to create a
                    // composite, if it wants.  here we add a function for it to return maker
                    // functions.
                    const invocationContext = {
                        acceptMakerFunctions: resolve // won't necessarily ever be called
                        };
                    this.runJS(assetDescriptor, invocationContext);
                    });
            case ".csv":
                return this.importCSV(assetDescriptor).then(sheetSpec => { // { sheet, sheetName }
                    return [ options => {
                        const containment = options.containment;
                        const scSpec = TVisiCalc.compositionSpec({ containment });
                        const scOptions = Object.assign({}, options, {
                            assetDescriptor,
                            init: { sheet: sheetSpec }
                            });
                        if (containment==='window' && !options.viewpointRelativePos) scOptions.viewpointRelativePos = [0, 0, -3.5];
                        return new ShareableComposite(this.frame, null, scSpec, scOptions).readyPromise;
                        }
                        ];
                    });
            case ".xlsx":
                return this.importXLSX(assetDescriptor).then(txlsx => {
                    const sheetSpecs = txlsx.nonEmptySheets;
                    return sheetSpecs.map(sheetSpec => {
                        return options => {
                            const containment = options.containment;
                            const scSpec = TVisiCalc.compositionSpec({ containment });
                            const scOptions = Object.assign({}, options, {
                                assetDescriptor,
                                init: { sheet: { sheet: sheetSpec.sheet, sheetName: sheetSpec.sheetName, bookName: txlsx.bookName } }
                                });
                            if (containment==='window' && !options.viewpointRelativePos) scOptions.viewpointRelativePos = [0, 0, -2.5];
                            return new ShareableComposite(this.frame, null, scSpec, scOptions).readyPromise;
                            };
                        });
                    });
            */
            case "zip":
                return this.unpackZip(assetDescriptor).then(assetDescriptor2 => assetDescriptor2 ? this.prepareMakerFunctions(assetDescriptor2) : null);
            default:
                return [ options => this.makeImportedModel(assetDescriptor, options)/*.readyPromise*/ ];
        }
    }

    makeImportedModel(assetDescriptor, options) {
        const { roomModel, roomView } = options;
        const roomElementsID = roomModel.parts.elements.id;
//roomView.parts.elementViewManager.addElementManipulators = false;
        roomView.publish(roomElementsID, "addAsset", { assetDescriptor: this.makeShareableDescriptor(assetDescriptor) });
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

    async ensureBlobIsShared(blobURL, blob, name="") {
        if (this.knownAssetURLs[blobURL]) return;

        this.knownAssetURLs[blobURL] = true;
        try {
            // see if it's already there
            const response = await fetch(blobURL, { method: 'HEAD' });
            // if successful, return
            if (response.ok) return;
        } catch (ex) { /* ignore */ }
        // not found, so try to upload it
        try {
            console.warn(`storing attachment doc for content of ${name}`);
            await fetch(blobURL, {
                method: "PUT",
                mode: "cors",
                body: blob,
            }).then(() => console.warn("upload complete"));
        } catch (error) { /* ignore */ }
    }

    fetchSharedBlob(blobURL, optionalType) {
        const retryDelay = 1000;
        let retries = 60;
        return new Promise(resolved => {
            const getBlob = () => fetch(blobURL, { mode: "cors" })
                .then(response => {
                    // build the Blob ourselves, so we can set its type (introduced as a workaround to Safari refusing to play an untyped mp4 blob)
                    //if (response.ok) return response.blob();
                    if (response.ok) return response.arrayBuffer();
                    throw new Error('Network response was not ok.');
                    })
//                .then(blob => { this.knownAssetURLs[blobURL] = true; resolved(blob); })
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
        // currently we don't create a hash for zip files.
        if (fileSpec.hash) {
            const cacheKey = fileSpec.hash;
            const promiseFn = () => fileSpec.blob || this.fetchSharedBlob(fileSpec.blobURL, fileSpec.mimeType);
            blob = await this.loadThroughCache(cacheKey, promiseFn);
        } else blob = fileSpec.blob; // assuming it's there.
        return blob;
    }

    async makeLoadingManager(assetDescriptor, firstLoad) {
        const blobPromises = [], paths = [];
        Object.keys(assetDescriptor.fileDict).forEach(path => {
            paths.push(path);
            blobPromises.push(this.blobForPath(assetDescriptor, path));
            });
        const blobs = await Promise.all(blobPromises);
        const blobDict = {};
        paths.forEach((path, i) => blobDict[path] = blobs[i]);
        const manager = new THREE.LoadingManager();
        const objectURLs = [];
        manager._croquetRevokeURLs = () => objectURLs.forEach(url => URL.revokeObjectURL(url));
        manager.setURLModifier(urlStr => {
            //console.log(`handling request for ${urlStr}`);

            // @@ minor hack: some loaders insist on prefixing file paths with "./".  we don't.
            if (urlStr.slice(0, 2)==="./") urlStr = urlStr.slice(2);

            const knownBlob = blobDict[urlStr];
            if (knownBlob) {
                const url = URL.createObjectURL(knownBlob);
                objectURLs.push(url);
                return url;
            }

            // if the request is for a data or object URL, no transformation is needed
            let urlObj = null, protocol = null;
            try { urlObj = new URL(urlStr); }
            catch (e) { /* ignore */ }
            if (urlObj) protocol = urlObj.protocol;
            if (protocol === "blob:" || protocol === "data:") return urlStr;

            // iff this is a first load, and the request is for an address we know how to load,
            // return the url unmodified but arrange to fetch an extra copy of the result.
            if (firstLoad && (protocol === "http:" || protocol === "https:" || protocol === "file:")) {
                assetDescriptor.fileDict[urlStr] = null; // will be found by ensureFetchesAreRecorded()
                return urlStr;
            }
            console.warn(`failed to find ${urlStr}`);
            return ""; // we don't have a way to fetch the supplied url
            });
        return manager;
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

    ensureAssetsAvailable(assetDescriptor) {
        const blobURLDict = {};
        Object.values(assetDescriptor.fileDict).forEach(fileSpec => blobURLDict[fileSpec.blobURL] = true);
        // ids, retryMessage, retryDelay, maxRetries
        return this.ensureBlobsAvailable(Object.keys(blobURLDict),
            "waiting for asset docs to appear in db...",
            1000, 60).then(status => {
                if (status === 'ok') {
                    Object.keys(blobURLDict).forEach(blobURL => this.knownAssetURLs[blobURL] = true);
                }
                return status;
                });
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

/*  @@ NO DYNAMIC IMPORT OF JS IS SUPPORTED YET

    runJSAsset(url, options) {
        const assetDescriptor = this.makeDescriptor(".js", { source: url });
        this.runJS(assetDescriptor, { compositeContext: options });
    }

    runZippedJSAsset(url, options) {
        const assetDescriptor = this.makeDescriptor("zip", { source: url });
        this.unpackZip(assetDescriptor).then(assetDescriptor2 => this.runJS(assetDescriptor2, { compositeContext: options })
            );
    }

    // when a JavaScript source file is imported (i.e., invoked), we give it
    // execution context by passing a set of top-level variables.
    // at a minimum, there will be the following properties:
    //   frame: the frame in which the invocation is happening;
    //   exports: a dictionary of all objects exported by our modules (including all classes);
    //   assetDescriptor: the assetDescriptor in which the js file appears;
    //   getLoadingManager: async function returning the loading manager to supply to any loader

    // in addition, varBindings will have one of the following two properties:
    //   1. compositeContext: properties relevant to creating a ShareableComposite, if that's
    //     what the code wants to do:
    //     assetDescriptor
    //     loadFromDB: true iff being loaded as a result of the object appearing in the db;
    //     viewpointObject, viewpointRelativePos: (both optional);
    //     init: initialisation properties, keyed by component name, for components in the SC
    //       that the js code is expected to create (also optional);
    // or 2. componentContext: a context suitable for creating a component within a SC.
    //     loadFromDB, viewpointObject, viewpointRelativePos, init as for the buildContext case;
    //     componentBeingBuilt: name (within composite) of this component;
    //     componentInit: this component's subsection of the composite's init property

    // in the compositeContext case, also:
    //     acceptMakerFunctions: (optional) a function for delivering "maker functions" (see above)

    // in the componentContext case, also:
    //     acceptComponent: a function for delivering the completed component, or a promise of one

    async runJS(assetDescriptor, invocationContext={}) {
        if (assetDescriptor.loadType!==".js") debugger;

        const loadFromDB = !!invocationContext.loadFromDB;
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        const loader = new THREE.FileLoader();
        loader.setResponseType('text');
        try {
            // NB: if the promise is rejected, the Chrome debugger will
            // treat it as an uncaught exception (despite the try/catch),
            // and will halt if halting on uncaught exceptions is enabled.
            const code = await new Promise((resolve, reject) => loader.load(urlObj.url, resolve, null, reject)).then(result => urlObj.revoke() || result);
            // we supply either a componentContext or a compositeContext
            let { compositeContext, componentContext } = invocationContext;
            if (compositeContext && componentContext) debugger; // shouldn't have both
            if (!componentContext) {
                // prepare a vanilla compositeContext, if none has been supplied
                if (!compositeContext) compositeContext = invocationContext.compositeContext = {};
                if (!compositeContext.init) compositeContext.init = {};
                compositeContext.assetDescriptor = assetDescriptor;
            }
            let loadingManagerPromise = null;
            const getLoadingManager = () => {
                if (!loadingManagerPromise) loadingManagerPromise = this.makeLoadingManager(assetDescriptor, !loadFromDB);
                return loadingManagerPromise;
                };
            const varBindings = Object.assign({ frame: this.frame, exports: knownExports(), assetDescriptor, getLoadingManager,
                // mention these explicitly, even if they evaluate to undefined, so
                // the evaluated code can test them.
                compositeContext: invocationContext.compositeContext,
                acceptMakerFunctions: invocationContext.acceptMakerFunctions,
                componentContext: invocationContext.componentContext,
                acceptComponent: invocationContext.acceptComponent
                });
            lively.vm.runEval(code, { topLevelVarRecorder: varBindings }).then(result => {
                if (result.isError) console.error(result.value);
                else console.log("Evaluated!");
            });
        } catch(e) {
            console.warn(`error in running js`, e);
        }
    }
*/

    // the other importXXX functions all take an assetDescriptor and return an object3D
    async importSVG(assetDescriptor) {
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        const svgLoader = new THREE.SVGLoader(new THREE.LoadingManager());
        return new Promise(resolved => {
            svgLoader.load(urlObj.url, paths=>{
                urlObj.revoke();
                const group = new THREE.Group();
                for ( let i = 0; i < paths.length; i++ ) {
                    const path = paths[ i ];
                    const material= new THREE.MeshStandardMaterial({color: path.color, shadowSide: THREE.FrontSide});
                    const shapes = path.toShapes( false, false );
                    for ( let j = 0; j < shapes.length; j++ ) {
                        const shape = shapes[ j ];
                        const geometry = new THREE.ShapeBufferGeometry( shape );
                        const mesh = new THREE.Mesh( geometry, material );
                        mesh.position.z=i*0.01; // unless you don't allow it to set depth
                        mesh.castShadow = true;
                        mesh.receiveShadow = true;
                        group.add( mesh );
                    }
                }
                group.scale.y = -1.0; // SVG coords go in opposite sense on Y
                const outerGroup = new THREE.Group();
                outerGroup.add(group);
                resolved(outerGroup);
            },
               // Function called when download progresses
            _xhr=>{ },
            // Function called when download errors
            _xhr=>{ console.log( 'An error happened' ); } // #### relate to the promise
            );
        });
    }

    async importTexture(assetDescriptor) {
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        return new Promise(resolve => {
            const textureLoader = new THREE.TextureLoader(new THREE.LoadingManager());
            textureLoader.load(urlObj.url, texture=>{
                urlObj.revoke();
                this.ensurePowerOfTwo(texture);
                const geometry = new THREE.PlaneBufferGeometry(1, texture.image.height / texture.image.width, 1, 1);
                const material = new THREE.MeshBasicMaterial({ map: texture });
/*
                const geometry = new THREE.PlaneBufferGeometry(1.5, 1, 1, 1);
                const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff0000) });
*/
                const mesh = new THREE.Mesh(geometry, material);
                resolve(mesh);
                },
                   // Function called when download progresses
                _xhr=>{ },
                // Function called when download errors
                _xhr=>{ console.error( 'error in texture import' ); }
                );
            });
    }

    async importTexture360(assetDescriptor) {
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        const textureLoader = new THREE.TextureLoader(new THREE.LoadingManager());
        return new Promise(resolved => {
            textureLoader.load(urlObj.url, texture=>{
                urlObj.revoke();
                texture.minFilter = THREE.LinearFilter; // in case it's not power of two
                const geometry = new THREE.SphereGeometry(500, 60, 40);
                geometry.applyMatrix(new THREE.Matrix4().makeScale(-1, 1, 1 ));
                const material = new THREE.MeshBasicMaterial({ map: texture });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.raycast = function(){};
                resolved(mesh);
            },
               // Function called when download progresses
            _xhr=>{ },
            // Function called when download errors
            _xhr=>{ console.error( 'error in texture import' ); }
            );
        });
    }

    async importVideo(assetDescriptor) {
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        return (new Video2DView(urlObj.url)).readyPromise; // must hold off from revoking URL until object is destroyed; see Video2DView.dispose()
    }

    async importOBJ(assetDescriptor, firstLoad) {
        let materials;
        const mtlURL = assetDescriptor.loadPaths.mtlSource;
        if (mtlURL) {
            const manager = await this.makeLoadingManager(assetDescriptor, firstLoad);
            const mtlLoader = new THREE.MTLLoader(manager);
            const mtlPathAndName = mtlURL.match(/^(.*\/)?([^/]*)$/);
            const path = mtlPathAndName[1];
            mtlLoader.setResourcePath(path); // new API (valid in feb 2019)
            mtlLoader.crossOrigin = '';
            materials = await new Promise(resolve => mtlLoader.load(mtlURL, resolve));
            manager._croquetRevokeURLs();
        }
        const urlObjO = await this.objectURLForName(assetDescriptor, "objSource");
        const objLoader = new THREE.OBJLoader();
        if (materials) objLoader.setMaterials(materials);
        return new Promise(resolve => objLoader.load(urlObjO.url, resolve, onProgress, onError)).then(result => urlObjO.revoke() || result);
    }

    async importFBX(assetDescriptor, firstLoad) {
        // NB: for an FBX model, storing and reusing the parsed model is for now a headache (see https://github.com/mrdoob/three.js/issues/14647).  might become simpler around release 100.
        // we use a loadingManager, because it seems that FBX *might* be able to include
        // references to other files
        // (see https://archive.blender.org/wiki/index.php/User:Mont29/Foundation/FBX_File_Structure/)
        const manager = await this.makeLoadingManager(assetDescriptor, firstLoad);
        const objectPath = assetDescriptor.loadPaths.source;
        const object = await new Promise(resolve => {
            const loader = new THREE.FBXLoader(manager);
            loader.crossOrigin = '';
            loader.load(objectPath, resolve, onProgress, onError);
            });
        manager._croquetRevokeURLs();
        const mixers = [];
        object.mixer = new THREE.AnimationMixer(object);
        mixers.push(object.mixer);
        //console.log('animations', object.animations);
        if (object.animations.length>0) {
            const action = object.mixer.clipAction(object.animations[0]);
            action.play();
        }
        if (mixers.length>0) {
            // initialisation code for when installed in a TObject
            object.initTObject = tObj => {
                tObj.mixers = mixers;
                tObj.lastTime = 0;
                tObj.update = function(t) {
                    for (let i = 0; i < this.mixers.length; i++) {
                        this.mixers[ i ].update( (t-this.lastTime)/1000);
                    }
                    this.lastTime = t;
                    };
                };
        }
        return object;
    }

    async importSTL(assetDescriptor) {
        const urlObj = await this.objectURLForName(assetDescriptor, "source");
        const stlLoader = new THREE.STLLoader();
        const geometry = await new Promise(resolve => stlLoader.load(urlObj.url, resolve, onProgress, onError));
        urlObj.revoke();
        const material = new THREE.MeshLambertMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }

    async importGLTF(assetDescriptor, firstLoad) {
        const basePath = assetDescriptor.loadPaths.source;
        // gltf can definitely include references to other files
        const manager = await this.makeLoadingManager(assetDescriptor, firstLoad);
        let type = assetDescriptor.loadType;
        if (type===".gltf") type = "gltf2"; // assume gltf2 (given how old gltf1 is)
        // if we already have the source files (e.g., on load from db, or from a local
        // file drop) we can use the file content hash in our cache key.  if not - a first
        // load through a URL - we just use that URL.
        const baseFileSpec = assetDescriptor.fileDict[basePath];
if (baseFileSpec && !baseFileSpec.hash) debugger;
        const cacheKey = type + "+" + (baseFileSpec ? baseFileSpec.hash : basePath);
        const promiseFn = () => new Promise((resolved, _rejected) => {
                const LoaderClass = assetDescriptor.loadType === "gltf1" ? THREE.LegacyGLTFLoader : THREE.GLTFLoader;
                const loader = new LoaderClass(manager);
                if (assetDescriptor.loadType === ".glb") {
                    loader.setDRACOLoader( new THREE.DRACOLoader() );
                }
                loader.crossOrigin = '';
                loader.load(basePath,
                    ({ scene, scenes, cameras, animations }) => {
                        manager._croquetRevokeURLs();

                        if (animations.length>0) {
                            scene.initTObject = tObj => {
                                var mixers = [], o3d = tObj.object3D;
                                o3d.mixer = new  THREE.AnimationMixer(o3d);
                                mixers.push(o3d.mixer);
                                const action = o3d.mixer.clipAction(animations[0]);
                                action.play();
                                tObj.mixers = mixers;
                                tObj.lastTime = 0;
                                tObj.update = function(t) {
                                    for (let i = 0; i < this.mixers.length; i++) {
                                        this.mixers[ i ].update( (t-this.lastTime)/1000);
                                    }
                                    this.lastTime = t;
                                    };
                                };
                        }
                        resolved(scene); // ignoring everything but the scene for now
                        },
                    onProgress,
                    onError);
                });

        return this.loadThroughCache(cacheKey, promiseFn).then(scene => {
            const clone = assetDescriptor.loadType === ".glb" ? THREE.SkeletonUtils.clone(scene) : scene.clone();
            if (scene.initTObject) { clone.initTObject = scene.initTObject; }
            clone.traverse(node => { // need to clone the materials
                if (node.isMesh) node.material = node.material.clone();
                });
            return clone;
        });
    }

/*
    // importXLSX unpacks the XLSX file and delivers a TXSLX object that has already
    // parsed its sheets.  the TXSLX is cached, so that if there are n sheets
    // (which could be loaded into n TVisiCalc objects) we don't end up building
    // all n sheets n times.
    async importXLSX(assetDescriptor) {
        const basePath = assetDescriptor.loadPaths.source;
        const baseFileSpec = assetDescriptor.fileDict[basePath];
if (baseFileSpec && !baseFileSpec.hash) debugger;
        let displayName;
        if (baseFileSpec) displayName = baseFileSpec.name;
        else {
            const pathAndName = basePath.match(/^(.*\/)?([^/]*)$/);
            displayName = pathAndName[2];
        }
        const cacheKey = "xlsx+" + (baseFileSpec ? baseFileSpec.hash : basePath);
        const promiseFn = () => this.objectURLForPath(assetDescriptor, basePath)
            .then(urlObj => new TXLSX(this.frame, urlObj.url, displayName).readyPromise.then(result => urlObj.revoke() || result));
        return this.loadThroughCache(cacheKey, promiseFn);
    }

    // parse a CSV and return a sheet (currently hardcoded to be a CSVSparkSheet)
    // for display in a TVisiCalc.
    // here we don't bother to cache the sheet.
    async importCSV(assetDescriptor) {
        const basePath = assetDescriptor.loadPaths.source;
        const baseFileSpec = assetDescriptor.fileDict[basePath];
        let displayName;
        if (baseFileSpec) displayName = baseFileSpec.name;
        else {
            const pathAndName = basePath.match(/^(.*\/)?([^/]*)$/);
            displayName = pathAndName[2];
        }
        return this.objectURLForPath(assetDescriptor, basePath)
            .then(urlObj => new /*CSVSheet*/ /* CSVSparkSheet(this.frame, urlObj.url, displayName).readyPromise.then(result => urlObj.revoke() || result));
    }
*/

    ensurePowerOfTwo(texture) {
        // all code here is adapted from three.js
        const isPowerOfTwo = value => (value & (value - 1)) === 0 && value !== 0;
        const ceilPowerOfTwo = value => 2**Math.ceil(Math.log(value) / Math.LN2);

        const image = texture.image;
        if (isPowerOfTwo(image.width) && isPowerOfTwo(image.height)) return; // nothing to do

        console.warn(`applying power-of-two to ${image.width}x${image.height} texture`);

        const canvas = document.createElementNS( 'http://www.w3.org/1999/xhtml', 'canvas' ); //this.workingCanvas;
        canvas.width = ceilPowerOfTwo(image.width);
        canvas.height = ceilPowerOfTwo(image.height);

        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        texture.image = canvas;
    }
}

function onProgress(xhr) {
    if (xhr.lengthComputable) {
        const percentComplete = xhr.loaded / xhr.total * 100;
        console.log(Math.round(percentComplete, 2) + '% downloaded' );
    }
}

function onError( xhr ) { console.log('file load fail', xhr); }

export const theAssetManager = new AssetManager();

export class ImportedElement extends ModelPart {
    constructor() {
        super();
        this.parts = { spatial: new SpatialPart() };
    }

    init(options, id) {
        super.init(options, id);
        this.assetDescriptor = options.assetDescriptor;
    }

    naturalViewClass() { return ImportedElementView; }
}

class ImportedViewPart extends ViewPart {
    constructor(options) {
        super(options);
console.warn(this);
        // @@ assuming anyone's going to care...
        this.readyPromise = new Promise(resolved => {
            this._ready = () => resolved(this);
            });

        const assetDescriptor = options.model.assetDescriptor;
        const loadType = this.loadType = assetDescriptor.loadType;
        const assetManager = theAssetManager;
        const firstLoad = true; // ####
        this.threeObj = new THREE.Group();

        const objectReady = obj => {
            const bbox = (new THREE.Box3()).setFromObject(obj);
            const rawHeight = bbox.max.y - bbox.min.y;
            const scale = 2/rawHeight;
            this.threeObj.add(obj);
            this.threeObj.scale.set(scale, scale, scale);
            this.publish(this.id, ViewEvents.changedDimensions, {});
            this._ready();
            };

        switch (loadType) {
            case "texture":
                assetManager.importTexture(assetDescriptor).then(objectReady);
                break;
            // ###
            case "texture360":
                assetManager.importTexture360(assetDescriptor).then(mesh => {
                    this.setObject3D(mesh);
                    compositeObject.registerOnSceneTeam(this); // this is the only TObject that will be built

                    const tScene = viewpointObject;
                    if (tScene.background3D) tScene.background3D.destroyComposite();

                    tScene.background3D = this;
                    tScene.addChild(this);

                    this.readyPromiseHandle.resolve(this);
                    });
                break;
            case "fbx": // this also covers more than one file extension
                assetManager.importFBX(assetDescriptor, firstLoad).then(objectReady);
                break;
            case "stl":
                assetManager.importSTL(assetDescriptor).then(objectReady);
                break;
            case ".svg":
                assetManager.importSVG(assetDescriptor).then(objectReady);
                break;
            case ".gltf":
            case "gltf1":
            case "gltf2":
            case ".glb":
                assetManager.importGLTF(assetDescriptor, firstLoad).then(objectReady);
                break;
            case ".obj":
                assetManager.importOBJ(assetDescriptor, firstLoad).then(objectReady);
                break;
            default:
                console.warn(`unknown imported-object loadType: ${loadType}.`);
        }
    }
}

// essential to add Tracking separately, so it specialises a class whose constructor will already have created this.threeObj
class ImportedElementView extends Tracking()(ImportedViewPart) {
    get label() {
        return "Imported Element";
    }

    // ###
    loadInWindow(context) {
        const title = context.compositeObject.assetDescriptor.displayName;
        // unless context declares otherwise, place the object in front of the avatar
        // at twice normal demo distance.
        const componentInit = context.componentInit;
        if (componentInit.viewpointRelativePos===undefined) componentInit.viewpointRelativePos = [0, 0, -2*this.frame.world.demoLauncher.standardDistance];
        return super.loadInWindow(context, title);
    }

}


// Video2DView is an interface over an HTML video element.
// its readyPromise resolves once the video is available to play.
class Video2DView {
    constructor(url) {
console.log(this);
        this.url = url;
        this.video = document.createElement("video");
        this.video.autoplay = false;
        this.video.loop = true;
        this.isPlaying = false;
        this.playOffset = null;
        this.isBlocked = false; // unless we find out to the contrary, on trying to play

        this.readyPromise = new Promise(resolved => {
            this._ready = () => resolved(this);
            });

        this.video.oncanplay = () => {
            this.duration = this.video.duration; // ondurationchange is (apparently) always ahead of this
            this._ready();
            };

        this.video.onerror = () => {
            let err;
            const errCode = this.video.error.code;
            switch (errCode) {
                case 1: err = "video loading aborted"; break;
                case 2: err = "network loading error"; break;
                case 3: err = "video decoding failed / corrupted data or unsupported codec"; break;
                case 4: err = "video not supported"; break;
                default: err = "unknown video error";
            }
            console.log(`Error: ${err} (errorcode=${errCode})`);
        };

        this.video.crossOrigin = "anonymous";

        if (!this.video.canPlayType("video/mp4").match(/maybe|probably/i) && this.video.canPlayType("video/theora").match(/maybe|probably/i)) {
            // try webm if mp4 isn't supported
            console.log("can't play video");
        }

        this.video.src = this.url;
        this.video.load();

        this.texture = new THREE.VideoTexture(this.video);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.format = THREE.RGBFormat;
        this.texture.generateMipmaps = false;
    }

    width() { return this.video.videoWidth; }
    height() { return this.video.videoHeight; }

    wrappedTime(videoTime, guarded) {
        if (this.duration) {
            while (videoTime > this.duration) videoTime -= this.duration; // assume it's looping, with no gap between plays
            if (guarded) videoTime = Math.min(this.duration-0.1, videoTime); // the video element freaks out on being told to seek very close to the end
        }
        return videoTime;
    }

    async play(videoTime) {
        // return true if video play started successfully
        this.video.currentTime = this.wrappedTime(videoTime, true);
        this.isPlaying = true; // even if it turns out to be blocked by the browser
        // following guidelines from https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
        try {
            await this.video.play(); // will throw exception if blocked
            this.isBlocked = false;
        } catch (err) {
            console.warn("video play blocked");
            this.isBlocked = this.isPlaying; // just in case isPlaying was set false while we were trying
        }
        return !this.isBlocked;
    }

    pause(videoTime) {
        this.isPlaying = this.isBlocked = false; // might not be blocked next time.
        this.setStatic(videoTime);
    }

    setStatic(videoTime) {
        if (videoTime !== undefined) this.video.currentTime = this.wrappedTime(videoTime, true); // true => guarded from values too near the end
        this.video.pause(); // no return value; synchronous, instantaneous?
    }

    // ### need to hook this into... something
    dispose() {
        try {
            URL.revokeObjectURL(this.url);
            this.texture.dispose();
            delete this.texture;
            delete this.video;
        } catch (e) { console.warn(`error in Video2DView cleanup: ${e}`); }
    }
}

// a video
export class ImportedVideoElement extends ModelPart {
    constructor() {
        super();
        this.parts = { spatial: new SpatialPart() };
    }

    init(options, id) {
        super.init(options, id);
//console.warn(options);
        this.isPlaying = false;
        this.startOffset = null; // only valid if playing
        this.pausedTime = 0; // only valid if paused
        this.assetDescriptor = options.assetDescriptor;
    }

    setPlayState(isPlaying, startOffset, pausedTime, actionSpec) {
        this.isPlaying = isPlaying;
        this.startOffset = startOffset;
        this.pausedTime = pausedTime;
        this.publish(this.id, "setPlayState", { isPlaying, startOffset, pausedTime, actionSpec });
    }

    naturalViewClass() { return ImportedVideoView; }
}

const SCRUB_THROTTLE = 1000 / 8; // min time between scrub events

class TimebarView extends ViewPart {
    constructor(options) {
        super(options);
        const { width, height } = options;
        this.videoView = options.videoView;
        this.threeObj = new THREE.Group();

        const timebarLength = this.timebarLength = width;
        const timebar = this.timebar = new THREE.Mesh(
            new THREE.PlaneBufferGeometry(timebarLength, height),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0x444444) })
            );
        this.threeObj.add(timebar);
        const playbar = this.playbar = new THREE.Mesh(
            new THREE.PlaneBufferGeometry(1, height/4),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcccccc) })
            );
        playbar.position.set(0, 0, 0.001); // floating just above
        timebar.add(playbar);
        this.adjustPlaybar(0);

        makePointerSensitive(timebar, this);
        this.subscribe(this.id, PointerEvents.pointerDrag, data => this.onPointerDrag(data));
    }

    onPointerDrag(data) {
        const now = this.now();
        if (this.lastDragTime && now - this.lastDragTime < SCRUB_THROTTLE) return;

        this.lastDragTime = now;
        const localPt = new THREE.Vector3().copy(data.dragEndOnVerticalPlane);
        this.timebar.worldToLocal(localPt);
        const timeProportion = Math.max(0, Math.min(1, localPt.x/this.timebarLength + 0.5));
        if (this.lastTimeProportion === timeProportion) return;

        this.lastTimeProportion = timeProportion;
        this.videoView.handleTimebar(timeProportion);
    }

    adjustPlaybar(proportion) {
        const playbar = this.playbar;
        const playbarLength = this.timebarLength * proportion;
        playbar.scale.x = Math.max(0.001, playbarLength);
        playbar.position.x = (playbarLength - this.timebarLength) / 2;
    }
}

const VIEW_HEIGHT = 2;
const HAND_HEIGHT = 0.4;
const HAND_TILT = Math.PI * 0.1;
const TIMEBAR_HEIGHT_PROP = 0.1;
const TIMEBAR_MARGIN_PROP = TOUCH ? 0 : 0.04;

class VideoViewPart extends ViewPart {
    constructor(options) {
        super(options);
console.warn(this);

        this.videoReady = false; // this will go true just once
        this.waitingForIslandSync = !this.realm.isSynced; // this can flip back and forth

        const element = this.model = options.model;
        const { assetDescriptor, isPlaying, startOffset, pausedTime } = element;
        this.setPlayState({ isPlaying, startOffset, pausedTime }); // will be stored for now, and may be overridden by messages in a backlog by the time the video is ready
        const assetManager = theAssetManager;
        this.threeObj = new THREE.Group();

        // importVideo returns a promise that resolves once the video has loaded
        assetManager.importVideo(assetDescriptor).then(videoView => {
            this.videoReady = true;
            this.videoView = videoView;
            this.flip = false; // true means rendered picture acts like a mirror (suitable for local webcam)
            const videoH = videoView.height(), videoW = videoView.width(); // pixels
            const rectH = this.rectHeight = VIEW_HEIGHT, rectW = this.rectWidth = rectH * videoW/videoH; // @@ stick to a default height of 2 units, for now

            const videoRect = new THREE.Mesh(
                new THREE.PlaneBufferGeometry(rectW, rectH),
                new THREE.MeshBasicMaterial({ map: videoView.texture })
                );
            videoRect.name = "videoView";
            if (this.flip) {
                videoRect.material.side = THREE.BackSide;
                videoRect.rotation.y = Math.PI;
            }
            this.threeObj.add(videoRect);

            const enableIcon = new SVGIcon(soundOn, new THREE.MeshBasicMaterial({ color: "#888888" }));
            ignorePointer(enableIcon);
            enableIcon.rotateX(Math.PI / 2);
            let iconHolder = this.enableSoundIcon = new THREE.Group();
            iconHolder.add(enableIcon);
            iconHolder.visible = false;
            let iconScale = 0.7;
            iconHolder.scale.set(iconScale, iconScale, iconScale);
            iconHolder.position.set(0, 0, 0.01);
            this.threeObj.add(iconHolder);

            // in this case it matters that SVG and THREE have opposite expectations for sense of +ve y
            const outerHand = new SVGIcon(remoteHand, new THREE.MeshBasicMaterial({ color: "#ffffff" }), undefined, undefined, false); // a y-flipped hand (looks like the back of a left hand)
            ignorePointer(outerHand);
            outerHand.rotateX(Math.PI); // flip over (now looks like a right hand again, pointing up)
            outerHand.rotateZ(Math.PI - HAND_TILT); // remembering that icon's Z is now into picture
            const innerHand = new SVGIcon(remoteHand, new THREE.MeshBasicMaterial({ color: "#444444" }), undefined, 0.95, false);
            ignorePointer(innerHand);
            innerHand.rotateX(Math.PI); // flip over (now looks like a right hand again, pointing up)
            innerHand.rotateZ(Math.PI - HAND_TILT); // remembering that icon's Z is now into picture
            iconHolder = this.remoteHandIcon = new THREE.Group();
            iconHolder.add(outerHand);
            innerHand.position.set(0, 0, 0.005);
            iconHolder.add(innerHand);
            iconHolder.visible = false;
            iconScale = HAND_HEIGHT;
            iconHolder.scale.set(iconScale, iconScale, iconScale);
            iconHolder.position.set(0, 0, 0.02);
            this.threeObj.add(iconHolder);

            // @@ seems hacky
            this.realm.island.controller.inViewRealm(() => { // needs to run in realm so it can create a new View
                const timebarW = rectW - 2 * rectH * TIMEBAR_MARGIN_PROP, timebarH = rectH * TIMEBAR_HEIGHT_PROP, timebarY = -rectH * (0.5 - TIMEBAR_MARGIN_PROP - TIMEBAR_HEIGHT_PROP/2);
                const timebar = this.timebar = new TimebarView({ videoView: this, width: timebarW, height: timebarH }); // margins of 0.04 * h
                timebar.threeObj.position.set(0, timebarY, 0.02);
                this.threeObj.add(timebar.threeObj);
                });

            this.publish(this.id, ViewEvents.changedDimensions, {});
            this.applyPlayState();
            this.future(1000).checkPlayStatus();
            });

        this.subscribe(options.model.id, "setPlayState", data => this.setPlayState(data));
        this.subscribe(this.realm.island.id, { event: "synced", handling: "immediate" }, isSynced => this.handleSyncState(isSynced));
    }

    get label() {
        return "Imported Video";
    }

    adjustPlaybar(time) {
        if (!this.videoView || !this.timebar) return;

        this.timebar.adjustPlaybar(time / this.videoView.duration);
    }

    setPlayState(rawData) {
        const data = {...rawData}; // take a copy that we can play with
        const actionSpec = this.latestActionSpec = data.actionSpec; // if any
        delete data.actionSpec;

        const latest = this.latestPlayState;
        // ignore if we've heard this one before (probably because we set it locally)
        if (latest && Object.keys(data).every(key => data[key]===latest[key])) return;

        this.latestPlayState = Object.assign({}, data);
        this.applyPlayState(); // will be ignored if we're still initialising
    }

    applyPlayState() {
        if (!this.videoReady || this.waitingForIslandSync) return;

//console.log("apply playState", {...this.latestPlayState});
        if (!this.latestPlayState.isPlaying) this.videoView.pause(this.latestPlayState.pausedTime);
        else {
            this.videoView.video.playbackRate = 1;
            this.lastRateAdjust = this.now(); // make sure we don't adjust rate before playback has settled in, and any emergency jump we decide to do
            this.jumpIfNeeded = false;
            // if the video is blocked from playing, enter a stepping mode in which we move the video forward with successive pause() calls
            this.videoView.play(this.calculateVideoTime()+0.1).then(playStarted => {
                this.enableSoundIcon.visible = !playStarted;
                if (playStarted) this.future(250).triggerJumpCheck(); // leave it a little time to stabilise
                else {
//console.log(`stepping video`);
                    this.isStepping = true;
                    this.future().stepWhileBlocked();
                }
                });
        }

        if (this.latestActionSpec) this.revealAction(this.latestActionSpec);
    }

    revealAction(spec) {
        if (spec.originViewID !== this.id) {
            const type = spec.type;
            if (type === "body") {
                this.useHandToPoint(spec.x, spec.y);
            } else if (type === "timebar") {
                const xOnTimebar = this.timebar.timebarLength * (spec.proportion - 0.5);
                const yOnTimebar = -this.rectHeight * (0.5 - TIMEBAR_MARGIN_PROP - TIMEBAR_HEIGHT_PROP * 0.75);
                this.useHandToPoint(xOnTimebar, yOnTimebar);
            }
        }
    }

    useHandToPoint(targetX, targetY) {
        if (!this.remoteHandIcon) return;

        if (this.remoteHandTimeout) clearTimeout(this.remoteHandTimeout);

        // end of finger is around (-0.1, 0.5) relative to centre
        const xOffset = -0.1 * HAND_HEIGHT, yOffset = (0.5 + 0.05) * HAND_HEIGHT; // a bit off the finger
        const sinTilt = Math.sin(HAND_TILT), cosTilt = Math.cos(HAND_TILT);
        const x = xOffset * cosTilt - yOffset * sinTilt, y = xOffset * sinTilt + yOffset * cosTilt;
        const pos = this.remoteHandIcon.position;
        pos.x = targetX + x;
        pos.y = targetY + y;
        this.remoteHandIcon.visible = true;
        this.remoteHandTimeout = setTimeout(() => this.remoteHandIcon.visible = false, 1000);
    }

    calculateVideoTime() {
        const { isPlaying, startOffset } = this.latestPlayState;
        if (!isPlaying) debugger;

        const sessionNow = this.now(); // or is this.externalNow() going to be more consistent??
        return (sessionNow - startOffset) / 1000;
    }

    stepWhileBlocked() {
        if (!this.isStepping) return; // we've left stepping mode
        if (!this.videoView.isBlocked) {
            this.isStepping = false;
            return;
        }
        this.videoView.setStatic(this.calculateVideoTime());
        this.future(50).stepWhileBlocked();
    }

    handleSyncState(isSynced) {
//console.warn(`synced: ${isSynced}`);
        const wasWaiting = this.waitingForIslandSync;
        this.waitingForIslandSync = !isSynced;
        if (wasWaiting && isSynced) this.applyPlayState();
        // there was a thought of automatically pausing video if the tab goes dormant - but on Chrome, at least, a tab with a playing video simply doesn't go dormant
        //else if (!wasWaiting && !isSynced) this.videoView.pause(); // no pausedTime; no-one's watching.
    }

    handleUserClick(clickPt) {
        if (!this.videoView) return;

        // if the video is playing but blocked, this click will in theory be able to start it.
        if (this.isStepping) {
            console.log(`stop video stepping`);
            this.isStepping = false;
            this.applyPlayState();
            return;
        }

        const wantsToPlay = !this.latestPlayState.isPlaying; // toggle
        if (!wantsToPlay) this.videoView.pause(); // immediately!
        const videoTime = this.videoView.video.currentTime;
        const sessionTime = this.now(); // the session time corresponding to the video time
        const startOffset = wantsToPlay ? sessionTime - 1000 * videoTime : null;
        const pausedTime = wantsToPlay ? 0 : videoTime;
        this.setPlayState({ isPlaying: wantsToPlay, startOffset, pausedTime }); // directly from the handler, in case the browser blocks indirect play() invocations
        const actionSpec = { originViewID: this.id, type: "body", x: clickPt.x, y: clickPt.y };
        this.model.future().setPlayState(wantsToPlay, startOffset, pausedTime, actionSpec); // then update our model, which will tell everyone else
    }

    handleTimebar(proportion) {
        if (!this.videoView) return;

        const wantsToPlay = false;
        const videoTime = this.videoView.duration * proportion;
        const startOffset = null;
        const pausedTime = videoTime;
        this.setPlayState({ isPlaying: wantsToPlay, startOffset, pausedTime });
        const actionSpec = { originViewID: this.id, type: "timebar", proportion };
        this.model.future().setPlayState(wantsToPlay, startOffset, pausedTime, actionSpec); // then update our model, which will tell everyone else
    }

    triggerJumpCheck() { this.jumpIfNeeded = true; } // on next checkPlayStatus() that does a timing check

    checkPlayStatus() {
        this.adjustPlaybar(this.videoView && this.videoView.isPlaying ? this.videoView.video.currentTime : (this.latestPlayState.pausedTime || 0));

        const lastTimingCheck = this.lastTimingCheck || 0;
        const now = this.now();
        // check video timing every 0.5s
        if (this.videoView && this.videoView.isPlaying && !this.videoView.isBlocked && (now - lastTimingCheck >= 500)) {
            this.lastTimingCheck = now;
            const expectedTime = this.videoView.wrappedTime(this.calculateVideoTime());
            const videoTime = this.videoView.video.currentTime;
            const videoDiff = videoTime - expectedTime;
//console.log(`video is ${Math.round(videoDiff * 1000)}ms ahead`);
            if (videoDiff < this.videoView.duration / 2) { // otherwise presumably measured across a loop restart; just ignore.
                if (this.jumpIfNeeded) {
                    this.jumpIfNeeded = false;
                    // if there's a difference greater than 500ms, try to jump the video to the right place
                    if (Math.abs(videoDiff) > 0.5) {
                        console.log(`jumping video by ${-Math.round(videoDiff * 1000)}ms`);
                        this.videoView.video.currentTime = this.videoView.wrappedTime(videoTime - videoDiff + 0.1, true); // 0.1 to counteract the delay that the jump itself tends to introduce; true to ensure we're not jumping beyond the last video frame
                    }
                } else {
                    // every 3s, check video lag/advance, and set the playback rate accordingly.
                    // current adjustment settings:
                    //   > 200ms off: set playback 2% faster/slower than normal
                    //   > 100ms: 1% faster/slower
                    //   < 50ms: normal (i.e., hysteresis between 100ms and 50ms in the same sense)
                    const lastRateAdjust = this.lastRateAdjust || 0;
                    if (now - lastRateAdjust >= 3000) {
                        const oldRate = this.videoView.video.playbackRate;
                        const oldBoostPercent = Math.round(100 * (oldRate - 1));
                        const diffAbs = Math.abs(videoDiff), diffSign = Math.sign(videoDiff);
                        const desiredBoostPercent = -diffSign * (diffAbs > 0.2 ? 2 : (diffAbs > 0.1 ? 1 : 0));
                        if (desiredBoostPercent !== oldBoostPercent) {
                            const hysteresisBlock = desiredBoostPercent === 0 && Math.sign(oldBoostPercent) === -diffSign && diffAbs >= 0.05;
                            if (!hysteresisBlock) {
                                const playbackRate = 1 + 0.01 * desiredBoostPercent;
console.log(`video playback rate: ${playbackRate}`);
                                this.videoView.video.playbackRate = playbackRate;
                            }
                        }
                        this.lastRateAdjust = now;
                    }
                }
            }
        }
        this.future(100).checkPlayStatus();
    }
}

const ImportedVideoView = Clickable({
    onClick: options => (at, view) => view.handleUserClick(view.threeObj.worldToLocal(new THREE.Vector3().copy(at)))
})(Tracking()(VideoViewPart));
