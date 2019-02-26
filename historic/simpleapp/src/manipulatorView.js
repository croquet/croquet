import * as THREE from "three";
import Object3DView from "./object3DView.js";
import SVGIcon from "./util/svgIcon.js";
import lineHandle from "../assets/line-handle.svg";
import rotateHandle from "../assets/rotate-handle.svg";
import { PointerEvents } from "./observer.js";

export default class ManipulatorView extends Object3DView {
    constructor(island, innerView) {
        super(island);
        this.innerView = innerView;
    }

    attachWithObject3D(modelState) {
        this.innerView.attach(modelState);
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
        this.moveHandle.position.z -= 0.2;
        this.moveHandle.userData.croquetView = this;
        this.rotateHandle.position.y -= 0.7;
        this.rotateHandle.userData.croquetView = this;
        this.group.add(this.moveHandle);
        this.group.add(this.rotateHandle);
        this.cursor = "grab";
        this.subscribe(PointerEvents.pointerMove, "onPointerMove");
        this.subscribe(PointerEvents.pointerLeave, "onPointerLeave");
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");
        return this.group;
    }

    detach() {
        this.innerView.detach();
        super.detach();
    }

    addToThreeParent(parent) {
        this.innerView.addToThreeParent(parent);
        super.addToThreeParent(parent);
    }

    removeFromThreeParent(parent) {
        this.innerView.removeFromThreeParent(parent);
        super.removeFromThreeParent(parent);
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
            this.model().spatial.moveTo(this.positionAtDragStart.clone().add(dragEndOnHorizontalPlane.clone().sub(dragStart)));
        } else if (dragStartThreeObj === this.rotateHandle) {
            const delta = (new THREE.Quaternion()).setFromUnitVectors(
                dragStart.clone().sub(this.positionAtDragStart).setY(0).normalize(),
                dragEndOnHorizontalPlane.clone().sub(this.positionAtDragStart).setY(0).normalize(),
            );
            this.model().spatial.rotateTo(this.quaternionAtDragStart.clone().multiply(delta));
        }
    }
}
