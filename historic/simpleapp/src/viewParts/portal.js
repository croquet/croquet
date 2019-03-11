import * as THREE from 'three';
import Object3D from "./object3D.js";

export default class PortalViewPart extends Object3D {
    fromOptions(options={}) {
        super.fromOptions(options);
        this.targetRoom = options.targetRoom;
        this.positionInTargetRoom = options.positionInTargetRoom;
        this.quaternionInTargetRoom = options.quaternionInTargetRoom;
    }

    attachWithObject3D(modelState) {
        const portalShape = this.attachWithPortalShape(modelState);
        portalShape.layers.disable(0);
        portalShape.layers.enable(1);
        return portalShape;
    }

    /** @abstract */
    attachWithPortalShape(_modelState) {
        return new THREE.Mesh(
            new THREE.PlaneGeometry(1.5, 2.5, 1, 1).translate(0, 1.25, 0),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#00ffff")})
        );
    }
}
