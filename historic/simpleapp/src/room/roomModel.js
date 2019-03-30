import {StatePart} from '../modelView.js';
import ChildrenPart from '../stateParts/children.js';
import ColorPart from '../stateParts/color.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class Room extends StatePart {
    constructor() {
        super();
        this.parts = {
            color: new ColorPart(),
            objects: new ChildrenPart()
        };
    }
}
