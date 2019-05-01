import * as THREE from "three";
import { DIRECTION_LTR } from "yoga-layout-prebuilt";
import SVGIcon from "../util/svgIcon";
import lineHandle from "../../assets/line-handle.svg";
import rotateHandle from "../../assets/rotate-handle.svg";
import { PointerEvents, makePointerSensitive } from "./pointer";
import { ViewPart } from "../parts";
import { Facing } from "./tracking";
import { LayoutContainer, LayoutSlotStretch3D, MinFromBBox, LayoutSlot, MUL, LayoutSlotText, LayoutStack, LayoutSlotCenter3D } from "./layout";
import EditableTextViewPart from "./textView";
import Draggable from "./draggable";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

class TranslationManipulator extends ViewPart {
    /** @arg {{target: import('../modelParts/spatial.js').default}} options */
    constructor(options) {
        super();

        this.target = options.target;
        this.group = new THREE.Group();
        this.moveHandle = new SVGIcon(
            lineHandle,
            new THREE.MeshBasicMaterial({color: "#ffffff"}),
            new THREE.MeshBasicMaterial({color: "#ffffff", polygonOffset: true, polygonOffsetFactor: 0.1, transparent: true, opacity: 0.2}),
            0.5,
            false
        );

        this.moveHandle.position.z = 0.2;
        makePointerSensitive(this.moveHandle, this);
        this.group.add(this.moveHandle);

        this.subscribe(this.id, PointerEvents.pointerEnter, data => this.onPointerEnter(data));
        this.subscribe(this.id, PointerEvents.pointerLeave, data => this.onPointerLeave(data));
        this.subscribe(this.id, PointerEvents.pointerDown, data => this.onPointerDown(data));
        this.subscribe(this.id, PointerEvents.pointerDrag, data => this.onPointerDrag(data));

        this.threeObj = this.group;
    }

    onPointerEnter() {
        this.moveHandle.altMaterial.color = new THREE.Color("#A1DCD4");
        this.moveHandle.altMaterial.opacity = 1;
    }

    onPointerLeave() {
        this.moveHandle.altMaterial.color = new THREE.Color("#ffffff");
        this.moveHandle.altMaterial.opacity = 0.2;
    }

    onPointerDown() {
        this.targetPositionAtDragStart = this.target.position.clone();
        this.quaternionAtDragStart = this.group.quaternion.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane}) {
        this.target.future().moveTo(
            this.targetPositionAtDragStart.clone().add(dragEndOnHorizontalPlane.clone().sub(dragStart))
        );
    }
}

class RotationManipulator extends ViewPart {
    /** @arg {{target: import('../modelParts/spatial.js').default}} options */
    constructor(options) {
        super();
        this.target = options.target;
        this.group = new THREE.Group();
        this.rotateHandle = new SVGIcon(
            rotateHandle,
            new THREE.MeshBasicMaterial({color: "#ffffff"}),
            new THREE.MeshBasicMaterial({color: "#ffffff", polygonOffset: true, polygonOffsetFactor: 0.1, transparent: true, opacity: 0.2}),
            1.5
        );

        makePointerSensitive(this.rotateHandle, this);
        this.group.add(this.rotateHandle);

        this.subscribe(this.id, PointerEvents.pointerEnter, data => this.onPointerEnter(data));
        this.subscribe(this.id, PointerEvents.pointerLeave, data => this.onPointerLeave(data));
        this.subscribe(this.id, PointerEvents.pointerDown, data => this.onPointerDown(data));
        this.subscribe(this.id, PointerEvents.pointerDrag, data => this.onPointerDrag(data));

        this.threeObj = this.group;
    }

    onPointerEnter() {
        this.rotateHandle.altMaterial.color = new THREE.Color("#A1DCD4");
        this.rotateHandle.altMaterial.opacity = 1;
    }

    onPointerLeave() {
        this.rotateHandle.altMaterial.color = new THREE.Color("#ffffff");
        this.rotateHandle.altMaterial.opacity = 0.2;
    }

    onPointerDown() {
        this.positionAtDragStart = this.group.localToWorld(new THREE.Vector3(0, 0, 0));
        this.quaternionAtDragStart = this.group.quaternion.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane}) {
        const delta = (new THREE.Quaternion()).setFromUnitVectors(
            dragStart.clone().sub(this.positionAtDragStart).setY(0).normalize(),
            dragEndOnHorizontalPlane.clone().sub(this.positionAtDragStart).setY(0).normalize(),
        );
        this.target.future().rotateTo(
            this.quaternionAtDragStart.clone().multiply(delta)
        );
    }
}

class FrameBorderPlane extends ViewPart {
    constructor(options={}) {
        super();
        this.threeObj = new THREE.Mesh(
            new THREE.PlaneBufferGeometry(1, 1, 1, 1),
            options.material || new THREE.MeshBasicMaterial({color: "#ffffff"})
        );
    }
}

const FramedViewSlot = MinFromBBox(LayoutSlot);

class FramingLayoutRoot extends LayoutContainer {
    constructor(options) {
        super(options);
        this.framed = options.framed;
        this.framedViewSlot = options.framedViewSlot;
        this.outerGroup = new THREE.Group();
        this.outerGroup.add(this.group);
        this.threeObj = this.outerGroup;
        // cause and propagate first layout calculation
        this.onChildContentChanged();
    }

    onChildContentChanged() {
        this.yogaNode.calculateLayout(undefined, undefined, DIRECTION_LTR);
        this.onLayoutChanged();
    }

    onLayoutChanged() {
        super.onLayoutChanged();

        // center the slot for the framed object on the actual bounding box center in the world
        const bbox = (new THREE.Box3()).setFromObject(this.framed.threeObjs()[0]);
        const worldCenter = bbox.getCenter(new THREE.Vector3());
        const slotCenter = new THREE.Vector3(
            this.framedViewSlot.absoluteLeft() / MUL + this.framedViewSlot.yogaNode.getComputedWidth() / 2 / MUL,
            -this.framedViewSlot.absoluteTop() / MUL - this.framedViewSlot.yogaNode.getComputedHeight() / 2 / MUL,
            0
        );

        const delta = worldCenter.clone().sub(slotCenter);

        this.group.position.copy(delta);
    }
}

const framedViewMargin = 0.2;
const transparentFrameWidth = 0.2;
const solidFrameWidth = 0.05;
const solidFrameMargin = (transparentFrameWidth - solidFrameWidth) / 2;

class Frame extends ViewPart {
    constructor(options) {
        super();
        const framedViewSlot = new FramedViewSlot({
            margin: framedViewMargin,
            inner: options.framed
        });

        const sharedHoverMaterial = new THREE.MeshBasicMaterial({color: "#ffffff", transparent: true, opacity: 0.3});

        const DraggableFrameBorderPlane = Draggable({
            target: options.target,
            hoverMaterialUpdate: (hovered, material) => {
                material.color = new THREE.Color(hovered ? "#A1DCD4" : "#ffffff");
                material.transparent = !hovered;
                material.opacity = hovered ? 1.0 : 0.3;
            }
        })(FrameBorderPlane);

        const makeVerticalBorder = (extraOptions={}) => new LayoutStack({
            minWidth: transparentFrameWidth,
            ...extraOptions,
            children: [
                new LayoutSlotStretch3D({
                    marginTop: solidFrameMargin,
                    marginBottom: solidFrameMargin,
                    inner: new DraggableFrameBorderPlane({material: sharedHoverMaterial})
                }),
                new LayoutSlotStretch3D({
                    maxWidth: solidFrameWidth,
                    marginLeft: solidFrameMargin,
                    marginRight: solidFrameMargin,
                    z: 0.01,
                    inner: new FrameBorderPlane()
                }),
            ]
        });
        const makeHorizontalBorder = (extraOptions={}) => new LayoutStack({
            minHeight: transparentFrameWidth,
            ...extraOptions,
            children: [
                new LayoutSlotStretch3D({
                    inner: new DraggableFrameBorderPlane({material: sharedHoverMaterial})
                }),
                new LayoutSlotStretch3D({
                    maxHeight: solidFrameWidth,
                    margin: solidFrameMargin,
                    z: 0.01,
                    inner: new FrameBorderPlane()
                }),
            ]
        });
        this.parts = {
            layout: new FramingLayoutRoot({
                framed: options.framed,
                framedViewSlot,
                flexDirection: "column",
                children: [
                    new LayoutContainer({
                        flexDirection: "row",
                        alignItems: "flexEnd",
                        children: [
                            makeHorizontalBorder({flexGrow: 1, marginBottom: -solidFrameMargin}),
                            new LayoutSlotText({
                                marginBottom: -0.10,
                                marginLeft: solidFrameMargin,
                                marginRight: solidFrameMargin,
                                inner: new EditableTextViewPart({
                                    editable: false,
                                    content: [{text: options.framed.label || Object.getPrototypeOf(options.framed).constructor.name, style: {color: 0xffffff}}],
                                    fontSize: 0.2,
                                    singleLine: true,
                                    autoResize: true,
                                    showSelection: false,
                                    showScrollBar: false,
                                    hideBackground: true
                                })
                            }),
                            makeHorizontalBorder({flexGrow: 1, marginBottom: -solidFrameMargin}),
                        ]
                    }),
                    new LayoutContainer({
                        flexDirection: "row",
                        children: [
                            makeVerticalBorder({marginRight: -solidFrameMargin}),
                            // framed object lives here in the layout hierarchy
                            framedViewSlot,
                            makeVerticalBorder({marginLeft: -solidFrameMargin}),
                        ]
                    }),
                    makeHorizontalBorder({marginTop: -solidFrameMargin}),
                    new LayoutSlotCenter3D({
                        minHeight: 0.1,
                        inner: new (Facing({source: options.cameraSpatial})(TranslationManipulator))({target: options.target})
                    }),
                    new LayoutSlotCenter3D({
                        minHeight: 0.1,
                        inner: new (Facing({source: options.target})(RotationManipulator))({target: options.target})
                    })
                ]
            })
        };
    }
}

export default function WithManipulator(BaseViewPart, manipulatorOptions={}) {
    return class WithManipulatorView extends ViewPart {
        constructor(options) {
            super(options);
            const target = manipulatorOptions.target || (options.model && options.model.parts.spatial);
            const inner = new BaseViewPart(options);
            this.parts = {
                inner,
                frame: new Frame({cameraSpatial: options.cameraSpatial, framed: inner, target}),
            };
        }
    };
}
