import * as THREE from "three";
import {ModelPart} from "../parts";
import ChildrenPart from "../modelParts/children";
import ColorPart from "../modelParts/color";
import { ImportedElement } from "../userAssets";

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

    init(options) { console.warn("room init");
        super.init(options);
        this.subscribe(this.parts.elements.id, "addAsset", data => this.addAsset(data));
    }

    addAsset(data) {
        this.parts.elements.add(ImportedElement.create({ spatial: { position: new THREE.Vector3(-2.25, 0, -2) }, assetDescriptor: data.assetDescriptor }));
    }
}
