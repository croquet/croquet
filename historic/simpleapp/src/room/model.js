import Model from '../model.js';
import ChildrenPart from '../modelParts/children.js';
import ColorPart from '../modelParts/color.js';
import SizePart from '../modelParts/size.js';

export default class Room extends Model {
    buildParts(state = {}) {
        new SizePart(this, state);
        new ColorPart(this, state);
        new ChildrenPart(this, state, { id: "objects" });
    }
}
