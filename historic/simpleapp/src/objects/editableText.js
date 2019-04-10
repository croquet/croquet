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
    constructor(model, options) {
        super(model, options);
        this.parts = {
            main: new (Tracking(EditableTextViewPart))(model, {})
        };
    }
}

class CarotaEditorView extends ViewPart {
    constructor(model, options) {
        super(model, options);
        this.parts = {
            main: new (Tracking(EditableTextViewPart))(model, {doc: model.parts['text'].doc, editable: true})
        };
    }
}
