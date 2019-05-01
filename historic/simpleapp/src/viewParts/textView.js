import * as THREE from "three";
import { TextGeometry, HybridMSDFShader } from "three-bmfont-text";
import { rendererVersion } from "../render";
import { TextEvents } from "../modelParts/text";
import { PointerEvents, makePointerSensitive, TrackPlaneEvents, TrackPlaneTopic } from "./pointer";
import { Warota } from "../util/warota/warota";
import { fontRegistry } from "../util/fontRegistry";
import { KeyboardEvents, KeyboardTopic } from "../domKeyboardManager";
import { ViewPart } from "../parts";
import { userID } from "../util/userid";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class EditableTextViewPart extends ViewPart {
    constructor(options) {
        super();
        this.doc = options.textPart ? options.textPart.doc : null;
        if (!this.doc && options.content) {
            this.initialContent = options.content;
        }
        this.textPart = options.textPart;

        this.options = {font: 'Barlow',
               fontSize: 0.25,
               width: 3,
               height: 2,
               editable: true,
               showSelection: true,
               showScrollBar: true,
               hideBackbackground: false,
               backgroundColor: 'eeeeee',
               singleLine: false,
               autoResize: false,
               margins: {left: 0, right: 0, top: 0, bottom: 0}, ...options};

        if (this.options.editable) {
            this.subscribe(this.id, PointerEvents.pointerDown, data => this.onPointerDown(data));
            this.subscribe(this.id, PointerEvents.pointerDrag, data => this.onPointerDrag(data));
            this.subscribe(this.id, PointerEvents.pointerUp, data => this.onPointerUp(data));
            this.subscribe(this.id, KeyboardEvents.keydown, data => this.onKeyDown(data));
            this.subscribe(this.id, KeyboardEvents.copy, data => this.onCopy(data));
            this.subscribe(this.id, KeyboardEvents.cut, data => this.onCut(data));
            this.subscribe(this.id, KeyboardEvents.paste, data => this.onPaste(data));
        }

        const boxMesh = this.initBoxMesh();

        this.selections = []; // [ThreeObj] For each rendering, we grab available one, and change the color and size.

        fontRegistry.load(this.options.font).then(entry => {
            this.initEditor();
            this.initTextMesh(entry.atlas);
        });

        if (this.options.editable) {
            makePointerSensitive(boxMesh, this);
            this.subscribe(this.textPart.id, TextEvents.changed, data => this.onChanged(data));
        }

        this.threeObj = boxMesh;
    }

    onGetFocus() {
        // I acquire focus
        // this.editor.getFocus();
    }

    initEditor() {
        this.editor = new Warota(this.options, this.doc); // options may be modified, doc might be null for non editable text
        this.editor.mockCallback = ctx => {
            const glyphs = this.processMockContext(ctx);
            this.update(glyphs, this.options.font, this.editor.visibleTextBounds(), this.editor.pixelX, this.editor.scrollTop, this.editor.docHeight, ctx.filledRects);
        };
    }

    processMockContext(ctx) {
        const layout = fontRegistry.getMeasurer(this.options.font);
        if (!layout) {return [];}
        const info = fontRegistry.getInfo(this.options.font);
        const baseLine = fontRegistry.getOffsetY(this.options.font);
        return layout.computeGlyphs({font: info, drawnStrings: ctx.drawnStrings, offsetY: baseLine});
    }

    updateMaterial(corners) {
        const text = this.text;
        text.material.uniforms.corners.value = new THREE.Vector4(corners.l, corners.t, corners.r, corners.b);
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

        //const callback = () => this.onTextChanged();

        if (this.initialContent) {
            this.editor.doc.load(this.initialContent);
            delete this.initialContent;
        }

        if (this.resizeRequest) {
            this.updateExtent(this.resizeRequest);
            delete this.resizeRequest;
        }
        this.editor.layout(this.options);
        if (this.options.autoResize) {
            this.resize(this.editor.newWidth, this.editor.newHeight, true);
        }
        this.editor.paint();
    }

    resize(width, height, dontLayout) {
        // it assumes the ordinally initialization has been performed.
        // That means that options has fontSize (and also numLines).

        this.options.width = width;
        this.options.height = height;

        this.removeSelections();

        const boxMesh = this.initBoxMesh();

        if (this.options.editable) {
            makePointerSensitive(boxMesh, this);
        }
        this.threeObj = boxMesh;
        boxMesh.add(this.text);

        this.editor.resize(this.options.width, this.options.height);
        this.editor.resizeToNumLinesOrFontSize(this.options);

        if (!dontLayout) {
            this.editor.layout(this.options);
        }
        this.editor.paint();
    }

    threeObjs() {
        return [this.threeObj];
    }

    updateExtent(options) {
        if (!this.text) {
            this.resizeRequest = options;
        } else {
            let {width, height, _anchor} = options;
            this.resize(width, height);
        }
    }

    initBoxMesh() {
        this.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0),  0),
                               new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
                               new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
                               new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];
        this.draggingPlane = new THREE.Plane();

        if (this.threeObj) {
            let box = this.threeObj;
            box.geometry = new THREE.PlaneBufferGeometry(this.options.width, this.options.height);
            return box;
        }

        let opt = this.options.hideBackground
            ? {transparent: true, opacity: 0}
            : {color: '#' + this.options.backgroundColor};

        return new THREE.Mesh(new THREE.PlaneBufferGeometry(this.options.width, this.options.height), new THREE.MeshBasicMaterial(opt));
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

    updateGeometry(geometry, glyphs, fontName, pixelX, scrollTop, docHeight, drawnRects) {
        const font = fontRegistry.getInfo(fontName);
        const meterInPixel = this.options.width / pixelX;
        const scrollT = scrollTop;
        const descent = font.common.lineHeight - font.common.base;

        const docInMeter = docHeight * meterInPixel;

        const text = this.text;
        text.scale.x = meterInPixel;
        text.scale.y = -meterInPixel;

        text.position.x = -this.options.width / 2;
        text.position.y = this.options.height / 2 + (scrollT * docInMeter);
        text.position.z = 0.005;

        geometry.update({font: fontRegistry.getInfo(fontName), glyphs});

        this.updateScrollBarAndSelections(drawnRects, meterInPixel, docHeight, scrollT, descent);
    }

    updateScrollBarAndSelections(drawnRects, meterInPixel, docHeight, scrollT, _descent) {
        const [cursorX, cursorY] = fontRegistry.getCursorOffset(this.options.font);

        let selIndex = 0;
        let getSelectionBox = () => {
            let box = this.selections[selIndex];
            if (!box) {
                box = this.makeSelectionMesh();
                this.selections[selIndex] = box;
            }
            selIndex++;
            box.visible = true;
            return box;
        };

        this.selections.forEach(p => p.visible = false);

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
                    let color = rec.style.split(' ')[1];
                    let box = getSelectionBox();
                    this.updateSelection(box, meshRect, color);
                }
            } else if (rec.style.startsWith('boxSelection')) {
                // rec.style === 'boxSelectionUnfocus' || 'boxSelectionFocus'
                if (this.options.showSelection) {
                    let color = rec.style.split(' ')[1];
                    // boxes of selections
                    let box = getSelectionBox();
                    this.updateSelection(box, meshRect, color);
                }
            } else if (rec.style === 'scrollBar') {
                // oh, boy.  we are compensating it with fudge factor and recompensationg
                // here. The right thing should be to fix the data in json and cursorY
                // should be always zero for all fonts.
                meshRect.y += (-scrollT * docHeight + cursorY) * meterInPixel;
                let bar = getSelectionBox();
                this.updateSelection(bar, meshRect, '0044ee');
            } else if (rec.style === 'scrollKnob') {
                let knob = getSelectionBox();
                meshRect.y += (-scrollT * docHeight + cursorY) * meterInPixel;
                this.updateSelection(knob, meshRect, '00aaee', 0.004);
            }
        }
    }

    updateSelection(selection, rect, color, optZ) {
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
        const box = this.threeObj;

        this.selections.forEach(s => box.remove(s));
        this.selections = [];
    }

    computeClippingPlanes(ary) {
        //let [top, bottom, right, left] = ary; this is the order
        let planes = [];
        let text = this.text;
        for (let i = 0; i < 4; i++) {
            planes[i] = new THREE.Plane();
            planes[i].copy(this.clippingPlanes[i]);
            planes[i].constant = ary[i];
            planes[i].applyMatrix4(text.matrixWorld);
        }
        return planes;
    }

    selectionBeforeRender(renderer, scene, camera, geometry, material, group) {
        let scrollT = this.editor.scrollTop;
        let docHeight = this.editor.docHeight;
        let top = -scrollT * docHeight;
        let bottom = -(top - this.editor.scaleY);
        let right = this.editor.scaleX * (1.0 - this.editor.relativeScrollBarWidth);
        let left = 0;
        let planes = this.computeClippingPlanes([top, bottom, right, left]);
        material.clippingPlanes = planes;
    }

    update(glyphs, fontName, corners, pixelX, scrollTop, docHeight, drawnRects) {
        const text = this.text;
        if (text && text.geometry) {
            this.updateMaterial(corners);
            this.updateGeometry(text.geometry, glyphs, fontName, pixelX, scrollTop, docHeight, drawnRects);
        }
    }

    onChanged(timezone) {
        this.editor.layout(this.options);
        if (this.options.autoReisze) {
            this.resize(this.editor.newWidth, this.editor.newHeight, true);
        }
        this.editor.paint();
        this.editor.setTimezone(timezone);
    }

    onTextChanged() {}

    changed() {
        let events = this.editor.events;
        this.editor.resetEvents();
        if (events.length > 0 && this.options.editable) {
            this.textPart.future().receiveEditEvents(events);
        }
    }

    textPtFromEvt(evtPt) {
        const pt = this.threeObj.worldToLocal(evtPt.clone());
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
        this.lastPt = evt.at;
        this.publish(KeyboardTopic, KeyboardEvents.requestfocus, {requesterRef: this.id});
        const pt = this.textPtFromEvt(evt.at);
        this.editor.mouseDown(pt.x, pt.y, pt.realY, userID);

        this.draggingPlane.setFromNormalAndCoplanarPoint(this.threeObj.getWorldDirection(new THREE.Vector3()), this.threeObj.position);
        this.publish(TrackPlaneTopic, TrackPlaneEvents.requestTrackPlane, {requesterRef: this.id, plane: this.draggingPlane});

        this.changed();
        return true;
    }

    onPointerDrag(evt) {
        if (!this.lastPt) {return false;}
        let p = evt.dragEndOnUserPlane;
        if (!p) {return false;}
        const pt = this.textPtFromEvt(p);
        let type = this.editor.mouseMove(pt.x, pt.y, pt.realY, userID);
        this.lastPt = pt;
        if (type === "scrollChanged") {
            this.editor.paint();
        } else if (type === "selectionChanged") {
            this.changed();
        }
        return true;
    }

    onPointerUp(_evt) {
        const pt = this.lastPt;
        this.editor.mouseUp(pt.x, pt.y, pt.realY, userID);
        this.lastPt = null;
        // this.publish(TrackPlaneEvents.requestTrackPlane, {requesterRef: this.id, plane: null}, TrackPlaneTopic, null);

        this.changed();
        return true;
    }

    onKeyDown(cEvt) {
        if (cEvt.onlyModifiers) {return true;}

        // what has to happen here is that the kinds of keycombo that browser need to pass
        // through, and the kinds that the editor handles are different.
        // We need to separated them, and for the latter, the text commands list has
        // to be tested here.
        if (cEvt.keyCombo === "Meta-S" || cEvt.keyCombo === "Ctrl-S") {
            this.accept();
            return true;
        }

        if (cEvt.keyCombo === "Meta-Z" || cEvt.keyCombo === "Ctrl-Z") {
            this.undo();
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
        let text = this.editor.selectionText(userID);
        evt.clipboardData.setData("text/plain", text);
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
        this.textPart.future().acceptContent();
    }

    undo() {
        this.textPart.future().undoRequest(userID);
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
