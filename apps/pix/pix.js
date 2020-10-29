import { Model, View, Data, Session, App, Messenger } from "@croquet/croquet";
import Hammer from "hammerjs";
import prettyBytes from "pretty-bytes";

class PixModel extends Model {

    init({persistedData}) {
        this.asset = null;
        this.assetIds = 0;
        this.assets = [];
        this.subscribe(this.id, "add-asset", this.addAsset);
        this.subscribe(this.id, "stored-data", this.storedData);
        this.subscribe(this.id, "remove-id", this.removeId);
        this.subscribe(this.id, "go-to", this.goTo);

        this.buttons = {};
        for (const name of ["prev", "next", "add", "del"]) {
            this.buttons[name] = { views: new Set(), since: 0, active: false };
        }
        this.subscribe(this.id, "button-active", this.buttonActive);
        this.subscribe(this.sessionId, "view-exit", this.viewExit);

        if (persistedData) this.restoreEverything(persistedData);
    }

    addAsset(asset) {
        this.asset = asset;
        this.assets.push(asset);
        this.asset.id = ++this.assetIds;
        this.publish(this.id, "asset-changed");
    }

    storedData(handle) {
        for (const asset of this.assets) {
            if (handle === asset.handle) {
                asset.stored = true;
                this.publish(this.id, "asset-changed");
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
            button.views.add(view);
            button.since = this.now();
            this.future(2500).updateButton(name);
        } else {
            button.views.delete(view);
        }
        this.updateButton(name);
    }

    viewExit(view) {
        for (const [name, button] of Object.entries(this.buttons)) {
            button.views.delete(view);
            this.updateButton(name);
        }
    }

    updateButton(name) {
        const button = this.buttons[name];
        const active = button.views.size > 0 && this.now() - button.since < 2000;
        if (button.active !== active) {
            button.active = active;
            this.publish(this.id, "button-changed", {name, active});
        }
    }

    /* persistant session data */

    getEverything() {
        return {
            // only persist stored assets
            current: this.asset && this.asset.stored && this.asset.id,
            assets: this.assets.filter(asset => asset.stored).map(asset => ({
                id: asset.id,
                type: asset.type,
                size: asset.size,
                name: asset.name,
                width: asset.width,
                height: asset.height,
                thumb: asset.thumb,
                data: Data.toId(asset.handle),
            })),
        };
    }

    restoreEverything(persistedData) {
        // persisted as { current, assets }
        const currentId = persistedData.current;
        for (const persisted of persistedData.assets) {
            // persisted as { id, type, size, name, width, height, thumb, data }
            const asset = {
                id: persisted.id,
                type: persisted.type,
                size: persisted.size,
                name: persisted.name,
                width: persisted.width,
                height: persisted.height,
                thumb: persisted.thumb,
                stored: true,         // only stored assets have been persisted
                handle: Data.fromId(persisted.data),
            };
            this.addAsset(asset);
            if (currentId === asset.id) this.asset = asset;
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
        for (const [name, button] of Object.entries(model.buttons)) {
            this.onButtonChanged({name, active: button.active});
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
                button.onmousedown = () => this.activateButton(name, true);
                // no mouse-up, model will deactivate after 2 secs
            } else {
                button.onmouseenter = () => this.activateButton(name, true);
                button.onmouseleave = () => this.activateButton(name, false);
            }
        }

        if (window.parent !== window) {
            // assume that we're embedded in Q
            Messenger.startPublishingPointerMove();

            Messenger.setReceiver(this);
            Messenger.send("appReady");
            Messenger.on("appInfoRequest", () => {
                Messenger.send("appInfo", { appName: "pix", label: "images", iconName: "addimg.svgIcon", urlTemplate: "../pix/?q=${q}" });
                });
            Messenger.on("userCursor", data => window.document.body.style.setProperty("cursor", data));
            Messenger.send("userCursorRequest");
        }

    }

    // only uploading user does this
    async addFile(file) {
        if (!file.type.startsWith('image/')) return App.showMessage(`Not an image: "${file.name}" (${file.type})`, {level: "warning"});
        const data = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsArrayBuffer(file);
        });
        const blob = new Blob([data], { type: file.type });
        const { width, height, thumb } = await this.analyzeImage(blob);
        if (!thumb) return App.showMessage(`Image is empty (${width}x${height}): "${file.name}" (${file.type})`, {level: "warning"});
        // show placeholder for immediate feedback
        image.src = thumb;
        const handle = await Data.store(this.sessionId, data, true);
        contentCache.set(handle, blob);
        const asset = { handle, stored: false, type: file.type, size: data.byteLength, name: file.name, width, height, thumb };
        this.publish(this.model.id, "add-asset", asset);
        await handle.stored().then(DEBUG_DELAY);
        this.publish(this.model.id, "stored-data", handle);
    }

    // every user gets this event via model
    async onAssetChanged() {
        this.updateUI();
        const asset = this.model.asset;
        if (!asset) return;
        // are we already showing the desired image?
        if (asset === this.asset) return;
        // do we have the blob yet?
        let blob = asset.stored && contentCache.get(asset.handle);
        // (if this is the uploading view then it is cached but not stored yet, we could
        // show the full res immediately, but we rather show the thumb for feedback)
        if (!blob) {
            // no - show placeholder immediately, and go fetch it
            image.src = asset.thumb;
            this.asset = null;
            // ... unless asset is not even stored yet, in which case we will get another event
            if (!asset.stored) return;
            try {
                const data = await Data.fetch(this.sessionId, asset.handle).then(DEBUG_DELAY);
                blob = new Blob([data], { type: asset.type });
                contentCache.set(asset.handle, blob);
            } catch(ex) {
                console.error(ex);
                App.showMessage(`Failed to fetch "${asset.name}" (${prettyBytes(asset.size)})`, {level: "warning"});
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
        try { await original.decode(); } catch(ex) { }
        URL.revokeObjectURL(original.src);
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


    advance(offset) {
        const current = this.model.asset;
        const index = this.model.assets.indexOf(current);
        const next = this.model.assets[index + offset];
        if (current && next && current.id !== next.id) this.publish(this.model.id, "go-to", { from: current.id, to: next.id });
    }

    remove() {
        const current = this.model.asset;
        if (!current) return;
        if (confirm("Delete this image?")) {
            this.publish(this.model.id, "remove-id", current.id);
        }
    }

    onButtonChanged({name, active}) {
        const button = window[`${name}Button`];
        if (active) button.classList.add("active");
        else button.classList.remove("active");
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

// const persistedData = {"current":2,"assets":[{"id":1,"type":"image/png","size":67742,"name":"trans_meow.png","width":451,"height":485,"thumb":"data:image/png;base64,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","data":"02C0urF_lCdlGGlYeDbjDEEVXK-qJuKS27RoEU_TIFXcU3667emjc5Stzd/fmB3nRbSyNISGiVrxHOD5CubykXM="},{"id":2,"type":"image/jpeg","size":1508789,"name":"ghost in the shell.jpg","width":1604,"height":2024,"thumb":"data:image/png;base64,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","data":"0hH24XZgWGj0h2fsGLc8uVfu2r9d-MnaMUKl-VqJ4Rp0CIk0PDutTXOQDt+ygT7w60DBVgXpGnZN8O4GkuFbxSA="}]};

App.messages = true;
App.makeWidgetDock();
Session.join(App.autoSession(), PixModel, PixView, {
    // options: { persistedData },
    appId: "io.croquet.pix",
    tps: 0,
});
