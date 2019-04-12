import {StatePart} from "../modelView";
import ChildrenPart from "../stateParts/children";
import ColorPart from "../stateParts/color";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class Room extends StatePart {
    constructor() {
        super();
        this.parts = {
            color: new ColorPart(),
            objects: new ChildrenPart()
        };
    }
}
