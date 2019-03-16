import * as THREE from 'three';
import { TextGeometry, HybridMSDFShader } from 'three-bmfont-text';
import Object3D from "./object3D.js";
//import LazyObject3D from "../util/lazyObject3D.js";
import { TextEvents } from '../stateParts/text.js';
import { PointerEvents, makePointerSensitive } from "./pointer.js";
import { Carota } from './carota/editor.js';
import { fontRegistry } from './fontRegistry.js';
import { KeyboardEvents, KeyboardTopic } from '../domKeyboardManager.js';
//import { textCommands, jsEditorCommands, defaultKeyBindings } from './text-commands.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default class TextViewPart extends Object3D {
    fromOptions(options) {
        options = {content: [], glyphs: [], font: "Roboto", width: 3, height: 2, numLines: 10, drawnRects: [], editable: false, showSelection: true, ...options};
        this.modelSource = options.modelSource;
        this.options = options;

        if (this.options.editable) {
            this.subscribe(PointerEvents.pointerDown, "onPointerDown");
            this.subscribe(PointerEvents.pointerMove, "onPointerMove");
            this.subscribe(PointerEvents.pointerUp, "onPointerUp");
            this.subscribe(KeyboardEvents.keydown, "onKeyDown");
        }

        this.boxSelections = [];
    }

    attachWithObject3D() {
        this.initEditor();
        fontRegistry.getAtlasFor(this.options.font).then((atlas) => this.initTextMesh(atlas));
        return this.initBoxMesh();
    }

    attach(modelState) {
        super.attach(modelState);
        if (this.options.editable) {
            makePointerSensitive(this.threeObj, this.asPartRef());
        }
        if (modelState && modelState.parts.text && modelState.parts.text.content) {
            this.options.content = modelState.parts.text.content;
            this.subscribe(TextEvents.modelContentChanged, "onContentChanged", modelState.id, this.modelSource);
        }
    }

    onGetFocus() {
        // I acquire focus
        // this.editor.getFocus();
    }

    initEditor() {
        Carota.setCachedMeasureText(fontRegistry.measureText.bind(fontRegistry)); // ???
        this.lastPt = false;
        this.editor = new Carota(this.options.width, this.options.height, this.options.numLines);
        this.editor.isScrollable = true;  // unless client decides otherwise

        this.editor.mockCallback = ctx => {
            let glyphs = this.processMockContext(ctx);
            this.update({glyphs, corners: this.editor.visibleTextBounds(), scaleX: this.editor.scaleX, scrollTop: this.editor.scrollTop, frameHeight: this.editor.frame.height, drawnRects: ctx.filledRects});
            if (this.options.editable) {
                this.owner.model["text"].onContentChanged(this.editor.save());
            }
        };
    }

    processMockContext(ctx) {
        let layout = fontRegistry.getMeasurer(this.options.font);
        if (!layout) {return [];}
        let info = fontRegistry.getInfo(this.options.font);
        let baseLine = fontRegistry.getOffsetY(this.options.font);
        return layout.computeGlyphs({font: info, drawnStrings: ctx.drawnStrings, offsetY: baseLine});
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

        this.initSelectionMesh();
        this.initScrollBarMesh();

        window.view = this;
    }

    initBoxMesh() {
        this.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0),  0),
                               new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
                               new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
                               new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];

        const box = new THREE.Mesh(new THREE.PlaneBufferGeometry(this.options.width, this.options.height), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
        return box;
    }

    initSelectionMesh() {
        // geometry for the cursor bar rendered if selection is empty
        // see makeBoxSelectionMesh for actual selection
        let box = this.threeObj;

        const plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x111180 }));

        plane.visible = false;
        box.add(plane);
        this.selectionBar = plane;
        //cube.object3D.onBeforeRender = this.selectionBeforeRender.bind(this);
        this.boxSelections = [];
    }

    initScrollBarMesh() {
        let box = this.threeObj;
        let plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x0044ee }));
        plane.visible = false;
        box.add(plane);
        this.scrollBar = plane;

        plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x00aaee }));
        plane.visible = false;
        box.add(plane);
        this.scrollKnob = plane;
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

        this.updateScrollBarAndSelections(this.options.drawnRects, meterInPixel, docHeight, scrollT, descent);
    }

    updateScrollBarAndSelections(drawnRects, meterInPixel, docHeight, scrollT, descent) {
        let boxInd = 0;
        let [cursorX, cursorY] = fontRegistry.getCursorOffset(this.options.font);

        for (let i = 0; i < drawnRects.length; i++) {
            let rec = drawnRects[i];
            let w = rec.w * meterInPixel;
            let h = rec.h * meterInPixel;
            let x = -this.options.width / 2 + (rec.x + cursorX) * meterInPixel + w / 2;
            let y = this.options.height / 2 + ((scrollT * docHeight) - (rec.y + cursorY)) * meterInPixel - h / 2;
            let meshRect = {x, y, w, h};

            if (rec.style === 'bar selection') {
                if (this.options.showSelection) {
                    // drawing the insertion  - line width of text cursor should relate to font
                    meshRect.w = 5 * meterInPixel;
                    this.updateSelection(this.selectionBar, meshRect);
                    this.boxSelections.forEach(box => this.updateSelection(box, null));
                }
            } else if (rec.style === 'box selection focus' ||
                       rec.style === 'box selection unfocus') {
                // boxes of selections
                if (this.options.showSelection) {
                    let cube;
                    if (!this.boxSelections[boxInd]) {
                        cube = this.boxSelections[boxInd] = this.makeBoxSelectionMesh();
                        this.threeObj.add(cube);
                    }
                    cube = this.boxSelections[boxInd];
                    this.updateSelection(cube, meshRect);
                    boxInd++;
                    this.updateSelection(this.selectionBar, null);
                }
            } else if (rec.style === 'scroll bar') {
                meshRect.y += -scrollT * docHeight * meterInPixel;
                this.updateSelection(this.scrollBar, meshRect);
            } else if (rec.style === 'scroll knob') {
                meshRect.y += -scrollT * docHeight * meterInPixel;
                this.updateSelection(this.scrollKnob, meshRect, 0.004);
            }
        }
        for (let i = boxInd; i < this.boxSelections.length; i++) {
            this.updateSelection(this.boxSelections[i], null);
        }
    }

    updateSelection(selection, rect, optZ) {
        if (!selection) {return;}
        let actuallyShow = !!rect;
        selection.visible = actuallyShow;
        if (!actuallyShow) {return;}
        let geom = new THREE.PlaneBufferGeometry(rect.w, rect.h);
        selection.geometry = geom;
        selection.position.set(rect.x, rect.y, optZ || 0.003);
    }

    removeSelections() {
        if (this.boxSelections) {
            this.boxSelections.forEach(box => box.remove());
        }
        this.boxSelections = [];

        ['selectionBar', 'scrollBar', 'scrollKnob'].forEach(name => {
            if (this[name]) {
                this[name].remove();
                this[name] = null;
            }
        });
    }

    makeBoxSelectionMesh() {
        const plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xA0CFEC }));

        plane.visible = false;
        //plane.onBeforeRender = this.selectionBeforeRender.bind(this);
        return plane;
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

    textPtFromEvt(evtPt) {
        let pt = this.threeObj.worldToLocal(evtPt.clone());
        let {editor: {scaleX, scaleY, scrollLeft, scrollTop}} = this,
        width = this.options.width,
        height = this.options.height,
        visibleTop = (scrollTop * this.editor.frame.height),
        x = Math.floor((width / 2 + pt.x + scrollLeft) * (scaleX / width)),
        realY = (height / 2 - pt.y) * (scaleY / height),
        y = Math.floor(realY + visibleTop);

        return {x, y, realY};
    }

    onPointerDown(evt) {
        this.publish(KeyboardEvents.requestfocus, {requesterRef: this.asPartRef()}, KeyboardTopic, null);
        let pt = this.textPtFromEvt(evt.at);
        this.editor.mouseDown(pt.x, pt.y, pt.realY);
        this.lastPt = pt;
        return true;
    }

    onPointerMove(evt) {
        if (!this.lastPt) { return false;}
        let pt = this.textPtFromEvt(evt.hoverPoint);
        this.editor.mouseMove(pt.x, pt.y, pt.realY);
        this.lastPt = pt;
        return true;
    }

    onPointerUp(evt) {
        let pt = this.lastPt;
        this.mouseIsDown = false;
        this.editor.mouseUp(pt.x, pt.y, pt.realY);
        this.lastPt = null;
        return true;
    }

    onKeyDown(evt) {
        if (evt.keyCode === 13) {
            this.editor.insert('\n');
            return true;
        }
        let handled = this.editor.handleKey(evt.keyCode, evt.shiftKey, evt.ctrlKey|| evt.metaKey);

        if (!handled && !(evt.ctrlKey || evt.metaKey)) {
            this.editor.insert(evt.key);
            return true;
        }
        return true;
    }
}
