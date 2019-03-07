import Model from '../model.js';
import ChildrenPart from '../stateParts/children.js';
import ColorPart from '../stateParts/color.js';
import SizePart from '../stateParts/size.js';

export default class Room extends Model {
    buildParts(state = {}) {
        new SizePart(this, state);
        new ColorPart(this, state);
        new ChildrenPart(this, state, { id: "objects" });
    }
}
