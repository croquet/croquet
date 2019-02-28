import * as THREE from 'three';
import createGeometry from 'three-bmfont-text';
import Shader from 'three-bmfont-text/shaders/msdf.js';
import Object3DViewPart from "./object3D.js";
import LazyObject3D from "../util/lazyObject3D.js";

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

export default class TextViewPart extends Object3DViewPart {
    constructor(owner, options) {
        options = {partName: "text", modelPartName: "text", width: 500, ...options};
        super(owner, options);
        this.modelPartName = options.modelPartName;
        this.options = options;
    }

    attachWithObject3D(modelState) {
        /** @type {import('../modelParts/text').default} */
        const modelPart = modelState[this.modelPartName];

        const build = atlasTexture => {
            const geometry = createGeometry({
                font: fontPaths[modelPart.font].json,
                ...this.options,
                flipY: true
            });
            geometry.update(modelPart.content);

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
        };

        const promise = new Promise((resolve, _reject) => {
            const texPath = fontPaths[modelPart.font].atlas;
            if (texCache[texPath]) resolve(build(texCache[texPath]));
            else new THREE.TextureLoader().load(texPath, tex => resolve(build(texCache[texPath] = tex)));
        });

        const placeholder = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));

        return new LazyObject3D(placeholder, promise);
    }
}
