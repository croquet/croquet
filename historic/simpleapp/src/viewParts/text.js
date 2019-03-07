import * as THREE from 'three';
import { TextGeometry, HybridMSDFShader } from '../../../../../three-bmfont-text';
import { TextLayout } from './textlayout.js';
import Object3D from "./object3D.js";
import LazyObject3D from "../util/lazyObject3D.js";
import { ViewPart } from '../view.js';
import { TextEvents } from '../stateParts/text.js';
import { Carota } from './carota/editor.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

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

class FontRegistry {
    constructor() {
        this.fonts = {}; // {name<string>: {font: aTexture}
        this.measurers = {}; // {name<string>: a TextLayout}
    }

    getAtlasFor(font) {
        return new Promise((resolve, _reject) => {
            const texPath = fontPaths[font].atlas;
            if (this.fonts[font]) {
                resolve(this.fonts[font]);
            } else {
                console.log("start loading");
                new THREE.TextureLoader().load(texPath, tex => {
                    this.fonts[font] = tex;
                    this.measurers[font] = new TextLayout({font});
                    console.log("loaded", tex);
                    resolve(tex);
                });
            }
        });
    }

    getTexture(font) {
        return this.fonts[font];
    }
    getMeasurer(font) {
        return this.measurers[font];
    }
}

export const fontRegistry = fontRegistry || new FontRegistry();

let testTextContent = [{x: 0, y: 0, string: "A", style: "black"},
                       {x: 23, y: 0, string: "B", style: "red"},
];


export default class TextViewPart extends Object3D {
    fromOptions(options) {
        options = {content: "Hello", font: "Barlow", width: 5, fontSize: 0.3, anchor: "bottom", ...options};
        this.modelSource = options.modelSource;
        this.options = options;
    }

    attachWithObject3D() {
        return this.initEditor(this.options.numLines);
        /*const promise = this.maybeLoadFont();
        const placeholder = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));

        let lazy = new LazyObject3D(placeholder, promise);
        window.lazy = lazy;
        return lazy;*/
    }

    maybeLoadFont() {
        return fontRegistry.getAtlasFor(this.options.font).then(atlasTexture => {
            return this.initEditor(this.options.numLines);
        });
    }

    updateMaterial() {
        let text = this;
        //let bounds = this.editor.visibleTextBounds(); 
        text.threeObj.material.uniforms.corners.value = new THREE.Vector4(0, 0, 1000, 1000);
    }

    buildGeometry() {
	console.log("buildGeometry");

        const baseFontSize = fontPaths[this.options.font].json.info.size;
        const atlasTexture = fontRegistry.getTexture(this.options.font);

        /*
          const measurer = fontRegistry.getMeasurer(this.options.font);
        const font = fontPaths[this.options.font].json;
        const glyphs = measurer.computeGlyphs({font, drawnStrings: testTextContent});
        */

        const geometry = new TextGeometry({
            font: fontPaths[this.options.font].json,
            width: this.options.width,
            glyphs: [],
            align: null,
            flipY: true
        });

        this.updateGeometry(geometry, testTextContent);

        window.text = this;
        const material = new THREE.RawShaderMaterial(HybridMSDFShader({
            map: atlasTexture,
            side: THREE.DoubleSide,
            transparent: true,
            negate: false
        }));

        const mesh = new THREE.Mesh(geometry, material);
        const scale = this.options.fontSize / baseFontSize;
        mesh.scale.set(scale, -scale, scale);
        return mesh;
    }

    initEditor(numLines) {
        this.editor = new Carota(this.options.width, this.options.height, numLines);

        this.editor.isScrollable = true;  // unless client decides otherwise

        this.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0),  0),
                               new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
                               new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
                               new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)]

        this.editor.mockCallback = ctx => {
            let glyphs = this.processMockContext(ctx);
            this.updateMaterial();
            this.updateGeometry(glyphs, ctx.filledRects);
        };

        const callback = () => this.onTextChange();
        this.editor.setSubscribers(callback);

        this.initSelectionMesh();
        this.initScrollBarMesh();

	let text = this.text = this.buildGeometry();

        const box = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));

        let meterInPixel = this.options.width / this.editor.scaleX;
        text.scale.set(meterInPixel, -meterInPixel, meterInPixel);

        box.add(text);

        this.updateGeometry([], []);
        this.editor.load([]);
        this.newText(this.initialText);

        return box;
    }


    updateGeometry(geometry, drawnStrings) {
        const measurer = fontRegistry.getMeasurer(this.options.font);
        const font = fontPaths[this.options.font].json;
        const glyphs = measurer.computeGlyphs({font: font, drawnStrings: drawnStrings});
        geometry.update({font: fontPaths[this.options.font].json, glyphs});
    }

    update(newOptions) {
        this.options = {...this.options, ...newOptions};
	let text = this.text;
        if (text && text.geometry) this.updateGeometry(text.geometry, testTextContent);
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
