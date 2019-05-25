import * as THREE from "three";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export class DragDropHandler {
    constructor(options) {
        this.assetManager = options.assetManager;
    }

    setCurrentRoomView(roomView) {
        this.currentRoomView = roomView;
    }

    isFileDrop(evt) {
        const dt = evt.dataTransfer;
        for (let i = 0; i < dt.types.length; i++) {
            if (dt.types[i] === "Files") {
                return true;
            }
        }
        return false;
    }

    isStringDrop(evt) {
        // NB: until drop, we don't have access to the content
        const dtTypes = evt.dataTransfer.types;
        for (let i = 0; i < dtTypes.length; i++) {
            if (dtTypes[i] === "text/plain") {
                return true;
            }
        }
        return false;
    }

    async extractString(evt) {
        // @@ could be more specific here about what makes the string acceptable
        const dtItems = evt.dataTransfer.items;
        for (let i = 0; i < dtItems.length; i++) {
            if (dtItems[i].type === "text/plain") {
                return new Promise(resolve => dtItems[i].getAsString(resolve));
            }
        }
        return null;
    }

    onDrop(evt) {
        if (!this.currentRoomView) return;

        if (this.isFileDrop(evt)) console.log("file", evt.dataTransfer.items);
        else if (this.isStringDrop(evt)) this.extractString(evt).then(str => console.log("string", str));
        else console.log("unknown drop type");
    }

}

export const theDragDropHandler = new DragDropHandler();
