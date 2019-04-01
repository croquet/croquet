import {StatePart, ViewPart} from '../modelView.js';
import SpatialPart from '../stateParts/spatial.js';
import TextPart from '../stateParts/editableText.js';

import Tracking from '../viewParts/tracking.js';
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
            main: new (Tracking(EditableTextViewPart))(modelState, {})
        };
    }
}

class CarotaEditorView extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.parts = {
            main: new (Tracking(EditableTextViewPart))(modelState, {editable: true})
        };
    }
}
