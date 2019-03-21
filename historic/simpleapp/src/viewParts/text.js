import * as THREE from 'three';
import { TextGeometry, HybridMSDFShader } from 'three-bmfont-text';
import LineBreaker from 'linebreak';
import Object3D from "./object3D.js";
import LazyObject3D from "../util/lazyObject3D.js";
import { ViewPart } from '../view.js';
import { TextEvents } from '../stateParts/text.js';
import { fontRegistry } from '../util/fontRegistry.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const DEBUG_GLYPH_GEOMETRY = false;
const DEBUG_SIZEBOX = false;

export default class TextViewPart extends Object3D {
    fromOptions(options) {
        options = {content: "Hello", font: "Barlow", width: 5, height: 2, fontSize: 0.3, anchor: "bottom", ...options};
        this.modelSource = options.modelSource;
        this.options = options;
    }

    attachWithObject3D() {
        const promise = this.build();
        const placeholder = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));

        return new LazyObject3D(placeholder, promise);
    }

    build() {
        return fontRegistry.load(this.options.font).then(({atlas, measurer, info}) => {
            const baseFontSize = info.info.size;
            const scale = this.options.fontSize / baseFontSize;
            const widthInBaseFontSizeMultiples = this.options.width / scale;

            const lineWidth = widthInBaseFontSizeMultiples;
            const lineSpacing = info.common.lineHeight;

            const breaker = new LineBreaker(this.options.content);
            let bk = breaker.nextBreak();
            let lineBeginningIdx = 0;
            let lastWordIdx = 0;
            let currentLineWidth = 0;
            const lines = [];

            while (bk) {
                const word = this.options.content.slice(lastWordIdx, bk.position);
                const spaceWidth = measurer.measureText(" ").width;
                const wordWidth = measurer.measureText(word).width;
                const nextBk = breaker.nextBreak();
                const tooLong = currentLineWidth + wordWidth > lineWidth;

                if (!nextBk || bk.required || tooLong) {
                    if (tooLong) {
                        lines.push(this.options.content.slice(lineBeginningIdx, lastWordIdx));
                        if (!nextBk) {
                            lines.push(this.options.content.slice(lastWordIdx, bk.position));
                        }
                    } else {
                        lines.push(this.options.content.slice(lineBeginningIdx, bk.position));
                    }

                    currentLineWidth = tooLong ? wordWidth : 0;
                    lineBeginningIdx = lastWordIdx;
                } else {
                    currentLineWidth += wordWidth + spaceWidth;
                }

                lastWordIdx = bk.position;
                bk = nextBk;
            }

            const drawnStrings = lines.map((line, i) => ({
                x: 0,
                y: (i + 1) * lineSpacing, // because computeGlyphs will remove 1x letter height
                string: line,
                font: this.options.font,
                style: "black"
            }));

            const geometry = new TextGeometry({
                font: info,
                glyphs: measurer.computeGlyphs({
                    font: info,
                    drawnStrings
                }),
                flipY: true
            });
            const height = lines.length * lineSpacing;

            const material = DEBUG_GLYPH_GEOMETRY
                ? new THREE.MeshBasicMaterial({color: "#00ff00", side: THREE.DoubleSide})
                : new THREE.RawShaderMaterial(HybridMSDFShader({
                    map: atlas,
                    side: THREE.DoubleSide,
                    transparent: true,
                    color: 'rgb(0, 0, 0)',
                    negate: true
                }));
            if (!DEBUG_GLYPH_GEOMETRY) {
                material.uniforms.corners.value = new THREE.Vector4(0, 0, lineWidth, this.options.height / scale);
            }

            const mesh = new THREE.Mesh(geometry, material);
            if (this.options.anchor !== "top") {
                mesh.position.copy(new THREE.Vector3(0, scale * (height / 2), 0));
            }
            mesh.scale.set(scale, -scale, scale);
            const group = new THREE.Group();
            group.add(mesh);

            if (DEBUG_SIZEBOX) {
                const box = new THREE.Mesh(
                    new THREE.PlaneBufferGeometry(this.options.width, this.options.height),
                    new THREE.MeshBasicMaterial({color: "#0000ff", transparent: true, opacity: 0.3}));
                box.position.x += this.options.width / 2;
                if (this.options.anchor === "top") {
                    box.position.y -= this.options.height / 2;
                }
                group.add(box);
            }

            return group;
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
