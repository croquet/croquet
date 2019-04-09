import * as THREE from 'three';
import { TextGeometry, HybridMSDFShader } from 'three-bmfont-text';
import { rendererVersion } from '../../render.js';
import { TextEvents } from '../../stateParts/editableText.js';
import { PointerEvents, makePointerSensitive, TrackPlaneEvents, TrackPlaneTopic } from "../pointer.js";
import { Warota } from './warota/doc.js';
import { fontRegistry } from '../../util/fontRegistry.js';
import { KeyboardEvents, KeyboardTopic } from '../../domKeyboardManager.js';
import { ViewPart } from '../../modelView.js';
import { userID } from "../../util/userid.js";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class EditableTextViewPart extends ViewPart {
    constructor(model, options) {
        options = {
            content: {content: [], selection: {start: 0, end: 0}}, glyphs: [], font: "Roboto", width: 3, height: 2, numLines: 10, drawnRects: [],
            source: "text", editable: false, showSelection: true, ...options,
        };
        super(model, options);
        this.modelSource = model.lookUp(options.source);
        this.changeInitiatedByView = true;
        this.options = options;

        if (this.options.editable) {
            this.subscribe(PointerEvents.pointerDown, "onPointerDown");
            this.subscribe(PointerEvents.pointerDrag, "onPointerDrag");
            this.subscribe(PointerEvents.pointerUp, "onPointerUp");
            this.subscribe(KeyboardEvents.keydown, "onKeyDown");
            this.subscribe(KeyboardEvents.copy, "onCopy");
            this.subscribe(KeyboardEvents.cut, "onCut");
            this.subscribe(KeyboardEvents.paste, "onPaste");
        }
        this.barSelections = {}; // {userID: threeobj}
        this.boxSelections = {}; // {userID: [threeobj]}

        fontRegistry.load(this.options.font).then(entry => {
            this.initEditor();
            this.initTextMesh(entry.atlas);
        });

        const boxMesh = this.initBoxMesh();

        if (this.options.editable) {
            makePointerSensitive(boxMesh, this);
        }

        if (model && model.parts.text && model.parts.text.content) {
            this.options.content = model.parts.text.content;
            this.subscribe(TextEvents.modelContentChanged, "onContentChanged", model.parts.text.id);
            this.subscribe(TextEvents.sequencedEvents, "onEditEvents", model.parts.text.id);
        }

        this.threeObj = boxMesh;
        window.view = this;
    }

    onGetFocus() {
        // I acquire focus
        // this.editor.getFocus();
    }

    initEditor() {
        //Carota.setCachedMeasureText(fontRegistry.measureText.bind(fontRegistry)); // ???
        this.lastPt = false;
        this.editor = new Warota(this.options.width, this.options.height, this.options.numLines);
        this.editor.mockCallback = ctx => {
            const glyphs = this.processMockContext(ctx);
            this.update({glyphs, corners: this.editor.visibleTextBounds(), scaleX: this.editor.pixelX, scrollTop: this.editor.scrollTop, frameHeight: this.editor.docHeight, drawnRects: ctx.filledRects});
        };
    }

    processMockContext(ctx) {
        const layout = fontRegistry.getMeasurer(this.options.font);
        if (!layout) {return [];}
        const info = fontRegistry.getInfo(this.options.font);
        const baseLine = fontRegistry.getOffsetY(this.options.font);
        return layout.computeGlyphs({font: info, drawnStrings: ctx.drawnStrings, offsetY: baseLine});
    }

    updateMaterial() {
        const text = this.text;

        const bounds = this.options.corners;
        text.material.uniforms.corners.value = new THREE.Vector4(bounds.l, bounds.t, bounds.r, bounds.b);
    }

    initTextMesh(atlasTexture) {
        const font = this.options.font;
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
            version: rendererVersion.shaderLanguageVersion,
            negate: true
        }));

        const textMesh = new THREE.Mesh(geometry, material);
        this.text = textMesh;
        const box = this.threeObj;
        box.add(textMesh);

        const callback = () => this.onTextChanged();
        this.editor.load(this.options.content.content);
        this.editor.doc.setSelections(this.options.content.selections);
        this.initScrollBarMesh();
        this.editor.paint();
    }

    initBoxMesh() {
        this.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0),  0),
                               new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
                               new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
                               new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];

        const box = new THREE.Mesh(new THREE.PlaneBufferGeometry(this.options.width, this.options.height), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
        this.draggingPlane = new THREE.Plane();
        return box;
    }

    makeSelectionMesh() {
        // geometry for the cursor bar rendered if selection's size is 0
        // see makeBoxSelectionMesh for actual selection
        const box = this.threeObj;

        const plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x8080C0 }));

        plane.visible = false;
        box.add(plane);
        plane.onBeforeRender = this.selectionBeforeRender.bind(this);
        return plane;
    }

    makeBoxSelectionMesh() {
        const plane = new THREE.Mesh(new THREE.PlaneBufferGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xA0CFEC }));

        plane.visible = false;
        plane.onBeforeRender = this.selectionBeforeRender.bind(this);
        return plane;
    }

    initScrollBarMesh() {
        const box = this.threeObj;
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
        const font = fontRegistry.getInfo(this.options.font);
        const meterInPixel = this.options.width / this.options.scaleX;
        const scrollT = this.options.scrollTop;
        const descent = font.common.lineHeight - font.common.base;

        const docHeight = this.options.frameHeight;
        const docInMeter = docHeight * meterInPixel;

        const text = this.text;
        text.scale.x = meterInPixel;
        text.scale.y = -meterInPixel;

        text.position.x = -this.options.width / 2;
        text.position.y = this.options.height / 2 + (scrollT * docInMeter);
        text.position.z = 0.005;

        geometry.update({font: fontRegistry.getInfo(this.options.font), glyphs: this.options.glyphs});

        this.updateScrollBarAndSelections(this.options.drawnRects, meterInPixel, docHeight, scrollT, descent);
    }

    updateScrollBarAndSelections(drawnRects, meterInPixel, docHeight, scrollT, _descent) {
        let boxInd = 0;
        const [cursorX, cursorY] = fontRegistry.getCursorOffset(this.options.font);

        for (let i = 0; i < drawnRects.length; i++) {
            const rec = drawnRects[i];
            const w = rec.w * meterInPixel;
            const h = rec.h * meterInPixel;
            const x = -this.options.width / 2 + (rec.x + cursorX) * meterInPixel + w / 2;
            const y = this.options.height / 2 + ((scrollT * docHeight) - (rec.y + cursorY)) * meterInPixel - h / 2;
            const meshRect = {x, y, w, h};

            if (rec.style.startsWith('barSelection')) {
                if (this.options.showSelection) {
                    // drawing the insertion  - line width of text cursor should relate to font
                    let id = rec.style.split(' ')[1];

                    meshRect.w = 5 * meterInPixel;
                    if (!this.barSelections[id]) {
                        this.barSelections[id] = this.makeSelectionMesh();
                    }
                    this.updateSelection(id, this.barSelections[id], meshRect, id);
                    if (this.boxSelections[id]) {
                        this.boxSelections[id].forEach(box => this.updateSelection(id, box, id, null));
                    }
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
                // oh, boy.  we are compensating it with fudge factor and recompensationg
                // here. The right thing should be to fix the data in json and cursorY
                // should be always zero for all fonts.
                meshRect.y += (-scrollT * docHeight + cursorY) * meterInPixel;
                this.updateSelection(this.scrollBar, meshRect);
            } else if (rec.style === 'scroll knob') {
                meshRect.y += (-scrollT * docHeight + cursorY) * meterInPixel;
                this.updateSelection(this.scrollKnob, meshRect, 0.004);
            }
        }
        for (let i = boxInd; i < this.boxSelections.length; i++) {
            this.updateSelection(this.boxSelections[i], null);
        }
    }

    updateSelection(id, selection, rect, color, optZ) {
        if (!selection) {return;}
        const actuallyShow = !!rect;
        selection.visible = actuallyShow;
        color = new THREE.Color('#'+color);
        selection.material.color = color;
        if (!actuallyShow) {return;}
        const geom = new THREE.PlaneBufferGeometry(rect.w, rect.h);
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

    computeClippingPlanes(ary) {
        //let [top, bottom, right, left] = ary; this is the order
        let planes = [];
        let text = this.text;
        if (isNaN(text.matrixWorld.elements[0])) return null;
        for (let i = 0; i < 4; i++) {
            planes[i] = new THREE.Plane();
            planes[i].copy(this.clippingPlanes[i]);
            planes[i].constant = ary[i];
            planes[i].applyMatrix4(text.matrixWorld);
        }
        return planes;
    }

    selectionBeforeRender(renderer, scene, camera, geometry, material, group) {
        let meterInPixel = this.options.width / this.editor.scaleX;
        let scrollT = this.editor.scrollTop;
        let docHeight = this.editor.docHeight;
        let top = -scrollT * docHeight;
        let bottom = -(top - this.editor.scaleY);
        let right = this.editor.scaleX * (1.0 - this.editor.relativeScrollBarWidth);
        let left = 0;
        let planes = this.computeClippingPlanes([top, bottom, right, left]);
        material.clippingPlanes = planes;
    }

    update(newOptions) {
        this.options = Object.assign(this.options, newOptions);
        const text = this.text;
        if (text && text.geometry) {
            this.updateMaterial();
            this.updateGeometry(text.geometry);
        }
    }

    onEditEvents(eventList) {
        let timezone = -1;
        eventList.forEach(e => {
            timezone = Math.max(timezone, e.timezone);
            this.editor.doEvent(e);
            this.editor.paint();
        });
        this.editor.setTimezone(timezone);
    }

    onContentChanged(newContent) {
        try {
            this.changeInitiatedByView = false;
            this.editor.delayPaint = false;
            this.editor.load(newContent.content);
            this.editor.select(newContent.selection.start,
                               newContent.selection.end);
            this.editor.paint();
        } finally {
            this.changeInitiatedByView = true;
            this.editor.delayPaint = true;
        }
    }

    onTextChanged() {}

    changed() {
        let events = this.editor.events;
        this.editor.resetEvents();
        if (events.length > 0 && this.options.editable) {
            this.modelPart("text").receiveEditEvents(events);
        }
    }

    textPtFromEvt(evtPt) {
        const pt = this.threeObj.worldToLocal(evtPt.clone());
        console.log(pt);
        const {editor: {pixelX, pixelY, scrollLeft, scrollTop}} = this;
        const width = this.options.width;
        const height = this.options.height;
        const visibleTop = (scrollTop * this.editor.docHeight);
        const x = Math.floor((width / 2 + pt.x + scrollLeft) * (pixelX / width));
        const realY = (height / 2 - pt.y) * (pixelY / height);
        const y = Math.floor(realY + visibleTop);

        return {x, y, realY};
    }

    onPointerDown(evt) {
        this.publish(KeyboardEvents.requestfocus, {requesterRef: this.id}, KeyboardTopic);
        const pt = this.textPtFromEvt(evt.at);
        this.editor.mouseDown(pt.x, pt.y, pt.realY, userID);
        this.lastPt = evt.at;

        this.draggingPlane.setFromNormalAndCoplanarPoint(this.threeObj.getWorldDirection(new THREE.Vector3()), this.threeObj.position);
        this.publish(TrackPlaneEvents.requestTrackPlane, {requesterRef: this.id, plane: this.draggingPlane}, TrackPlaneTopic, null);

        this.changed();
        return true;
    }

    onPointerDrag(evt) {
        // if (!this.lastPt) {return false;}
        // let p = evt.dragEndOnUserPlane;
        // if (!p) {return false;}
        // const pt = this.textPtFromEvt(p);
        // this.editor.mouseMove(pt.x, pt.y, pt.realY);
        // this.lastPt = pt;
        // this.changed();
        // return true;
    }

    onPointerUp(_evt) {
        // const pt = this.lastPt;
        // this.mouseIsDown = false;
        // this.editor.mouseUp(pt.x, pt.y, pt.realY);
        // this.lastPt = null;
        // this.publish(TrackPlaneEvents.requestTrackPlane, {requesterRef: this.id, plane: null}, TrackPlaneTopic, null);

        // this.changed();
        // return true;
    }

    onKeyDown(cEvt) {
        if (cEvt.onlyModifiers) {return true;}

        // what has to happen here is that the kinds of keycombo that browser need to pass
        // through, and the kinds that the editor handles are different.
        // We need to separated them, and for the latter, the text commands list has
        // to be tested here.
        if (cEvt.keyCombo === "Meta-S") {
            this.accept();
            return true;
        }

        if (cEvt.keyCode === 13) {
            this.editor.insert(userID, [{text: '\n'}]);
            this.changed();
            return true;
        }
        if (cEvt.keyCode === 32) {
            this.editor.insert(userID, [{text: ' '}]);
            this.changed();
            return true;
        }
        if (cEvt.keyCode === 9) {
            this.editor.insert(userID, [{text: '\t'}]);
            this.changed();
            return true;
        }

        const handled = this.editor.handleKey(userID, cEvt.keyCode, cEvt.shiftKey, cEvt.ctrlKey|| cEvt.metaKey);

        if (!handled && !(cEvt.ctrlKey || cEvt.metaKey)) {
            this.editor.insert(userID, [{text: cEvt.key}]);
            this.changed();
            return true;
        }
        this.changed();
        return true;
    }

    onCopy(evt) {
        evt.clipboardData.setData("text/plain", this.editor.selectedRange().plainText());
        evt.preventDefault();
        return true;
    }

    onCut(evt) {
        this.onCopy(evt);
        this.editor.insert(userID, [{text: ""}]);//or something else to keep undo sane?
        this.changed();
        return true;
    }

    onPaste(evt) {
        let pasteChars = evt.clipboardData.getData("text");
        this.editor.insert(userID, [{text: pasteChars}]);
        evt.preventDefault();
        this.changed();
        return true;
    }

    onSave() {}

    accept() {
        this.owner.model["editableText"].acceptContent();
    }

    // "text access"
    positionToIndex(textPos) {
        let {frame: {lines}} = this.editor,
        {row, column} = textPos,
        minRow = 0, maxRow = lines.length -1;
        if (row < minRow) { row = 0; column = 0; }
        if (row > maxRow) { row = maxRow; column = lines[maxRow].length-1; }
        return lines[row].ordinal + column;
    }

    textInRange(range) {
        let from = this.positionToIndex(range.start),
        to = this.positionToIndex(range.end);
        return this.editor.range(from, to).plainText();
    }
}
