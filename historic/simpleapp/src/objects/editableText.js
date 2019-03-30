import {StatePart, ViewPart} from '../modelView.js';
import SpatialPart from '../stateParts/spatial.js';
import TextPart from '../stateParts/editableText.js';

import TrackSpatial from '../viewParts/trackSpatial.js';
import EditableTextViewPart from '../viewParts/editableText/text.js';

/** Model for a simple text display */
export default class CarotaTextObject extends StatePart {
    constructor() {
        super();
        this.parts = {
            text: new TextPart(),
            spatial: new SpatialPart()
        };
    }

    naturalViewClass() { return CarotaTextView; }
}

/** Model for a text editor */
export class CarotaEditorObject extends CarotaTextObject {
    naturalViewClass() { return CarotaEditorView; }
}

/** View for rendering a Text */
class CarotaTextView extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.parts = {
            main: new TrackSpatial(modelState, {
                inner: new EditableTextViewPart(modelState, {})
            })
        };
    }
}

class CarotaEditorView extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.parts = {
            main: new TrackSpatial(modelState, {
                inner: new EditableTextViewPart(modelState, {editable: true})
            })
        };
    }
}
