import {StatePart, ViewPart} from "../modelView";
import SpatialPart from "../stateParts/spatial";
import TextPart from "../stateParts/text";

import Tracking from "../viewParts/tracking";
import EditableTextViewPart from "../viewParts/textView";

/** Model for a simple text display */
export default class TextElement extends StatePart {
    constructor() {
        super();
        this.parts = {
            text: new TextPart(),
            spatial: new SpatialPart()
        };
    }

    applyState(state={}) {
        super.applyState(state);
        this.editable = state.editable;
        this.visualOptions = {
            font: "Barlow",
            fontSize: 0.25,
            width: 3,
            height: 2,
            ...state.visualOptions
        };
    }

    toState(state) {
        super.toState(state);
        state.editable = this.editable;
        state.visualOptions = this.visualOptions;
    }

    naturalViewClass() { return TextElementView; }
}
/** View for rendering a Text */
class TextElementView extends ViewPart {
    constructor(options) {
        super();
        const editable = options.model.editable;
        this.parts = {
            main: new (Tracking({source: options.model.parts.spatial})(EditableTextViewPart))({
                textPart: options.model.parts.text,
                ...options.model.visualOptions,
                editable,
                showSelection: editable,
                showScrollBar: editable,
                hideBackground: !editable,
            })
        };
    }
}
