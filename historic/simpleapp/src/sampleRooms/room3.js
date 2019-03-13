import * as THREE from 'three';
import Island from '../island.js';
import Room from "../room/roomModel.js";
import Model from '../model.js';
import StatePart from "../statePart.js";
import SpatialPart from '../stateParts/spatial.js';
import InertialSpatialPart from '../stateParts/inertialSpatial.js';
import BouncingSpatialPart from '../stateParts/bouncingSpatial.js';
import View from '../view.js';
import TextPart from '../stateParts/text.js';
import TextViewPart, { TrackText } from '../viewParts/text.js';
import Object3D, { Object3DGroup } from '../viewParts/object3D.js';
import DraggableViewPart from '../viewParts/draggable.js';
import TrackSpatial from '../viewParts/trackSpatial.js';
import { LayoutRoot, LayoutContainer, LayoutSlotStretch3D, LayoutSlotText } from '../viewParts/layout.js';

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
        new TextViewPart(this, {});
        new TrackSpatial(this, {affects: "text"});
        new TrackText(this);
    }
}

export default function initRoom3(state) {
    let room;

    const island = new Island(state && state.island, () => {
        room = new Room();

        const text1 = new Text({
            spatial: { position: new THREE.Vector3(-3, 1.0, 0) },
            text: { content: "man is much more than a tool builder... he is an inventor of universes.", numLines: 10, width: 3, height: 2 }
        });
        room.parts.objects.add(text1);
    });

    room = room || island.modelsById[state.room];

    return {island, room};
}
