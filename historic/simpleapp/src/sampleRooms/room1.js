import * as THREE from 'three';
import Island from '../island.js';
import Room from "../room/roomModel.js";
import SpatialPart from '../stateParts/spatial.js';
import Inertial from '../stateParts/inertial.js';
import { StatePart, ViewPart } from '../modelView.js';
import Tracking from '../viewParts/tracking.js';
import { TextObject } from '../objects/text.js';
import { LayoutRoot, LayoutContainer, LayoutSlotStretch3D, LayoutSlotText, MinFromBBox } from '../viewParts/layout.js';
import TextViewPart from '../viewParts/text.js';
import { WarotaEditorObject } from '../objects/editableText.js';
import Draggable from '../viewParts/draggable.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/** @returns {typeof SpatialPart} */
function AutoRotating() {
    return SpatialPartClass => class extends SpatialPartClass {
        onInitialized(wasFirstInit) {
            super.onInitialized(wasFirstInit);
            if (wasFirstInit) {
                // kick off rotation only (!) if created from scratch
                // otherwise, future message is still scheduled
                this.doRotation();
            }
        }

        doRotation() {
            this.rotateBy((new THREE.Quaternion()).setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.01));
            this.future(1000/60).doRotation();
        }
    };
}

/** Model for a rotating Box */
export class RotatingBox extends StatePart {
    constructor() {
        super();
        this.parts = {
            spatial: new (AutoRotating()(Inertial()(SpatialPart)))()
        };
    }

    naturalViewClass() { return BoxView; }
}

/** View for a Box */
class BoxViewPart extends ViewPart {
    constructor(options) {
        options = {color: "#aaaaaa", ...options};
        super(options);
        this.threeObj = new THREE.Mesh(
            new THREE.BoxBufferGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({color: new THREE.Color(options.color)})
        );
    }
}

export const BoxView = Draggable()(Tracking()(BoxViewPart));

export class LayoutTestModel extends StatePart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart()
        };
    }

    naturalViewClass() {
        return LayoutTestView;
    }
}

class LayoutTestView extends ViewPart {
    constructor(options) {
        super(options);
        this.parts = {
            layout: new (Tracking()(LayoutRoot))({model: options.model, children: [
                new LayoutContainer({
                    flexDirection: "row",
                    alignItems: "stretch",
                    // padding: 0.3,
                    children: [
                        new (MinFromBBox(LayoutSlotStretch3D))({
                            margin: 0.1,
                            inner: new BoxViewPart({color: "#dd8888"}),
                        }),
                        new (MinFromBBox(LayoutSlotStretch3D))({
                            margin: 0.1,
                            inner: new BoxViewPart({color: "#88dd88"})
                        }),
                        new LayoutSlotText({
                            margin: 0.1,
                            aspectRatio: 1,
                            inner: new TextViewPart({fontSize: 0.25, content: `This is an example of text in a dynamic layout: "Our first design for multiple inheritance presumed that a state variable such as ohms had a meaning independent of the individual perspectives. Hence, it was sensible for it to be owned by the node itself. All perspectives would reference this single variable when referring to resistance. This proved adequate so long as the system designer knew all of the perspectives that might be associated with a given node, and could ensure this uniformity of intended reference."`})
                        }),
                        new LayoutContainer({
                            flexDirection: "column",
                            // padding: 0.1,
                            children: [
                                new (MinFromBBox(LayoutSlotStretch3D))({
                                    margin: 0.1,
                                    inner: new BoxViewPart({color: "#dddd88"})
                                }),
                                new (MinFromBBox(LayoutSlotStretch3D))({
                                    margin: 0.1,
                                    inner: new BoxViewPart({color: "#88dddd"})
                                }),
                                new (MinFromBBox(LayoutSlotStretch3D))({
                                    margin: 0.1,
                                    inner: new BoxViewPart({color: "#dd88dd"})
                                }),
                            ]
                        })
                    ]
                })
            ]})
        };
    }
}

function initRoom1(state) {
    return new Island(state, island => {
        const room = new Room().init({});
        island.set("room", room);

        const rotatingBox = new RotatingBox().init({ spatial: { position: {x: 1.5, y: 1, z: 0} } });
        room.parts.objects.add(rotatingBox);

        const text1 = new TextObject().init({
            spatial: { position: new THREE.Vector3(-3.5, 0.7, -1) },
            text: { content: "Man is much more than a tool builder... he is an inventor of universes." }
        });
        room.parts.objects.add(text1);

        const text2 = new TextObject().init({
            spatial: { position: new THREE.Vector3(4, 1.0, -2) },
            text: { content: "Chapter Eight - The Queen's Croquet Ground", font: "Lora" },
        });
        room.parts.objects.add(text2);

        const editText = new WarotaEditorObject().init({
            spatial: { position: {x: -4, y: 2, z: -1.5} },
            text: { content: {
                content: [{text: "This text can be edited"}],
                    selections: {},
                    timezone: 0,
                    queue: []
            },
            font: "Roboto", numLines: 10, width: 3, height: 2}
        });
        room.parts.objects.add(editText);

        const layoutTest = new LayoutTestModel().init({
            spatial: { position: {x: 0, y: 1, z: -3 } },
        });
        room.parts.objects.add(layoutTest);
    });
}

export default {
    moduleID: module.id,
    creatorFn: initRoom1,
};
