import { Model, View, Data, Session, App } from "@croquet/croquet"
import Hammer from "hammerjs";
import prettyBytes from "pretty-bytes";

const THUMB_SIZE = 32;

function DEBUG_DELAY(arg) {
    const delay = +((location.search.match(/delay=([0-9]+)/)||[])[1]||0);
    if (!delay) return arg;
    return new Promise(resolve => setTimeout(() => resolve(arg), delay));
}

class PixModel extends Model {

    init() {
        this.assetIds = 0;
        this.assets = [];
        this.subscribe(this.id, "add-asset", this.addAsset);
        this.subscribe(this.id, "remove-id", this.removeId);
        this.subscribe(this.id, "go-to", this.goTo);
    }

    addAsset(asset) {
        this.asset = asset;
        this.assets.push(asset);
        this.asset.id = ++this.assetIds;
        this.publish(this.id, "asset-changed");
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

}
PixModel.register();


const contentCache = new WeakMap();
let objectURL;

class PixView extends View {

    constructor(model) {
        super(model);
        this.model = model;
        this.subscribe(this.model.id, {event: "asset-changed", handling: "oncePerFrame"}, this.assetChanged);
        this.assetChanged();

        // we do not use addEventListener so we do not have to remove them when going dormant
        window.ondragover = event => event.preventDefault();
        window.ondrop = event => {
            event.preventDefault();
            for (const item of event.dataTransfer.items) {
                if (item.kind === "file") this.addFile(item.getAsFile());
            }
        }
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
        gestures.on('swiperight', event => this.advance(-1));
        gestures.on('swipeleft', event => this.advance(1));
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
        App.showMessage(`Uploading image (${prettyBytes(data.byteLength)})`);
        const handle = await Data.store(this.sessionId, data).then(DEBUG_DELAY);
        contentCache.set(handle, blob);
        const asset = { handle, type: file.type, size: data.byteLength, name: file.name, width, height, thumb };
        this.publish(this.model.id, "add-asset", asset);
    }

    // every user gets this event via model
    async assetChanged() {
        this.updateUI();
        const asset = this.model.asset;
        if (!asset) return;
        // are we already showing the desired image?
        if (asset === this.asset) return;
        // do we have it cached?
        let blob = contentCache.get(asset.handle);
        if (!blob) {
            // no - show placeholder immediately, and go fetch it
            image.src = asset.thumb;
            this.asset = null;
            try {
                App.showMessage(`Fetching image (${prettyBytes(asset.size)})`);
                const data = await Data.fetch(this.sessionId, asset.handle).then(DEBUG_DELAY);
                blob = new Blob([data], { type: asset.type });
                contentCache.set(asset.handle, blob);
            } catch(ex) {
                console.error(ex);
                App.showMessage(`Failed to fetch "${asset.name}" (${prettyBytes(asset.size)})`, {level: "warning"});
                return;
            }
            // is this still the asset we want to show after async fetching?
            if (asset !== this.model.asset) return this.assetChanged();
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
        const original = await new Promise(resolve => {
            const objectURL = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(objectURL); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(objectURL); resolve({}); };
            img.src = objectURL;
        });
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

    updateUI() {
        const current = this.model.asset;
        const index = this.model.assets.indexOf(current);
        const count = this.model.assets.length;
        image.style.display = !current ?  "none" : "";
        delButton.style.display = !current ?  "none" : "";
        prevButton.style.display = index <= 0 ? "none" : "";
        nextButton.style.display = index === count - 1 ? "none" : "";
    }
}


App.messages = true;
App.makeWidgetDock();
Session.join(`pix-${App.autoSession()}`, PixModel, PixView, {tps: 0});
