import {ModelPart, ViewPart} from "../parts";
import SpatialPart from "../modelParts/spatial";
import TextPart from "../modelParts/text";

import Tracking from "../viewParts/tracking";
import EditableTextViewPart from "../viewParts/textView";

/** Model for a simple text display */
export default class TextElement extends ModelPart {
    constructor() {
        super();
        this.parts = {
            text: new TextPart(),
            spatial: new SpatialPart()
        };
    }

    init(options, id) {
        super.init(options, id);
        this.editable = options.editable;
        this.visualOptions = {
            font: "Barlow",
            fontSize: 0.25,
            width: 3,
            height: 2,
            ...options.visualOptions
        };
    }

    naturalViewClass() { return TextElementView; }
}
/** View for rendering a Text */
class TextElementView extends ViewPart {
    constructor(options) {
        super();
        const editable = options.model.editable;
        this.editable = editable;
        this.parts = {
            main: new (Tracking({
                source: options.model.parts.spatial,
            })(EditableTextViewPart))({
                textPart: options.model.parts.text,
                ...options.model.visualOptions,
                editable,
                showSelection: editable,
                showScrollBar: editable,
                hideBackground: !editable,
            })
        };
        this.forwardDimensionChange();
    }

    get label() {
        return this.editable ? "Editable Text" : "Text";
    }
}
