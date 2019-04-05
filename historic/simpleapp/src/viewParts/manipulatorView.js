import * as THREE from "three";
import SVGIcon from "../util/svgIcon.js";
import lineHandle from "../../assets/line-handle.svg";
import rotateHandle from "../../assets/rotate-handle.svg";
import { PointerEvents, makePointerSensitive } from "./pointer.js";
import { ViewPart } from "../modelView.js";
import Tracking from "./tracking.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

class ManipulatorViewPart extends ViewPart {
    constructor(model, options) {
        options = {target: "spatial", ...options};
        super(model, options);

        this.target = options.target;
        this.group = new THREE.Group();
        this.moveHandle = new SVGIcon(
            lineHandle,
            new THREE.MeshBasicMaterial({color: "#ffffff"}),
            new THREE.MeshBasicMaterial({color: "#ffffff", polygonOffset: true, polygonOffsetFactor: 0.1, transparent: true, opacity: 0.2}),
            0.5,
            false
        );
        this.rotateHandle = new SVGIcon(
            rotateHandle,
            new THREE.MeshBasicMaterial({color: "#ffffff"}),
            new THREE.MeshBasicMaterial({color: "#ffffff", polygonOffset: true, polygonOffsetFactor: 0.1, transparent: true, opacity: 0.2}),
            1.5
        );
        this.moveHandle.position.y -= 0.8;
        this.moveHandle.position.z = 0.2;
        makePointerSensitive(this.moveHandle, this);
        this.rotateHandle.position.y -= 0.7;
        makePointerSensitive(this.rotateHandle, this);
        this.group.add(this.moveHandle);
        this.group.add(this.rotateHandle);

        this.subscribe(PointerEvents.pointerMove, "onPointerMove");
        this.subscribe(PointerEvents.pointerLeave, "onPointerLeave");
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");

        this.threeObj = this.group;
    }

    onPointerMove({hoverThreeObj}) {
        if (hoverThreeObj === this.moveHandle) {
            this.moveHandle.altMaterial.color = new THREE.Color("#A1DCD4");
            this.moveHandle.altMaterial.opacity = 1;
            this.rotateHandle.altMaterial.color = new THREE.Color("#ffffff");
            this.rotateHandle.altMaterial.opacity = 0.2;
        } else {
            this.rotateHandle.altMaterial.color = new THREE.Color("#A1DCD4");
            this.rotateHandle.altMaterial.opacity = 1;
            this.moveHandle.altMaterial.color = new THREE.Color("#ffffff");
            this.moveHandle.altMaterial.opacity = 0.2;
        }
    }

    onPointerLeave() {
        this.moveHandle.altMaterial.color = new THREE.Color("#ffffff");
        this.moveHandle.altMaterial.opacity = 0.2;
        this.rotateHandle.altMaterial.color = new THREE.Color("#ffffff");
        this.rotateHandle.altMaterial.opacity = 0.2;
    }

    onPointerDown() {
        this.positionAtDragStart = this.group.position.clone();
        this.quaternionAtDragStart = this.group.quaternion.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane, dragStartThreeObj}) {
        if (dragStartThreeObj === this.moveHandle) {
            this.modelPart(this.target).moveTo(
                this.positionAtDragStart.clone().add(dragEndOnHorizontalPlane.clone().sub(dragStart))
            );
        } else if (dragStartThreeObj === this.rotateHandle) {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragStart.clone().sub(this.positionAtDragStart).setY(0).normalize(),
                dragEndOnHorizontalPlane.clone().sub(this.positionAtDragStart).setY(0).normalize(),
            );
            this.modelPart(this.target).rotateTo(
                this.quaternionAtDragStart.clone().multiply(delta)
            );
        }
    }
}

export default function WithManipulator(BaseViewPart) {
    return class WithManipulatorView extends ViewPart {
        constructor(model, options) {
            super(model, {});
            this.parts = {
                inner: new BaseViewPart(model, options),
                manipulator: new (Tracking(ManipulatorViewPart, {scale: false}))(model, {})
            };
        }
    };
}
