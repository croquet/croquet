import * as THREE from "three";
import SVGIcon from "../util/svgIcon.js";
import lineHandle from "../../assets/line-handle.svg";
import rotateHandle from "../../assets/rotate-handle.svg";
import { PointerEvents, makePointerSensitive } from "./pointer.js";
import { ViewPart } from "../modelView.js";
import Tracking from "./tracking.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

class TranslationManipulator extends ViewPart {
    /** @arg {{target: import('../stateParts/spatial.js').default}} options */
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

        this.moveHandle.position.y -= 0.8;
        this.moveHandle.position.z = 0.2;
        makePointerSensitive(this.moveHandle, this);
        this.group.add(this.moveHandle);

        this.subscribe(PointerEvents.pointerEnter, "onPointerEnter");
        this.subscribe(PointerEvents.pointerLeave, "onPointerLeave");
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");

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
        this.positionAtDragStart = this.group.position.clone();
        this.quaternionAtDragStart = this.group.quaternion.clone();
    }

    onPointerDrag({dragStart, dragEndOnHorizontalPlane}) {
        this.target.future().moveTo(
            this.positionAtDragStart.clone().add(dragEndOnHorizontalPlane.clone().sub(dragStart))
        );
    }
}

class RotationManipulator extends ViewPart {
    /** @arg {{target: import('../stateParts/spatial.js').default}} options */
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

        this.rotateHandle.position.y -= 0.7;
        makePointerSensitive(this.rotateHandle, this);
        this.group.add(this.rotateHandle);

        this.subscribe(PointerEvents.pointerEnter, "onPointerEnter");
        this.subscribe(PointerEvents.pointerLeave, "onPointerLeave");
        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
        this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");

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
        this.positionAtDragStart = this.group.position.clone();
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

export default function WithManipulator(BaseViewPart, manipulatorOptions={}) {
    return class WithManipulatorView extends ViewPart {
        constructor(options) {
            super(options);
            const target = manipulatorOptions.target || (options.model && options.model.parts.spatial);
            this.parts = {
                inner: new BaseViewPart(options),
                translationManipulator: new (Tracking(TranslationManipulator, {scale: false, rotation: false, source: target}))({target}),
                RotationManipulator: new (Tracking(RotationManipulator, {scale: false, source: target}))({target}),
            };
        }
    };
}
