import Model from "../model.js";
import TextPart from "../stateParts/text.js";
import SpatialPart from "../stateParts/spatial.js";
import View from "../view.js";
import TextViewPart, { TrackText } from "../viewParts/text.js";
import TrackSpatial from "../viewParts/trackSpatial.js";

/** Model for a simple text display */
export class Text extends Model {
    buildParts(state) {
        new TextPart(this, state);
        new SpatialPart(this, state);
    }

    naturalViewClass() { return TextView; }
}

/** View for rendering a Text */
export class TextView extends View {
    buildParts() {
        new TextViewPart(this, {fontSize: 0.4});
        new TrackSpatial(this, {affects: "text"});
        new TrackText(this);
    }
}
