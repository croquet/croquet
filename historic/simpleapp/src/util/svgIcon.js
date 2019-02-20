import * as THREE from 'three';
import SVGLoader from 'three-svg-loader';
import LazyObject3D from "./lazyObject3D.js";

const svgLoader = new SVGLoader();

export default class SVGIcon extends LazyObject3D {
    constructor(path, material, targetSize=1, horizontal=true, curveSegments=12) {
        const placeholder = new THREE.Mesh(new THREE.PlaneGeometry(targetSize, targetSize), material);

        const promise = new Promise((resolve, reject) => {
            svgLoader.load(path, shapePaths => {
                const geometries = [];

                for (let shapePath of shapePaths) {
                    for (let shape of shapePath.toShapes(true)) {
                        geometries.push(new THREE.ShapeBufferGeometry(shape, curveSegments));
                    }
                }

                const meshes = geometries.map(geo => new THREE.Mesh(geo, this.placeholder.material));
                const group = new THREE.Group();
                group.add(...meshes);
                const bbox = (new THREE.Box3()).setFromObject(group);
                const width = bbox.max.x - bbox.min.x;
                const height = bbox.max.y - bbox.min.y;
                const factorTooBig = Math.max(width, height) / targetSize;
                group.scale.set(1/factorTooBig, 1/factorTooBig, 1/factorTooBig);
                if (horizontal) {
                    group.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI/2);
                    group.position.set(-(width/factorTooBig)/2, 0, (height/factorTooBig)/2);
                } else {
                    group.position.set(-(width/factorTooBig)/2, -(height/factorTooBig)/2, 0);

                }
                resolve(group);
            });
        });

        super(placeholder, promise);
    }
}
