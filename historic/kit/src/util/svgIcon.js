import * as THREE from "three";
import 'array-flat-polyfill';
import SVGLoader from "three-svg-loader";
import LazyObject3D from "./lazyObject3D";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const svgLoader = new SVGLoader();
const svgCache = {};

export default class SVGIcon extends LazyObject3D {
    constructor(filePath, material, altMaterial=material, targetSize=1, horizontal=true, curveSegments=12, altColor=new THREE.Color(0, 0, 1)) {
        const placeholder = new THREE.Mesh(new THREE.PlaneGeometry(targetSize, targetSize), material);
        if (horizontal) {
            placeholder.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI/2);
        }

        const promise = new Promise((resolve, reject) => {
            const assembleMesh = (geometry, altGeometry) => {
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
                resolve(group);
            };

            if (!svgCache[filePath]) {
                svgLoader.load(
                    filePath,
                    shapePaths => {
                        if (!shapePaths.length) reject(Error("Empty SVG: " + filePath));
                        const geometry = new THREE.ExtrudeBufferGeometry(
                            shapePaths.filter(sP => !sP.color.equals(altColor)).flatMap(shapePath => shapePath.toShapes(true).map(shapes => shapes)),
                            { curveSegments, depth: 0.1, bevelEnabled: false }
                        ).center();
                        const altGeometry = new THREE.ExtrudeBufferGeometry(
                            shapePaths.filter(sP => sP.color.equals(altColor)).flatMap(shapePath => shapePath.toShapes(true).map(shapes => shapes)),
                            { curveSegments, depth: 0.1, bevelEnabled: false }
                        ).center();
                        svgCache[filePath] = {geometry, altGeometry};
                        assembleMesh(geometry, altGeometry);
                    },
                    null,
                    reject
                );
            } else {
                const {geometry, altGeometry} = svgCache[filePath];
                assembleMesh(geometry, altGeometry);
            }
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
