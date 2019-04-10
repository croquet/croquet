import * as THREE from 'three';
import { Node, ALIGN_CENTER, ALIGN_FLEX_START, ALIGN_FLEX_END, ALIGN_STRETCH, FLEX_DIRECTION_ROW, FLEX_DIRECTION_COLUMN, EDGE_ALL, DIRECTION_LTR, POSITION_TYPE_ABSOLUTE } from 'yoga-layout-prebuilt';
import { ViewPart } from '../modelView.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const MUL = 100;

/** @typedef {import('yoga-layout').YogaNode} YogaNode */
/** @typedef {import("../viewParts/text").default} TextViewPart */

export const LayoutEvents = {
    contentChanged: "layout-content-changed",
    layoutChanged: "layout-layout-changed"
};

export class LayoutViewPart extends ViewPart {
    constructor(options) {
        super(options);
        this.yogaNode = Node.create();
        this.options = options;
        if (this.options.flexDirection) this.yogaNode.setFlexDirection(
            this.options.flexDirection === "row" ? FLEX_DIRECTION_ROW : FLEX_DIRECTION_COLUMN
        );
        if (this.options.flexGrow) this.yogaNode.setFlexGrow(this.options.flexGrow);
        if (this.options.margin) this.yogaNode.setMargin(EDGE_ALL, this.options.margin * MUL);
        if (this.options.padding) this.yogaNode.setPadding(EDGE_ALL, this.options.padding * MUL);
        if (this.options.minHeight) this.yogaNode.setMinHeight(this.options.minHeight * MUL);
        if (this.options.minWidth) this.yogaNode.setMinWidth(this.options.minWidth * MUL);
        if (this.options.aspectRatio) this.yogaNode.setAspectRatio(this.options.aspectRatio);
        if (this.options.alignItems) {
            switch (this.options.alignItems) {
                case "center": this.yogaNode.setAlignItems(ALIGN_CENTER); break;
                case "flexStart": this.yogaNode.setAlignItems(ALIGN_FLEX_START); break;
                case "flexEnd": this.yogaNode.setAlignItems(ALIGN_FLEX_END); break;
                case "stretch": this.yogaNode.setAlignItems(ALIGN_STRETCH); break;
                default: break;
            }
        }
        if (this.options.alignContent) {
            switch (this.options.alignContent) {
                case "center": this.yogaNode.setAlignContent(ALIGN_CENTER); break;
                case "flexStart": this.yogaNode.setAlignContent(ALIGN_FLEX_START); break;
                case "flexEnd": this.yogaNode.setAlignContent(ALIGN_FLEX_END); break;
                case "stretch": this.yogaNode.setAlignContent(ALIGN_STRETCH); break;
                default: break;
            }
        }
        if (this.options.alignSelf) {
            switch (this.options.alignSelf) {
                case "center": this.yogaNode.setAlignSelf(ALIGN_CENTER); break;
                case "flexStart": this.yogaNode.setAlignSelf(ALIGN_FLEX_START); break;
                case "flexEnd": this.yogaNode.setAlignSelf(ALIGN_FLEX_END); break;
                case "stretch": this.yogaNode.setAlignSelf(ALIGN_STRETCH); break;
                default: break;
            }
        }
        if (this.options.justifyContent) this.yogaNode.setJustifyContent(this.options.justifyContent);
    }

    detach() {
        this.yogaNode.free();
        super.detach();
    }
}

export class LayoutContainer extends LayoutViewPart {
    /** @arg {{children: (LayoutViewPart)[]}} options */
    constructor(options) {
        super(options);
        this.children = [];
        this.group = new THREE.Group();
        this.threeObj = this.group;
        for (const child of options.children || []) this.addChild(child, false);
        this.publish(LayoutEvents.contentChanged, {});
        this.subscribe(LayoutEvents.layoutChanged, "onLayoutChanged");
    }

    /** @arg {LayoutViewPart} child */
    addChild(child, publishContentChanged=true) {
        this.children.push(child);
        this.yogaNode.insertChild(child.yogaNode, this.yogaNode.getChildCount());
        this.subscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.id);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        this.group.add(...child.threeObjs());
    }

    /** @arg {LayoutViewPart} child */
    removeChild(child, publishContentChanged=true) {
        const idx = this.children.indexOf(child);
        this.children.splice(idx, 1);
        this.yogaNode.removeChild(child.yogaNode);
        this.unsubscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.id);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        this.group.remove(...child.threeObjs());
    }

    onChildContentChanged() {
        this.publish(LayoutEvents.contentChanged, {});
    }

    onLayoutChanged() {
        for (const child of this.children) {
            this.publish(LayoutEvents.layoutChanged, {}, child.id);
        }
        this.group.position.setX(this.yogaNode.getComputedLeft() / MUL);
        this.group.position.setY(-this.yogaNode.getComputedTop() / MUL);
        // console.log(this.id, this.yogaNode.getComputedLeft(), this.yogaNode.getComputedTop(), this.yogaNode.getComputedWidth(), this.yogaNode.getComputedHeight());
    }
}

export class LayoutRoot extends LayoutContainer {
    constructor(options) {
        super(options);
        // cause and propagate first layout calculation
        this.onChildContentChanged();
        this.outerGroup = new THREE.Group();
        this.outerGroup.add(this.group);
        this.threeObj = this.outerGroup;
    }

    onChildContentChanged() {
        this.yogaNode.calculateLayout(undefined, undefined, DIRECTION_LTR);
        this.onLayoutChanged();
    }

    onLayoutChanged() {
        super.onLayoutChanged();
        this.group.position.setX(-0.5 * this.yogaNode.getComputedWidth() / MUL);
        this.group.position.setY(this.yogaNode.getComputedHeight() / MUL);
    }
}

export class LayoutSlot extends LayoutViewPart {
    /**
     * @arg {Object} options
     * @arg {ViewPart} options.inner - inner ViewPart that should be layouted
     */
    constructor(options) {
        super(options);
        this.subscribe(LayoutEvents.layoutChanged, "onLayoutChanged");
        this.parts = {inner: options.inner};
    }

    /** @abstract */
    onLayoutChanged() {}
}

export function MinFromBBox(BaseLayoutSlotClass) {
    return class MinFromBBoxLayoutSlot extends BaseLayoutSlotClass {
        constructor(options) {
            super(options);
            // TODO: what to do if the inner view has multiple threeObjs?
            const bbox = (new THREE.Box3()).setFromObject(this.parts.inner.threeObjs()[0]);
            this.yogaNode.setMinWidth((bbox.max.x - bbox.min.x) * MUL);
            this.yogaNode.setMinHeight((bbox.max.y - bbox.min.y) * MUL);
            this.yogaNode.setWidthAuto();
            this.yogaNode.setHeightAuto();
        }
    };
}

export class LayoutSlotCenter3D extends LayoutSlot {
    onLayoutChanged() {
        const targetPos = new THREE.Vector3(
            (this.yogaNode.getComputedLeft() + 0.5 * this.yogaNode.getComputedWidth()) / MUL,
            -1 * (this.yogaNode.getComputedTop() + 0.5 * this.yogaNode.getComputedHeight()) / MUL,
            this.options.z || 0
        );

        // TODO: what to do if the inner view has multiple threeObjs?
        this.parts.inner.threeObjs()[0].position.copy(targetPos);
    }
}

export class LayoutSlotStretch3D extends LayoutSlotCenter3D {
    onLayoutChanged() {
        super.onLayoutChanged();
        // TODO: what to do if the inner view has multiple threeObjs?
        this.parts.inner.threeObjs()[0].scale.setX(this.yogaNode.getComputedWidth() / MUL);
        this.parts.inner.threeObjs()[0].scale.setY(this.yogaNode.getComputedHeight() / MUL);
    }
}

export class LayoutSlotText extends LayoutSlot {
    onLayoutChanged() {
        const targetPos = new THREE.Vector3(
            (this.yogaNode.getComputedLeft()) / MUL,
            -1 * (this.yogaNode.getComputedTop()) / MUL,
            this.options.z || 0
        );

        // TODO: what to do if the inner view has multiple threeObjs?
        this.parts.inner.threeObjs()[0].position.copy(targetPos);
        this.parts.inner.update({
            width: (this.yogaNode.getComputedWidth()) / MUL,
            height: (this.yogaNode.getComputedHeight()) / MUL,
            anchor: "top"
        });
    }
}

/** A LayoutStack allows to create a stack of overlapping children occupying the same parent layout slot,
 * for example, to create a button that has both a background rectangle and a foreground text label.
 */
export class LayoutStack extends LayoutContainer {
    /** @arg {LayoutViewPart} child */
    addChild(child, publishContentChanged=true) {
        this.children.push(child);
        /** @type {YogaNode} */
        const wrapperNode = Node.create();
        wrapperNode.setPositionType(POSITION_TYPE_ABSOLUTE);
        wrapperNode.setPosition(EDGE_ALL, 0);
        wrapperNode.setWidthAuto();
        wrapperNode.setHeightAuto();
        wrapperNode.insertChild(child.yogaNode);
        child.yogaNode.setFlexGrow(1);
        this.yogaNode.insertChild(wrapperNode, this.yogaNode.getChildCount());
        if (!this.wrapperNodesForChildren) this.wrapperNodesForChildren = new Map();
        this.wrapperNodesForChildren.set(child, wrapperNode);
        this.subscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.id);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        this.group.add(...child.threeObjs());
    }

    /** @arg {LayoutViewPart} child */
    removeChild(child, publishContentChanged=true) {
        const idx = this.children.indexOf(child);
        this.children.splice(idx, 1);
        const wrapperNode = this.wrapperNodesForChildren.get(child);
        this.wrapperNodesForChildren.delete(child);
        wrapperNode.removeChild(child.yogaNode);
        this.yogaNode.removeChild(wrapperNode);
        this.unsubscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.id);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        this.group.remove(...child.threeObjs());
    }
}
