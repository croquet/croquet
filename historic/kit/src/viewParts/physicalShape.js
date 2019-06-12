import * as THREE from 'three';
import { SHAPE_BOX, SHAPE_SPHERE } from "oimo";
import { ViewPart } from '../parts';

export default class PhysicalShape extends ViewPart {
    constructor(options) {
        super(options);

        const type = options.model.parts.spatial.body.shapes.type;

        this.threeObj = new THREE.Mesh(
            type === SHAPE_SPHERE
                ? new THREE.SphereBufferGeometry(1, 20, 20)
                : (type === SHAPE_BOX
                    ? new THREE.BoxBufferGeometry(1, 1, 1)
                    : new THREE.CylinderBufferGeometry(1, 1, 1, 70)),
            options.material || new THREE.MeshStandardMaterial({color: "#888888", metalness: 0.2, roughness: 0.8})
        );
    }
}
