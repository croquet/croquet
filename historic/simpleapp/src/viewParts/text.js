import * as THREE from 'three';
import { TextGeometry, HybridMSDFShader } from 'three-bmfont-text';
import Object3D from "./object3D.js";
//import LazyObject3D from "../util/lazyObject3D.js";
import { TextEvents } from '../stateParts/text.js';
import { PointerEvents, makePointerSensitive } from "./pointer.js";
import { Carota } from './carota/editor.js';
import { fontRegistry } from './fontRegistry.js';
import { KeyboardEvents, KeyboardTopic } from '../domKeyboardManager.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class TextViewPart extends Object3D {
    fromOptions(options) {
        options = {content: [], glyphs: [], font: "Lora", width: 3, height: 2, numLines: 10, editable: false, ...options};
        this.modelSource = options.modelSource;
        this.options = options;

        if (this.options.editable) {
            this.subscribe(PointerEvents.pointerDown, "onPointerDown");
            this.subscribe(KeyboardEvents.keydown, "onKeyDown");
        }
    }

    attachWithObject3D() {
        this.initEditor();
        fontRegistry.getAtlasFor(this.options.font).then((atlas) => this.initTextMesh(atlas));
        return this.initBoxMesh();
    }

    attach(modelState) {
        super.attach(modelState);
        if (this.options.editable) {
            makePointerSensitive(this.threeObj, this.asViewPartRef());
        }
        if (modelState && modelState.parts.text && modelState.parts.text.content) {
            this.options.content = modelState.parts.text.content;
            this.subscribe(TextEvents.modelContentChanged, "onContentChanged", modelState.id, this.modelSource);
        }
    }

    onPointerDown() {
        this.publish(KeyboardEvents.requestfocus, {requesterRef: this.asViewPartRef()}, KeyboardTopic, null);
    }

    initEditor() {
        Carota.setCachedMeasureText(fontRegistry.measureText.bind(fontRegistry)); // ???
        this.editor = new Carota(this.options.width, this.options.height, this.options.numLines);
        this.editor.isScrollable = true;  // unless client decides otherwise

        this.editor.mockCallback = ctx => {
            let glyphs = this.processMockContext(ctx);
            this.update({glyphs: glyphs, corners: this.editor.visibleTextBounds(), scaleX: this.editor.scaleX, scrollTop: this.editor.scrollTop, frameHeight: this.editor.frame.height});
            if (this.options.editable) {
                this.owner.model["text"].onContentChanged(this.editor.save());
            }
        };

        window.editor = this.editor;
    }

    processMockContext(ctx) {
        let layout = fontRegistry.getMeasurer(this.options.font);
        if (!layout) {return [];}
        let info = fontRegistry.getInfo(this.options.font);
        return layout.computeGlyphs({font: info, drawnStrings: ctx.drawnStrings});
    }

    updateMaterial() {
        let text = this.text;
        let bounds = this.options.corners;
        text.material.uniforms.corners.value = new THREE.Vector4(bounds.l, bounds.t, bounds.r, bounds.b);
    }

    initTextMesh(atlasTexture) {
        //const atlasTexture = fontRegistry.getTexture(font);
        let font = this.options.font;
        const geometry = new TextGeometry({
            font: fontRegistry.getInfo(font),
            width: this.options.width,
            glyphs: [],
            align: null,
            flipY: true
        });

        const material = new THREE.RawShaderMaterial(HybridMSDFShader({
            map: atlasTexture,
            side: THREE.DoubleSide,
            transparent: true,
            negate: true
        }));

        const textMesh = new THREE.Mesh(geometry, material);
        this.text = textMesh;
        let box = this.threeObj;
        box.add(textMesh);

        const callback = () => this.onTextChanged();
        this.editor.setSubscribers(callback);
        this.editor.load(this.options.content);

        window.view = this;
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

        geometry.update({font: fontRegistry.getInfo(this.options.font), glyphs: this.options.glyphs});
    }

    update(newOptions) {
        this.options = Object.assign(this.options, newOptions);
        let text = this.text;
        if (text && text.geometry) {
            this.updateMaterial();
            this.updateGeometry(text.geometry);
        }
    }

    onContentChanged(newContent) {
        this.editor.load(newContent);
    }

    onTextChanged() {}

    onKeyDown(evt) {
        this.editor.insert(evt.key);
    }
}
