/* global CROQUET_SESSION, imageinput, image, prevButton, nextButton, addButton, delButton */

import { Model, View, Data, Session, App, Messenger } from "@croquet/croquet";
import Hammer from "hammerjs";
import prettyBytes from "pretty-bytes";
import Swal from 'sweetalert2';

import "./pix.css";
import "sweetalert2/dist/sweetalert2.min.css";

const builder = document.createElement("div");
builder.innerHTML = `
    <input id="imageinput" type="file" multiple accept="image/jpeg,image/gif,image/png,image/bmp" style="display:none;">
    <img id="image">
    <div id="prevButton" class="button"></div>
    <div id="nextButton" class="button"></div>
    <div id="delButton" class="button"></div>
    <div id="addButton" class="button"></div>
`;
document.body.append(...builder.children);


class PixModel extends Model {

    init(_options, persistedSession) {
        this.asset = null;
        this.assetIds = 0;
        this.assets = [];
        this.handles = {};
        this.subscribe(this.id, "add-asset", this.addAsset);
        this.subscribe(this.id, "stored-data", this.storedData);
        this.subscribe(this.id, "remove-id", this.removeId);
        this.subscribe(this.id, "go-to", this.goTo);

        this.buttons = {};
        for (const name of ["prev", "next", "add", "del"]) {
            this.buttons[name] = { views: new Set(), until: 0 };
        }
        this.subscribe(this.id, "button-active", this.buttonActive);
        this.subscribe(this.sessionId, "view-exit", this.viewExit);

        if (persistedSession) this.restoreEverything(persistedSession);
    }

    addAsset(asset) {
        this.asset = asset;
        this.assets.push(asset);
        this.asset.id = ++this.assetIds;
        if (asset.handle && asset.hash) this.handles[asset.hash] = asset.handle;
        this.publish(this.id, "asset-changed");
    }

    storedData({hash, handle}) {
        this.handles[hash] = handle;
        for (const asset of this.assets) {
            if (!asset.handle && asset.hash === hash) {
                asset.handle = handle;
                this.publish(this.id, "asset-changed");
                this.persistSession(this.getEverything);
            }
        }
    }

    removeId(id) {
        const index = this.assets.findIndex(asset => asset.id === id);
        if (index < 0) return;
        const wasCurrent = this.asset === this.assets[index];
        this.assets.splice(index, 1);
        if (wasCurrent) {
            this.asset = this.assets[Math.min(index, this.assets.length - 1)];
            this.publish(this.id, "asset-changed");
        }
        this.persistSession(this.getEverything);
    }

    goTo({from, to}) {
        if (this.asset && from !== this.asset.id) return;
        const toAsset = this.assets.find(asset => asset.id === to);
        if (!toAsset) return;
        this.asset = toAsset;
        this.publish(this.id, "asset-changed");
    }

    buttonActive({view, name, active}) {
        const button = this.buttons[name];
        if (active) {
            if (typeof active === "number") {
                button.until = this.now() + active;
            } else {
                button.views.add(view);
            }
        } else {
            button.views.delete(view);
        }
        this.publish(this.id, "button-changed", name);
    }

    viewExit(view) {
        for (const [name, button] of Object.entries(this.buttons)) {
            if (button.views.has(view)) {
                button.views.delete(view);
                this.publish(this.id, "button-changed", name);
            }
        }
    }

    // for direct access by view
    buttonIsActive(name, time) {
        const button = this.buttons[name];
        return button.views.size > 0 || Math.max(0, button.until - time) || false;
    }

    /* persistent session data */

    getEverything() {
        return {
            // only persist stored assets
            current: this.asset && this.asset.handle && this.asset.id,
            assets: this.assets.filter(asset => asset.handle).map(asset => ({
                id: asset.id,
                hash: asset.hash,
                type: asset.type,
                size: asset.size,
                name: asset.name,
                width: asset.width,
                height: asset.height,
                thumb: asset.thumb,
                data: Data.toId(asset.handle),
            })),
            handles: Object.keys(this.handles).sort().map(hash => [hash, Data.toId(this.handles[hash])]),
        };
    }

    restoreEverything(persistedData) {
        // persisted as { current, assets, handles? }
        const persistedCurrent = persistedData.current;
        for (const persisted of persistedData.assets) {
            // persisted as { id, hash?, type, size, name, width, height, thumb, data }
            const asset = {
                // id: persisted.id,    // will get new id
                hash: persisted.hash,
                type: persisted.type,
                size: persisted.size,
                name: persisted.name,
                width: persisted.width,
                height: persisted.height,
                thumb: persisted.thumb,
                handle: Data.fromId(persisted.data),
            };
            this.addAsset(asset);
            if (persistedCurrent === persisted.id) this.asset = asset;
        }
        if (persistedData.handles) for (const [hash, data] of persistedData.handles) {
            this.handles[hash] = Data.fromId(data);
        }
    }

}
PixModel.register("PixModel");


/******************** View ************************/


const THUMB_SIZE = 32;

function DEBUG_DELAY(arg) {
    const delay = +((location.search.match(/delay=([0-9]+)/)||[])[1]||0);
    if (!delay) return arg;
    return new Promise(resolve => setTimeout(() => resolve(arg), delay));
}

const contentCache = new WeakMap();
let objectURL;
const isTouch = "ontouchstart" in window;

class PixView extends View {

    constructor(model) {
        super(model);
        this.model = model;

        this.subscribe(this.model.id, {event: "asset-changed", handling: "oncePerFrame"}, this.onAssetChanged);
        this.onAssetChanged();

        this.subscribe(this.model.id, {event: "button-changed", handling: "oncePerFrame"}, this.onButtonChanged);
        for (const name of Object.keys(model.buttons)) {
            this.onButtonChanged(name);
        }

        // we do not use addEventListener so we do not have to remove them when going dormant
        window.ondragover = event => event.preventDefault();
        window.ondrop = event => {
            event.preventDefault();
            for (const item of event.dataTransfer.items) {
                if (item.kind === "file") this.addFile(item.getAsFile());
            }
        };
        document.onpaste = event => {
            event.preventDefault();
            for (const item of event.clipboardData.items) {
                if (item.kind === 'file') this.addFile(item.getAsFile());
            }
        };

        imageinput.onchange = () => {
            for (const file of imageinput.files) {
                this.addFile(file);
            }
            // with iOS camera images, the fake filename is always the same.
            // clear it so we get another change event the next time
            imageinput.value = "";
        };

        window.onresize = () => document.body.height = window.innerHeight;
        window.onresize();

        nextButton.onclick = () => this.advance(1);
        prevButton.onclick = () => this.advance(-1);
        addButton.onclick = () => imageinput.click();
        delButton.onclick = () => this.remove();

        const gestures = new Hammer(document.body);
        gestures.on('swiperight', () => this.advance(-1));
        gestures.on('swipeleft', () => this.advance(1));

        if (!isTouch) {
            let timer = 0;
            window.onmousemove = () => {
                if (timer) clearTimeout(timer);
                else document.body.classList.remove("mouse-inactive");
                timer = setTimeout(() => {
                    document.body.classList.add("mouse-inactive");
                    timer = 0;
                }, 3000);
            };
            window.onmousemove();
        }

        for (const button of [prevButton, nextButton, addButton, delButton]) {
            const name = button.id.replace('Button', '');
            if (isTouch) {
                button.onmousedown = () => this.activateButton(name, 2000);
                // no mouse-up, view will de-activate after 2 secs
            } else {
                button.onmouseenter = () => this.activateButton(name, true);
                button.onmouseleave = () => this.activateButton(name, false);
            }
        }

        if (window.parent !== window) {
            // assume that we're embedded in Q
            Messenger.startPublishingPointerMove();

            Messenger.setReceiver(this);
            Messenger.on("uploadFiles", "handleUploadFiles");
            Messenger.send("appReady", window.location.href);
            Messenger.on("appInfoRequest", () => {
                Messenger.send("appInfo", { appName: "pix", label: "images", iconName: "addimg.svgIcon", urlTemplate: "../pix/?q=${q}" });
                });
            Messenger.on("userCursor", data => window.document.body.style.setProperty("cursor", data));
            Messenger.send("userCursorRequest");
        }

    }

    handleUploadFiles(data) {
        data.files.forEach(file => this.addFile(file));
    }

    // only uploading user does this
    async addFile(file) {
        const types = ["image/jpeg", "image/gif", "image/png", "image/bmp"];
        if (!types.includes(file.type)) {
            await Swal.fire({
                title: `${file.name}: not a supported image format`,
                text: "Please use jpeg, gif, png, or bmp.",
                icon: "error",
                toast: true,
                timer: 10000,
                position: "top-end",
            });
            return;
        }

        // file is either an OS file object or a POJO with
        // properties { name, size, type, croquet_contents }
        // received through the Croquet Messenger.
        let data;
        if (file.croquet_contents) data = file.croquet_contents;
        else {
            data = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsArrayBuffer(file);
            });
        }
        const blob = new Blob([data], { type: file.type });
        const { width, height, thumb } = await this.analyzeImage(blob);
        if (!thumb || !width || !height) {
            await Swal.fire({
                title: `Failed to import ${file.name}`,
                text: this.isHEIF(data) ? "HEIF images are not supported by this browser" : `${file.name} is corrupted or has zero extent`,
                icon: "error",
                toast: true,
                timer: 10000,
                position: "top-end",
            });
            return;
        }

        image.src = thumb; // show placeholder for immediate feedback
        const hash = Data.hash(data);
        const asset = { hash, type: file.type, size: data.byteLength, name: file.name, width, height, thumb };
        this.publish(this.model.id, "add-asset", asset);
        const handle = this.model.handles[hash] || await Data.store(this.sessionId, data);
        contentCache.set(handle, blob);
        this.publish(this.model.id, "stored-data", { hash, handle });
    }

    // every user gets this event via model
    async onAssetChanged() {
        this.updateUI();
        const asset = this.model.asset;
        if (!asset) return;
        // are we already showing the desired image?
        if (asset === this.asset) return;
        // do we have the blob yet?
        let blob = asset.handle && contentCache.get(asset.handle);
        // (if this is the uploading view then it is cached but not stored yet, we could
        // show the full res immediately, but we rather show the thumb for feedback)
        if (!blob) {
            // no - show placeholder immediately, and go fetch it
            image.src = asset.thumb;
            this.asset = null;
            // ... unless asset is not even stored yet, in which case we will get another event
            if (!asset.handle) return;
            try {
                const data = await Data.fetch(this.sessionId, asset.handle).then(DEBUG_DELAY);
                blob = new Blob([data], { type: asset.type });
                contentCache.set(asset.handle, blob);
            } catch (ex) {
                console.error(ex);
                await Swal.fire({
                    title: `Failed to fetch "${asset.name}"`,
                    text: `(${prettyBytes(asset.size)})`,
                    icon: 'error',
                    toast: true,
                    timer: 3000,
                    position: "top-end",
                });
                return;
            }
            // is this still the asset we want to show after async fetching?
            if (asset !== this.model.asset) return this.onAssetChanged();
        }
        // we do have the blob, show it
        if (objectURL) URL.revokeObjectURL(objectURL);
        objectURL = URL.createObjectURL(blob);
        image.src = objectURL;
        // revoke objectURL ASAP
        image.onload = () => { if (objectURL === image.src) { URL.revokeObjectURL(objectURL); objectURL = ""; } };

        this.asset = asset;
    }

    async analyzeImage(blob) {
        // load image
        const original = new Image();
        original.src = URL.createObjectURL(blob);
        let success = true;
        try { await original.decode(); } catch (ex) { success = false; }
        URL.revokeObjectURL(original.src);
        if (!success) return {};

        const { width, height } = original;
        if (!original.width || !original.height) return {};

        // render to thumbnail canvas
        const aspect = original.width / original.height;
        const scale = THUMB_SIZE / Math.max(original.width, original.height);
        const canvas = document.createElement('canvas');
        canvas.width = aspect >= 1 ? THUMB_SIZE : THUMB_SIZE * aspect;
        canvas.height = aspect <= 1 ? THUMB_SIZE : THUMB_SIZE / aspect;
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(original, 0, 0);
        // export as data url
        const thumb = canvas.toDataURL("image/png");
        return { width, height, thumb };
    }

    isHEIF(buffer) {
        const FTYP = 0x66747970; // 'ftyp'
        const HEIC = 0x68656963; // 'heic'
        const data = new DataView(buffer);
        return data.getUint32(4) === FTYP && data.getUint32(8) === HEIC;
    }

    advance(offset) {
        const current = this.model.asset;
        const index = this.model.assets.indexOf(current);
        const next = this.model.assets[index + offset];
        if (current && next && current.id !== next.id) this.publish(this.model.id, "go-to", { from: current.id, to: next.id });
    }

    async remove() {
        const current = this.model.asset;
        if (!current) return;
        const result = await Swal.fire({
            title: 'Delete this image?',
            text: 'There is no undo 🛑',
            imageUrl: current.thumb,
            showCancelButton: true,
            confirmButtonText: 'Yes, delete it!',
            cancelButtonText: 'No, keep it',
        });
        if (result.value) {
            this.publish(this.model.id, "remove-id", current.id);
        }
    }

    onButtonChanged(name) {
        const button = window[`${name}Button`];
        const active = this.model.buttonIsActive(name, this.extrapolatedNow());
        if (active) button.classList.add("active");
        else button.classList.remove("active");
        // if activated by time, check again in a while
        if (typeof active === "number") setTimeout(() => this.onButtonChanged(name), active);
    }

    updateUI() {
        const current = this.model.asset;
        const index = this.model.assets.indexOf(current);
        const count = this.model.assets.length;
        image.style.display = !current ?  "none" : "";
        delButton.style.display = !current ?  "none" : "";
        prevButton.style.display = index <= 0 ? "none" : "";
        nextButton.style.display = index === count - 1 ? "none" : "";
    }

    activateButton(name, active) {
        this.publish(this.model.id, "button-active", {view: this.viewId, name, active});
    }
}

window.document.addEventListener("wheel", evt => evt.preventDefault(), { passive: false, capture: false });


App.makeWidgetDock();

Session.join({
    apiKey: "234567_Paste_Your_Own_API_Key_Here_7654321",
    appId: 'io.croquet.pix',
    model: PixModel,
    view: PixView,
    tps: 0
});
