import Model from '../model.js';
import SpatialPart from '../stateParts/spatial.js';
import TextPart from '../stateParts/text.js';

import View from '../view.js';
import TrackSpatial from '../viewParts/trackSpatial.js';
import TextViewPart from '../viewParts/text.js';

/** Model for a simple text display */
export default class Text extends Model {
    buildParts(state) {
        new TextPart(this, state);
        new SpatialPart(this, state);
    }

    naturalViewClass() { return TextView; }
}

/** Model for a text editor */
export class Editor extends Text {

    naturalViewClass() { return EditorView; }

}

/** View for rendering a Text */
class TextView extends View {
    buildParts() {
        new TextViewPart(this, {});
        new TrackSpatial(this, { affects: "text" });
    }
}

class EditorView extends View {
    buildParts() {
        new TextViewPart(this, { editable: true });
        new TrackSpatial(this, { affects: "text" });
    }
}
