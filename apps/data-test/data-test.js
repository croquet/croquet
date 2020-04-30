import { Model, View, Data, Session, App } from "@croquet/croquet"

class DataTestModel extends Model {

    init() {
        this.subscribe(this.id, "add-asset", this.addAsset);
    }

    addAsset(asset) {
        this.asset = asset;
        this.publish(this.id, "asset-added", asset);
    }

}
DataTestModel.register();


class DataTestView extends View {

    constructor(model) {
        super(model);
        this.modelId = model.id;
        this.subscribe(this.modelId, "asset-added", this.assetAdded);
        if (model.asset) this.assetAdded(model.asset);

        window.ondragover = event => event.preventDefault();
        window.ondrop = event => {
            event.preventDefault();
            this.onFileDropped(event.dataTransfer.items[0].getAsFile());
        }
    }

    // only uploading user does this
    async onFileDropped(file) {
        if (!file.type.startsWith('image/')) return console.warn(`Not an image: "${file.name}" (${file.type})`);
        const data = await file.arrayBuffer();
        this.showMessage(`sending "${file.name}" (${data.byteLength} bytes}`);   // for immediate feedback
        const handle = await Data.store(this.sessionId, data); // <== Croquet.Data API
        console.log("got handle:", handle);
        const asset = { name: file.name, type: file.type, size: data.byteLength, handle };
        this.publish(this.modelId, "add-asset", asset);
        this.showImage(asset);
    }

    // every user gets this event via model
    async assetAdded(asset) {
        this.showMessage(`fetching "${asset.name}" (${asset.size} bytes}`);   // for immediate feedback
        this.showImage(asset);
    }

    showMessage(string) {
        message.innerText = string;
        console.log(string);
    }

    async showImage(asset) {
        const data = await Data.fetch(this.sessionId, asset.handle);  // <== Croquet.Data API
        this.showMessage(`fetched "${asset.name}" (${data.byteLength} bytes)`);
        const blob = new Blob([data], { type: asset.type });
        document.body.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
    }
}


App.makeWidgetDock();
Session.join("data-test", DataTestModel, DataTestView, {tps: 0});
