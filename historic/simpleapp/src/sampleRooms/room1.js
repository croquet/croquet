import * as THREE from "three";
import Island from "../island";
import Room from "../room/roomModel";
import SpatialPart from "../stateParts/spatial";
import Inertial from "../stateParts/inertial";
import { StatePart, ViewPart } from "../modelView";
import Tracking from "../viewParts/tracking";
import { LayoutRoot, LayoutContainer, LayoutSlotStretch3D, LayoutSlotText, MinFromBBox } from "../viewParts/layout";
import TextElement from "../elements/textElement";
import EditableTextViewPart from "../viewParts/textView";
import Draggable from "../viewParts/draggable";

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

/** Element for a rotating Box */
export class RotatingBoxElement extends StatePart {
    constructor() {
        super();
        this.parts = {
            spatial: new (AutoRotating()(Inertial()(SpatialPart)))()
        };
    }

    naturalViewClass() { return BoxElementView; }
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

export const BoxElementView = Draggable()(Tracking()(BoxViewPart));

export class LayoutTestElement extends StatePart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart()
        };
    }

    naturalViewClass() {
        return LayoutTestElementView;
    }
}

class LayoutTestElementView extends ViewPart {
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
                            inner: new EditableTextViewPart({
                                content: [
                                    {text: `This is an example of text in a dynamic layout: "Our first design for multiple inheritance presumed that a state variable such as ohms had a meaning independent of the individual perspectives. Hence, it was sensible for it to be owned by the node itself. All perspectives would reference this single variable when referring to resistance. This proved adequate so long as the system designer knew all of the perspectives that might be associated with a given node, and could ensure this uniformity of intended reference."`}
                                ],
                                editable: false,
                                fontSize: 0.25,
                                showScrollBar: false,
                                hideBackground: true
                            })
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

        const rotatingBox = new RotatingBoxElement().init({ spatial: { position: {x: 1.5, y: 1, z: 0} } });
        room.parts.objects.add(rotatingBox);

        const text1 = new TextElement().init({
            spatial: { position: new THREE.Vector3(-2, 0.7, -1.5) },
            text: { content: {runs: [{text: "Man is much more than a tool builder... he is an inventor of universes."}]} },
            editable: false,
        });
        room.parts.objects.add(text1);

        const text2 = new TextElement().init({
            spatial: { position: new THREE.Vector3(4, 1.0, -2) },
            text: { content: {runs: [{text: "Chapter Eight - The Queen's Croquet Ground"}]} },
            editable: false,
            visualOptions: {font: "Lora", fontSize: 0.5, width: 5, height: 2}
        });
        room.parts.objects.add(text2);

        const editText = new TextElement().init({
            spatial: { position: {x: -5, y: 2, z: -1.5} },
            text: {
                content: {
                    runs: [{text: "This text can be edited"}],
                },
            },
            editable: true,
            visualOptions: {font: "Roboto", numLines: 10, width: 3, height: 2}
        });
        room.parts.objects.add(editText);

        const layoutTest = new LayoutTestElement().init({
            spatial: { position: {x: 0, y: 1, z: -3 } },
        });
        room.parts.objects.add(layoutTest);
    });
}

export default {
    moduleID: module.id,
    creatorFn: initRoom1,
};
