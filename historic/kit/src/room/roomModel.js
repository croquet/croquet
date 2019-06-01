import * as THREE from "three";
import {ModelPart} from "../parts";
import ChildrenPart from "../modelParts/children";
import ColorPart from "../modelParts/color";
import { ImportedElement, ImportedVideoElement } from "../userAssets";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class Room extends ModelPart {
    constructor() {
        super();
        this.parts = {
            color: new ColorPart(),
            elements: new ChildrenPart()
        };
    }

    init(options) {
        super.init(options);
        this.subscribe(this.parts.elements.id, "addAsset", data => this.addAsset(data));
    }

    addAsset(data) {
        const assetDescriptor = data.assetDescriptor;
        const loadType = assetDescriptor.loadType;
        const ImportClass = loadType === ".mp4" ? ImportedVideoElement : ImportedElement;
        this.parts.elements.add(ImportClass.create({ spatial: { position: new THREE.Vector3(-1, 1, -1) }, assetDescriptor }));
    }
}
