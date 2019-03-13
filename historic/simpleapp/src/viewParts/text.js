import * as THREE from 'three';
import { TextGeometry, HybridMSDFShader } from 'three-bmfont-text';
import Object3D from "./object3D.js";
//import LazyObject3D from "../util/lazyObject3D.js";
import { ViewPart } from '../view.js';
import { TextEvents } from '../stateParts/text.js';
import { PointerEvents, makePointerSensitive } from "./pointer.js";
import { fontRegistry } from './fontRegistry.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class TextViewPart extends Object3D {
    fromOptions(options) {
        options = {content: "Hello", font: "Roboto", width: 3, height: 2, numLines: 10, pixelWidth: 300, anchor: "bottom", ...options};
        this.modelSource = options.modelSource;
        this.options = options;

        this.subscribe(PointerEvents.pointerDown, "onPointerDown");
    }

    attachWithObject3D() {
        this.maybeLoadFont().then((atlas) => this.initTextMesh(atlas));
        return this.initBoxMesh();
    }

    attach() {
        super.attach();
        makePointerSensitive(this.threeObj, this.asViewPartRef());
    }

    onPointerDown() {
        this.owner
    }

    maybeLoadFont() {
        return fontRegistry.getAtlasFor(this.options.font);
    }

    updateMaterial() {
        let text = this.text;
        let bounds = this.options.corners;
        //let bounds = this.editor.visibleTextBounds();
        text.material.uniforms.corners.value = new THREE.Vector4(bounds.l, bounds.t, bounds.r, bounds.b);
    }

    initTextMesh(atlasTexture) {
        let font = this.options.font;
        //const atlasTexture = fontRegistry.getTexture(font);

        /*
          const measurer = fontRegistry.getMeasurer(this.options.font);
        const font = fontPaths[this.options.font].json;
        const glyphs = measurer.computeGlyphs({font, drawnStrings: testTextContent});
        */

        const geometry = new TextGeometry({
            font: fontRegistry.getInfo(font),
            width: this.options.width,
            glyphs: [],
            align: null,
            flipY: true
        });

        //this.updateGeometry(geometry, testTextContent, []);

        window.text = this;
        const material = new THREE.RawShaderMaterial(HybridMSDFShader({
            map: atlasTexture,
            side: THREE.DoubleSide,
            transparent: true,
            negate: true
        }));

        const textMesh = new THREE.Mesh(geometry, material);
        let meterInPixel = this.options.width / this.options.pixelWidth;
        textMesh.scale.set(meterInPixel, -meterInPixel, meterInPixel);
        textMesh.position.z = 0.01;

        this.text = textMesh;
        let box = this.threeObj;
        box.add(textMesh);
    }

    initBoxMesh() {
        this.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0),  0),
                               new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
                               new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
                               new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];

        this.initSelectionMesh();
        this.initScrollBarMesh();

        const box = new THREE.Mesh(new THREE.PlaneBufferGeometry(this.options.width, this.options.height), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
        return box;
    }

    initSelectionMesh() {
        // geometry for the cursor bar rendered if selection is empty
        // see makeBoxSelectionMesh for actual selection
        /*const cube = new TCube(this.frame);
        cube.material = new THREE.MeshBasicMaterial({
            color: 0x8080C0,
        });
        cube.visible = false;
        this.addChild(cube);
        this.selectionBar = cube;
        cube.object3D.onBeforeRender = this.selectionBeforeRender.bind(this);

        this.boxSelections = [];
        */
    }

    initScrollBarMesh() {
        /*
        let cube = new TCube(this.frame);
        cube.visible = false;
        cube.setColor(new THREE.Color(0x0022ff));
        this.addChild(cube);
        this.scrollBar = cube;

        cube = new TCube(this.frame);
        cube.visible = false;
        cube.setColor(new THREE.Color(0x00aaff));
        this.addChild(cube);
        this.scrollKnob = cube;
*/
    }

    updateGeometry(geometry) {
        let font = fontRegistry.getInfo(this.options.font);
        let meterInPixel = this.options.width / this.options.scaleX;
        let scrollT = this.options.scrollTop;
        let descent = font.common.lineHeight - font.common.base;

        let docHeight = this.options.frameHeight;
        let docInMeter = docHeight * meterInPixel;

        let text = this.text;
        text.scale.x = meterInPixel;
        text.scale.y = -meterInPixel;

        text.position.x = -this.options.width / 2;
        text.position.y = this.options.height / 2 + (scrollT * docInMeter);
        text.position.z = 0.005;

        geometry.update({font: fontRegistry.getInfo(this.options.font), glyphs: this.options.content});
    }

    update(newOptions) {
        this.options = Object.assign(this.options, newOptions);
        let text = this.text;
        if (text && text.geometry) {
            this.updateMaterial();
            this.updateGeometry(text.geometry);
        }
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
        //this.targetViewPart.update({content: modelPart.content, font: modelPart.font});
        this.subscribe(TextEvents.contentChanged, "onContentChanged", modelState.id, this.modelSource);
        this.subscribe(TextEvents.fontChanged, "onFontChanged", modelState.id, this.modelSource);
        this.owner.model["text"].newNewText();
    }

    onContentChanged(newContent) {
        this.targetViewPart.update(newContent);
    }

    onFontChanged(newFont) {
        this.targetViewPart.update({font: newFont});
    }
}
