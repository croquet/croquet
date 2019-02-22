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

export class TextMesh extends LazyObject3D {
    constructor(text, fontName, options) {
        const promise = new Promise((resolve, _reject) => {
            // loadFont(fontPaths[fontName].json, (err, font) => {
                // if (err) reject(err);
                const geometry = createGeometry({ font: fontPaths[fontName].json, ...options, flipY: true });
                geometry.update(text);
                // geometry.center();

                const textureLoader = new THREE.TextureLoader();
                textureLoader.load(fontPaths[fontName].atlas, atlasTexture => {
                    const material = new THREE.RawShaderMaterial(Shader({
                        map: atlasTexture,
                        side: THREE.DoubleSide,
                        transparent: true,
                        color: 'rgb(0, 0, 0)',
                        negate: false
                    }));

                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.scale.set(-0.01, -0.01, 0.01);
                    resolve(mesh);
                });
            // })
        });

        const placeholder = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));

        super(placeholder, promise);
    }
}
