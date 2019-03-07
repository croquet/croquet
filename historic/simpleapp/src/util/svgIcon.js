import * as THREE from 'three';
import 'array-flat-polyfill';
import SVGLoader from 'three-svg-loader';
import LazyObject3D from "./lazyObject3D.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const svgLoader = new SVGLoader();
const svgCache = {};

export default class SVGIcon extends LazyObject3D {
    constructor(path, material, altMaterial=material, targetSize=1, horizontal=true, curveSegments=12, altColor=new THREE.Color(0, 0, 1)) {
        const placeholder = new THREE.Mesh(new THREE.PlaneGeometry(targetSize, targetSize), material);
        if (horizontal) {
            placeholder.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI/2);
        }

        const promise = new Promise((resolve, reject) => {
            const build = shapePaths => {
                const geometry = new THREE.ExtrudeBufferGeometry(
                    shapePaths.filter(sP => !sP.color.equals(altColor)).flatMap(shapePath => shapePath.toShapes(true).map(shapes => shapes)),
                    { curveSegments, depth: 0.1, bevelEnabled: false }
                );

                const altGeometry = new THREE.ExtrudeBufferGeometry(
                    shapePaths.filter(sP => sP.color.equals(altColor)).flatMap(shapePath => shapePath.toShapes(true).map(shapes => shapes)),
                    { curveSegments, depth: 0.1, bevelEnabled: false }
                );

                geometry.center();
                altGeometry.center();

                const group = new THREE.Group();

                const mesh = new THREE.Mesh(geometry, placeholder.material);
                const altMesh = new THREE.Mesh(altGeometry, altMaterial);
                const bbox = (new THREE.Box3()).setFromObject(mesh);
                const width = bbox.max.x - bbox.min.x;
                const height = bbox.max.y - bbox.min.y;
                const factorTooBig = Math.max(width, height) / targetSize;
                group.add(mesh);
                group.add(altMesh);

                group.scale.set(1 / factorTooBig, 1 / factorTooBig, 1 / factorTooBig);
                if (horizontal) {
                    group.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
                }
                return group;
            };


            if (svgCache[path]) resolve(build(svgCache[path]));
            else svgLoader.load(path,
                /* onLoad */ shapePaths => resolve(build(svgCache[path] = shapePaths)),
                /* onProgress */ null,
                /* onError    */ reject);
        });

        super(placeholder, promise);
    }

    get material() {
        return this.children[0].children[0].material;
    }

    get altMaterial() {
        return this.children[0].children[1].material;
    }
}
