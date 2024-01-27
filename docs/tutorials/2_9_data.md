Copyright © 2020 Croquet Corporation

Croquet offers secure bulk data storage service for apps. A Croquet application can upload a file, typically media content or a document file, to the Croquet file server. The `store()` function returns a *data handle* that can be sent to replicated models in a Croquet message, and then other participants can `fetch()` the stored data. Off-loading the actual bits of data to a file server and keeping only its meta data in the model is a lot more efficient than trying to send that data via `publish`/`subscribe`. It also allows caching.

Just like snapshot and persistent data, data uploaded via the Data API is encrypted so that only the users who have access to the session can decrypt the data.

Following is a full example of the Data API.

~~~~ HTML
<html>
    <head>
        <meta charset="utf-8">
        <title>Data test</title>
        <script src="https://cdn.jsdelivr.net/npm/@croquet/croquet@1.0.5"></script>
    </head>
    <body style="background-color: #666; background-size: contain; background-repeat: no-repeat; background-position: center;" onclick="imageinput.click()">
        <input id="imageinput" type="file" accept="image/*" style="display:none;">
        <span id="message" style="background-color: rgb(255,255,255,0.5);">click to import picture, or drag-and-drop one</i></span>
        <script>


class DataTestModel extends Croquet.Model {

    init() {
        this.subscribe("global", "add-asset", this.addAsset);
    }

    addAsset(asset) {
        this.asset = asset;
        this.publish("global", "asset-added", asset);
    }

}
DataTestModel.register("DataTestModel");


class DataTestView extends Croquet.View {

    constructor(model) {
        super(model);
        this.subscribe("global", "asset-added", this.assetAdded);
        if (model.asset) this.assetAdded(model.asset);

        window.ondragover = event => event.preventDefault();
        window.ondrop = event => {
            event.preventDefault();
            this.addFile(event.dataTransfer.items[0].getAsFile());
        }
        imageinput.onchange = () => {
            this.addFile(imageinput.files[0]);
            imageinput.value = ''; // otherwise upload of another camera images won't trigger onchange
        };
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
        this.showMessage(`sending "${file.name}" (${data.byteLength} bytes}`);
        const handle = await Croquet.Data.store(this.sessionId, data); // <== Croquet.Data API
        const asset = { name: file.name, type: file.type, size: data.byteLength, handle };
        this.publish("global", "add-asset", asset);
    }

    // every user gets this event via model
    async assetAdded(asset) {
        this.showMessage(`fetching "${asset.name}" (${asset.size} bytes}`);
        this.showImage(asset);
    }

    showMessage(string) {
        message.innerText = string;
        console.log(string);
    }

    async showImage(asset) {
        const data = await Croquet.Data.fetch(this.sessionId, asset.handle);  // <== Croquet.Data API
        this.showMessage(`fetched "${asset.name}" (${data.byteLength} bytes)`);
        const blob = new Blob([data], { type: asset.type });
        document.body.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
    }
}


Croquet.App.makeWidgetDock();
Croquet.Session.join({
    appId: "com.example.datatest", // replace with your own!
    apiKey: "insert your key here",
    name: Croquet.App.autoSession(),
    password: Croquet.App.autoPassword(),
    model: DataTestModel,
    view: DataTestView,
    tps: 0,
});
        </script>
    </body>
</html>


~~~~

When you drop an image file from Exploror or Finder onto the browser window, or click in the window to get the file dialog and choose a file, the `addFile()` of the `DataTestView` is invoked. The  `addFile()` method calls `Croquet.Data.store()` with `this.sessionId` and `data` as an `ArrayBuffer`. `Croquet.Data.store()` returns asynchronously the data handle, which can be sent to the model over a Croquet message.

In this example, the data handle is forwarded back to views from the model in `addAsset()` of the model. The view fetches the data from the file server by calling `Croquet.Data.fetch()`.In this example, it creates a `Blob` object and use it as the `background-image` CSS style.

`Croquet.Data.store()` takes optional third boolean flag argument that specifies whether to keep the `ArrayBuffer` data in the main thread, or transfer it to the WebWorker that handles uploading data.  If you need to process the same data after you call `Croquet.Data.store()`, pass `true` as the third "keep" flag.

Most likely that you would like to store a data handle in persistent data so that information about the data handle can be stored and loaded into a new session with the same `appId` and session `name` but with modified code. In that case, you use `Croquet.Data.toId()` to create a transferable string representation of the handle, and recreate the equivalent data handle by calling `Croquet.Data.fromId()`.  (See an example in pix and other apps.)

# Best Practices
Keep in mind that accessing external services is responsibility of the view, as the model should be concerned with the logical data.  Calling `Croquet.Data.store()` and `Croquet.Data.fetch()` is done by the view asynchronously, and the view notifies the model via a Croquet message.

You will most likely to store the `id` for the data handle created by `Croquet.Data.toId()` for persistent data. It is indeed fine to store the id in the model as the primary data, and the view creates the data handle from it by calling `Croquet.Data.fromId()` before fetching data.

As in the example above, you can use an `input` DOM element with `type="file"` to get the browser's file dialog or camera roll dialog. However, while the browser file dialog is opened, the JavaScript execution is suspended and the Croquet network connection may disconnect while the user takes a long time, over 30 seconds, to select a file. It is recommended to handle this case by storing the information of the chosen file in a global variable, and view's `synced` handler picks it up. (see an example in the Piix.)

Notice that `init()` of the view calls `assetAdded` when there already is `model.asset` so that a view that joined later shows the same image. This is a common pattern that is not limited to apps that uses Data API, but a useful tip to know to make a late comers to the session be synchronized.