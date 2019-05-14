import {ModelPart} from "../parts";
import ChildrenPart from "../modelParts/children";
import ColorPart from "../modelParts/color";

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
}
