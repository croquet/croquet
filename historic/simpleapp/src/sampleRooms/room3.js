import * as THREE from 'three';
import Island from '../island.js';
import Room from "../room/roomModel.js";
import Model from '../model.js';
import SpatialPart from '../stateParts/spatial.js';
import View from '../view.js';
import TextPart from '../stateParts/text.js';
import TextViewPart from '../viewParts/text.js';
import TrackSpatial from '../viewParts/trackSpatial.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export class Text extends Model {
    buildParts(state) {
        new TextPart(this, state);
        new SpatialPart(this, state);
    }

    naturalViewClass() { return TextView; }
}

/** View for rendering a Text */
class TextView extends View {
    buildParts() {
        new TextViewPart(this, {editable: true});
        new TrackSpatial(this, {affects: "text"});
    }
}

export default function initRoom3(state) {
    state = { id: "2bb90375ea596139cc2cdcf474df4118", ...state };
    return new Island(state, () => {
        let room = new Room();

        const text1 = new Text({
            spatial: { position: new THREE.Vector3(-3, 1.0, 0) },
            text: { content: [{text: "man is much more than a tool builder... he is an inventor of universes... Except the real one."}], numLines: 10, width: 3, height: 2}
        });
        room.parts.objects.add(text1);
    });
}
