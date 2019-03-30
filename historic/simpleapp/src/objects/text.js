import {StatePart, ViewPart} from "../modelView.js";
import TextPart from "../stateParts/text.js";
import SpatialPart from "../stateParts/spatial.js";
import TextViewPart, { TrackText } from "../viewParts/text.js";
import TrackSpatial from "../viewParts/trackSpatial.js";

/** Model for a simple text display */
export class TextObject extends StatePart {
    constructor() {
        super();
        this.parts = {
            text: new TextPart(),
            spatial: new SpatialPart()
        };
    }

    naturalViewClass() { return TextObjectView; }
}

/** View for rendering a Text */
export class TextObjectView extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.parts = {
            main: new TrackSpatial(modelState, {
                inner: new TrackText(modelState, {inner:
                    new TextViewPart(modelState, {fontSize: 0.4})
                })
            })
        };
    }
}
