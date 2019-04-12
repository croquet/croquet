import {StatePart, ViewPart} from "../modelView";
import TextPart from "../stateParts/text";
import SpatialPart from "../stateParts/spatial";
import TextViewPart, { TextTracking } from "../viewParts/text";
import Tracking from "../viewParts/tracking";

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
    constructor(options) {
        super(options);
        this.parts = {
            main: new (Tracking()(TextTracking()(TextViewPart)))({fontSize: 0.4, source: options.model.parts.text, ...options})
        };
    }
}
