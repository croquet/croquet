import * as THREE from 'three';
import createGeometry from 'three-bmfont-text';
import Shader from 'three-bmfont-text/shaders/msdf.js';
import Object3D from "./object3D.js";
import LazyObject3D from "../util/lazyObject3D.js";
import { ViewPart } from '../view.js';
import { TextEvents } from '../modelParts/text.js';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

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

const texCache = {
    getAtlasFor(font) {
        return new Promise((resolve, _reject) => {
            const texPath = fontPaths[font].atlas;
            if (this[texPath]) {
                resolve(this[texPath]);
            } else {
                new THREE.TextureLoader().load(texPath, tex => {
                    this[texPath] = tex;
                    resolve(tex);
                });
            }
        });
    }
};

export default class TextViewPart extends Object3D {
    fromOptions(options) {
        options = {content: "Hello", font: "Barlow", width: 5, fontSize: 0.3, anchor: "bottom", ...options};
        this.modelSource = options.modelSource;
        this.options = options;
    }

    attachWithObject3D() {
        const promise = this.build();
        const placeholder = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));

        return new LazyObject3D(placeholder, promise);
    }

    build() {
        const baseFontSize = fontPaths[this.options.font].json.info.size;
        const widthInBaseFontSizeMultiples = (this.options.width / this.options.fontSize) * baseFontSize;

        const geometry = createGeometry({
            font: fontPaths[this.options.font].json,
            width: widthInBaseFontSizeMultiples,
            text: this.options.content,
            align: this.options.textAlign,
            flipY: true
        });

        if (this.options.anchor === "top") {
            geometry.computeBoundingBox();
            geometry.translate(0, geometry.boundingBox.max.y - geometry.boundingBox.min.y, 0);
        }

        return texCache.getAtlasFor(this.options.font).then(atlasTexture => {
            const material = new THREE.RawShaderMaterial(Shader({
                map: atlasTexture,
                side: THREE.DoubleSide,
                transparent: true,
                color: 'rgb(0, 0, 0)',
                negate: false
            }));

            const mesh = new THREE.Mesh(geometry, material);
            const scale = this.options.fontSize / baseFontSize;
            mesh.scale.set(scale, -scale, scale);
            return mesh;
        });
    }

    rebuild() {
        this.threeObj.replace(this.build());
    }

    update(newOptions) {
        this.options = {...this.options, ...newOptions};
        this.rebuild();
    }
}

export class TrackText extends ViewPart {
    fromOptions(options) {
        options = {modelSource: "text", affects: "text", ...options};
        this.modelSource = options.modelSource;
        /** @type {TextViewPart} */
        this.targetViewPart = this.owner.parts[options.affects];
    }

    attach(modelState) {
        const modelPart = modelState.parts[this.modelSource];
        this.targetViewPart.update({content: modelPart.content, font: modelPart.font});
        this.subscribe(TextEvents.contentChanged, "onContentChanged", modelState.id, this.modelSource);
        this.subscribe(TextEvents.fontChanged, "onFontChanged", modelState.id, this.modelSource);
    }

    onContentChanged(newContent) {
        this.targetViewPart.update({content: newContent});
    }

    onFontChanged(newFont) {
        this.targetViewPart.update({font: newFont});
    }
}
