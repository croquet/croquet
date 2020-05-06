import { Model, View, Data, Session, App } from "@croquet/croquet"
import EXIF from "@nuofe/exif-js";
import Hammer from "hammerjs";

class PixModel extends Model {

    init() {
        this.assetIds = 0;
        this.assets = [];
        this.subscribe(this.id, "add-asset", this.addAsset);
        this.subscribe(this.id, "go-to", this.goTo);
    }

    addAsset(asset) {
        this.asset = asset;
        this.assets.push(asset);
        this.asset.id = ++this.assetIds;
        this.publish(this.id, "asset-changed", this.asset);
    }

    goTo({from, to}) {
        if (this.asset && from !== this.asset.id) return;
        const toAsset = this.assets.find(asset => asset.id === to);
        if (!toAsset) return;
        this.asset = toAsset;
        this.publish(this.id, "asset-changed", this.asset);
    }

}
PixModel.register();


const contentCache = new WeakMap();
let objectURL;

class PixView extends View {

    constructor(model) {
        super(model);
        this.model = model;
        if (model.asset) this.assetChanged(model.asset);
        this.subscribe(this.model.id, "asset-changed", this.assetChanged);

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
        window.onkeydown = event => {
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            switch (event.key) {
                case "ArrowLeft": this.advance(-1); break;
                case "ArrowRight": this.advance(1); break;
                default: return;
            }
            event.preventDefault();
        }
        const gestures = new Hammer(document.body);
        gestures.on('tap', () => imageinput.click());
        gestures.on('swipe', event => this.advance(-Math.sign(event.deltaX)));
    }

    // only uploading user does this
    async addFile(file) {
        if (!file.type.startsWith('image/')) return this.showMessage(`Not an image: "${file.name}" (${file.type})`);
        this.showMessage(`reading "${file.name}" (${file.type})`);
        const data = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsArrayBuffer(file);
        });
        this.showMessage(`sending "${file.name}" (${data.byteLength} bytes)`);
        const handle = await Data.store(this.sessionId, data); // <== Croquet.Data API
        this.addToCache(handle, data);
        const asset = { name: file.name, type: file.type, size: data.byteLength, handle };
        this.publish(this.model.id, "add-asset", asset);
        this.assetChanged(asset);
    }

    // every user gets this event via model
     async assetChanged(asset) {
        this.showMessage("");
        let data = this.getFromCache(asset.handle);
        if (!data) {
            try {
                data = await Data.fetch(this.sessionId, asset.handle);  // <== Croquet.Data API
                this.addToCache(asset.handle, data);
            } catch(ex) {
                console.error(ex);
                this.showMessage(`Failed to fetch "${asset.name}" (${asset.size} bytes)`);
                return;
            }
        }
        const blob = new Blob([data], { type: asset.type });
        if (objectURL) URL.revokeObjectURL(objectURL);
        objectURL = URL.createObjectURL(blob);
        image.src = objectURL;
    }

    showMessage(string) {
        message.innerText = string;
        message.style.display = string ? "" : "none";
        if (string) console.log(string);
    }

    advance(offset) {
        const current = this.model.asset;
        const index = this.model.assets.indexOf(current);
        const next = this.model.assets[index + offset];
        if (current && next && current.id !== next.id) this.publish(this.model.id, "go-to", { from: current.id, to: next.id });
    }

    addToCache(handle, data) {
        contentCache.set(handle, data);
        const exif = EXIF.readFromBinaryFile(data);
        if (exif) console.log("EXIF:", exif);
    }

    getFromCache(handle) {
        return contentCache.get(handle);
    }
}


let room = window.location.hash.slice(1);
if (!room) {
    room = Math.floor(Math.random() * 2**53).toString(36);
    window.location.hash = room;
    App.sessionURL = window.location.href;
}

App.makeWidgetDock();
Session.join(`pix-${room}`, PixModel, PixView, {tps: 0});
