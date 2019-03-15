import * as THREE from 'three';
import Object3D from "../viewParts/object3D.js";
import { SpatialEvents } from '../stateParts/spatial.js';
import { SizeEvents } from '../stateParts/size.js';
import View from '../view.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class PortalView extends View {
    buildParts() {
        new PortalViewPart(this);
    }
}

export class PortalViewPart extends Object3D {
    fromOptions(options={}) {
        super.fromOptions(options);
        this.source = options.source || "model.portal";
    }

    attachWithObject3D(modelState) {
        const portalShape = this.attachWithPortalShape(modelState);
        portalShape.layers.disable(0);
        portalShape.layers.enable(1);
        return portalShape;
    }

    /** @abstract */
    attachWithPortalShape(modelState) {
        const [contextName, partId] = this.source.split(".");
        const context = contextName === "model" ? modelState : this.owner;
        this.portalPart = context.parts[partId];
        const hereSpatialPart = context.parts[this.portalPart.hereSpatialPartId];
        const sizePart = context.parts[this.portalPart.sizePartId];
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#00ffff")})
        );

        // TODO: actually use something like internal "TrackSpatial" and "TrackSize" parts here
        mesh.position.copy(hereSpatialPart.position);
        mesh.quaternion.copy(hereSpatialPart.quaternion);
        mesh.scale.copy(sizePart.value);

        this.subscribe(SpatialEvents.moved, "onMoved", context.id, this.portalPart.hereSpatialPartId);
        this.subscribe(SpatialEvents.rotated, "onRotated", context.id, this.portalPart.hereSpatialPartId);
        this.subscribe(SizeEvents.changed, "onResized", context.id, this.portalPart.sizePartId);

        return mesh;
    }

    onMoved(newPosition) {
        this.threeObj.position.copy(newPosition);
    }

    onRotated(newQuaternion) {
        this.threeObj.quaternion.copy(newQuaternion);
    }

    onResized(newSize) {
        this.threeObj.scale.copy(newSize);
    }
}
