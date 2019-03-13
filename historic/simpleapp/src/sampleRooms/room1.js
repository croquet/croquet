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
import TextViewPart from '../viewParts/text.js';
import Object3D, { Object3DGroup } from '../viewParts/object3D.js';
import DraggableViewPart from '../viewParts/draggable.js';
import TrackSpatial from '../viewParts/trackSpatial.js';
import { LayoutRoot, LayoutContainer, LayoutSlotStretch3D, LayoutSlotText } from '../viewParts/layout.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** Model for a Bouncing Box */
export class BouncingBox extends Model {
    buildParts(state) {
        new BouncingSpatialPart(this, state);
    }

    naturalViewClass() { return BoxView; }
}

class AutoRotate extends StatePart {
    constructor(owner, state, options) {
        options = {target: "spatial", ...options};
        super(owner, options);
        /** @type {SpatialPart} */
        this.spatialPart = owner.parts[options.target];
        // kick off rotation only (!) if created from scratch
        if (!state[this.partId]) this.doRotation();
        // otherwise, future message is still scheduled
    }

    doRotation() {
        this.spatialPart.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
        this.future(1000/60).doRotation();
    }
}

/** Model for a rotating Box */
export class RotatingBox extends Model {
    buildParts(state) {
        new InertialSpatialPart(this, state);
        new AutoRotate(this, state);
    }

    naturalViewClass() { return BoxView; }
}

/** Model for a simple text display */
export class Text extends Model {
    buildParts(state) {
        new TextPart(this, state);
        new SpatialPart(this, state);
    }

    naturalViewClass() { return TextView; }
}

/** View for a Box */
class BoxViewPart extends Object3D {
    fromOptions(options) {
        options = {color: "#aaaaaa", ...options};
        super.fromOptions(options);
        this.color = options.color;
    }

    attachWithObject3D(_modelState) {
        return new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color(this.color)})
        );
    }
}

class BoxView extends View {
    buildParts() {
        new BoxViewPart(this);
        new TrackSpatial(this, {affects: "box"});
        new DraggableViewPart(this, {dragHandle: "box"});
    }
}

/** View for rendering a Text */
class TextView extends View {
    buildParts() {
        new TextViewPart(this, {fontSize: 0.4});
        new TrackSpatial(this, {affects: "text"});
    }
}

export class LayoutTestModel extends Model {
    buildParts(state) {
        new SpatialPart(this, state);
    }

    naturalViewClass() {
        return LayoutTestView;
    }
}

class LayoutTestView extends View {
    buildParts() {
        new BoxViewPart(this, {id: "box1", color: "#dd8888"});
        new BoxViewPart(this, {id: "box2", color: "#dddd88"});
        new BoxViewPart(this, {id: "box3", color: "#88dd88"});
        new TextViewPart(this, {id: "text1", fontSize: 0.19, content: `Our first design for multiple inheritance presumed that a state variable such as ohms had a meaning independent of the individual perspectives. Hence, it was sensible for it to be owned by the node itself. All perspectives would reference this single variable when referring to resistance. This proved adequate so long as the system designer knew all of the perspectives that might be associated with a given node, and could ensure this uniformity of intended reference.`});
        new BoxViewPart(this, {id: "box4", color: "#88dddd"});
        new BoxViewPart(this, {id: "box5", color: "#8888dd"});

        new Object3DGroup(this);
        new TrackSpatial(this);

        new LayoutRoot(this, {children: [
            new LayoutContainer(this, {
                id: "row",
                flexDirection: "row",
                alignItems: "stretch",
                // padding: 0.3,
                children: [
                    new LayoutSlotStretch3D(this, {id: "box1layout", affects: "box1", margin: 0.1}),
                    new LayoutSlotStretch3D(this, {id: "box2layout", affects: "box2", margin: 0.1}),
                    new LayoutSlotText(this, {id: "text1layout", affects: "text1", margin: 0.1, aspectRatio: 1}),
                    new LayoutContainer(this, {
                        id: "columnInRow",
                        flexDirection: "column",
                        // padding: 0.1,
                        children: [
                            new LayoutSlotStretch3D(this, {id: "box3layout", affects: "box3", margin: 0.1}),
                            new LayoutSlotStretch3D(this, {id: "box4layout", affects: "box4", margin: 0.1}),
                            new LayoutSlotStretch3D(this, {id: "box5layout", affects: "box5", margin: 0.1}),
                        ]
                    })
                ]
            })
        ]});
    }
}

export default function initRoom1(state) {
    let room;

    const island = new Island(state && state.island, () => {
        room = new Room();

        const box = new BouncingBox({ spatial: { position: new THREE.Vector3(0, 1.0, 0) } });
        room.parts.objects.add(box);

        const rotatingBox = new RotatingBox({ spatial: { position: new THREE.Vector3(3, 1.0, 0) } });
        room.parts.objects.add(rotatingBox);

        const text1 = new Text({
            spatial: { position: new THREE.Vector3(-3, 1.0, 0) },
            text: { content: "man is much more than a tool builder... he is an inventor of universes." }
        });
        room.parts.objects.add(text1);

        const text2 = new Text({
            spatial: { position: new THREE.Vector3(5, 1.0, 0) },
            text: { content: "Chapter Eight - The Queen's Croquet Ground", font: "Lora" },
        });
        room.parts.objects.add(text2);

        const layoutTest = new LayoutTestModel({
            spatial: { position: new THREE.Vector3(0, 1.0, 1.0)}
        });
        room.parts.objects.add(layoutTest);
    });

    room = room || island.modelsById[state.room];

    return {island, room};
}
