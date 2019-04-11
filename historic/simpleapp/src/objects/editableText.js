import {StatePart, ViewPart} from '../modelView.js';
import SpatialPart from '../stateParts/spatial.js';
import TextPart from '../stateParts/editableText.js';

import Tracking from '../viewParts/tracking.js';
import EditableTextViewPart from '../viewParts/editableText.js';

/** Model for a simple text display */
export default class WarotaTextObject extends StatePart {
    constructor() {
        super();
        this.parts = {
            text: new TextPart(),
            spatial: new SpatialPart()
        };
    }

    naturalViewClass() { return WarotaTextView; }
}

/** Model for a text editor */
export class WarotaEditorObject extends WarotaTextObject {
    naturalViewClass() { return WarotaEditorView; }
}

/** View for rendering a Text */
class WarotaTextView extends ViewPart {
    constructor(options) {
        super();
        this.parts = {
            main: new (Tracking({source: options.model.parts.spatial})(EditableTextViewPart))({textPart: options.model.parts.text})
        };
    }
}

class WarotaEditorView extends ViewPart {
    constructor(options) {
        super();
        this.parts = {
            main: new (Tracking({source: options.model.parts.spatial})(EditableTextViewPart))({textPart: options.model.parts.text})
        };
    }
}
