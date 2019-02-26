import * as THREE from 'three';
import createGeometry from 'three-bmfont-text';
import Shader from 'three-bmfont-text/shaders/msdf.js';
import LazyObject3D from '../util/lazyObject3D.js';

const fontPaths = {
    /* eslint-disable global-require */
    Barlow: {
        json: require('../../assets/fonts/Barlow-Medium-msdf.json'),
        atlas: require('../../assets/fonts/Barlow-Medium.png')
    },
    Lora: {
        json: require('../../assets/fonts/Lora-Regular-msdf.json'),
        atlas: require('../../assets/fonts/Lora-Regular.png')
    },
};

const texCache = {};

export class TextMesh extends LazyObject3D {
    constructor(text, fontName, options) {
        const build = atlasTexture => {
            const geometry = createGeometry({ font: fontPaths[fontName].json, ...options, flipY: true });
            geometry.update(text);
                // geometry.center();
            const material = new THREE.RawShaderMaterial(Shader({
                map: atlasTexture,
                side: THREE.DoubleSide,
                transparent: true,
                color: 'rgb(0, 0, 0)',
                negate: false
            }));

            const mesh = new THREE.Mesh(geometry, material);
            mesh.scale.set(-0.01, -0.01, 0.01);
            return mesh;
        }

        const promise = new Promise((resolve, _reject) => {
            const texPath = fontPaths[fontName].atlas;
            if (texCache[texPath]) resolve(build(texCache[texPath]));
            else new THREE.TextureLoader().load(texPath, tex => resolve(build(texCache[texPath] = tex)));
        });

        const placeholder = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));

        super(placeholder, promise);
    }
}
