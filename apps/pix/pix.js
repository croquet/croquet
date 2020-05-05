import { Model, View, Data, Session, App } from "@croquet/croquet"
import EXIF from "@nuofe/exif-js";

class PixModel extends Model {

    init() {
        this.subscribe(this.id, "add-asset", this.addAsset);
    }

    addAsset(asset) {
        this.asset = asset;
        this.publish(this.id, "asset-added", asset);
    }

}
PixModel.register();


class PixView extends View {

    constructor(model) {
        super(model);
        this.model = model;
        this.subscribe(this.model.id, "asset-added", this.assetAdded);
        if (model.asset) this.assetAdded(model.asset);

        window.ondragover = event => event.preventDefault();
        window.ondrop = event => {
            event.preventDefault();
            this.addFile(event.dataTransfer.items[0].getAsFile());
        }
        imageinput.onchange = () => {
            this.addFile(imageinput.files[0]);
        };
        window.onresize = () => document.body.height = window.innerHeight;
        window.onresize();
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
        const asset = { name: file.name, type: file.type, size: data.byteLength, handle };
        this.publish(this.model.id, "add-asset", asset);
        this.showImage(asset);
    }

    // every user gets this event via model
    async assetAdded(asset) {
        this.showMessage(`fetching "${asset.name}" (${asset.size} bytes)`);
        this.showImage(asset);
    }

    showMessage(string) {
        message.innerText = string;
        message.style.display = string ? "" : "none";
        if (string) console.log(string);
    }

    async showImage(asset) {
        this.showMessage("");
        let data;
        try {
            data = await Data.fetch(this.sessionId, asset.handle);  // <== Croquet.Data API
        } catch(ex) {
            console.error(ex);
            this.showMessage(`Failed to fetch "${asset.name}" (${asset.size} bytes)`);
            return;
        }
        const exif = EXIF.readFromBinaryFile(data);
        if (exif) console.log("EXIF:", exif);
        const blob = new Blob([data], { type: asset.type });
        const url = URL.createObjectURL(blob);
        image.src = url;
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
