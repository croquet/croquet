import * as THREE from "three";
import SVGIcon from "./util/svgIcon.js";
import lineHandle from "../assets/line-handle.svg";
import rotateHandle from "../assets/rotate-handle.svg";
import { PointerEvents, makePointerSensitive } from "./viewParts/pointer.js";
import Object3D from "./viewParts/object3D.js";
import View, { ViewPart } from "./view.js";
import TrackSpatial from "./viewParts/trackSpatial.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

class WrappedViewViewPart extends ViewPart {
    /** @param {import('./view').default} wrappedView */
    constructor(owner, options) {
        super(owner, options);
        this.wrapped = options.wrappedView;
    }

    attach(modelState) {
        this.wrapped.attach(modelState);
    }

    detach() {
        this.wrapped.detach();
    }

    addToThreeParent(parent) {
        if (this.wrapped.addToThreeParent) this.wrapped.addToThreeParent(parent);
    }

    removeFromThreeParent(parent) {
        if (this.wrapped.removeFromThreeParent) this.wrapped.removeFromThreeParent(parent);
    }
}

class ManipulatorViewPart extends Object3D {
    constructor(owner, options) {
        options = {target: "spatial", ...options};
        super(owner, options);
        this.targetPartName = options.target;
    }

    attachWithObject3D(_modelState) {
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
        makePointerSensitive(this.moveHandle, this.asViewPartRef());
        this.rotateHandle.position.y -= 0.7;
        makePointerSensitive(this.rotateHandle, this.asViewPartRef());
        this.group.add(this.moveHandle);
        this.group.add(this.rotateHandle);

        this.subscribe(PointerEvents.pointerMove, "onPointerMove");
        this.subscribe(PointerEvents.pointerLeave, "onPointerLeave");
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");

        return this.group;
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
        this.positionAtDragStart = this.threeObj.position.clone();
        this.quaternionAtDragStart = this.threeObj.quaternion.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane, dragStartThreeObj}) {
        if (dragStartThreeObj === this.moveHandle) {
            this.owner.model()[this.targetPartName].moveTo(
                this.positionAtDragStart.clone().add(dragEndOnHorizontalPlane.clone().sub(dragStart))
            );
        } else if (dragStartThreeObj === this.rotateHandle) {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragStart.clone().sub(this.positionAtDragStart).setY(0).normalize(),
                dragEndOnHorizontalPlane.clone().sub(this.positionAtDragStart).setY(0).normalize(),
            );
            this.owner.model()[this.targetPartName].rotateTo(
                this.quaternionAtDragStart.clone().multiply(delta)
            );
        }
    }
}

export default class ManipulatorView extends View {
    buildParts({wrappedView}) {
        new WrappedViewViewPart(this, {wrappedView});
        new ManipulatorViewPart(this);
        new TrackSpatial(this, {affects: "manipulator"});
    }
}
