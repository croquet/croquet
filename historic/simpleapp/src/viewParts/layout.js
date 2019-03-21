import * as THREE from 'three';
import { Node, ALIGN_CENTER, ALIGN_FLEX_START, ALIGN_FLEX_END, ALIGN_STRETCH, FLEX_DIRECTION_ROW, FLEX_DIRECTION_COLUMN, EDGE_ALL, DIRECTION_LTR } from 'yoga-layout-prebuilt';
import { ViewPart } from '../view.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

const MUL = 100;

/** @typedef {import('yoga-layout').YogaNode} YogaNode */

export const LayoutEvents = {
    contentChanged: "layout-content-changed",
    layoutChanged: "layout-layout-changed"
};

export class LayoutViewPart extends ViewPart {
    fromOptions(options) {
        this.node = Node.create();
        this.options = options;
    }

    attach(_modelState) {
        if (this.options.flexDirection) this.node.setFlexDirection(
            this.options.flexDirection === "row" ? FLEX_DIRECTION_ROW : FLEX_DIRECTION_COLUMN
        );
        if (this.options.flexGrow) this.node.setFlexGrow(this.options.flexGrow);
        if (this.options.margin) this.node.setMargin(EDGE_ALL, this.options.margin * MUL);
        if (this.options.padding) this.node.setPadding(EDGE_ALL, this.options.padding * MUL);
        if (this.options.minHeight) this.node.setMinHeight(this.options.minHeight * MUL);
        if (this.options.minWidth) this.node.setMinWidth(this.options.minWidth * MUL);
        if (this.options.aspectRatio) this.node.setAspectRatio(this.options.aspectRatio);
        if (this.options.alignItems) {
            switch (this.options.alignItems) {
                case "center": this.node.setAlignItems(ALIGN_CENTER); break;
                case "flexStart": this.node.setAlignItems(ALIGN_FLEX_START); break;
                case "flexEnd": this.node.setAlignItems(ALIGN_FLEX_END); break;
                case "stretch": this.node.setAlignItems(ALIGN_STRETCH); break;
                default: break;
            }
        }
        if (this.options.alignContent) {
            switch (this.options.alignContent) {
                case "center": this.node.setAlignContent(ALIGN_CENTER); break;
                case "flexStart": this.node.setAlignContent(ALIGN_FLEX_START); break;
                case "flexEnd": this.node.setAlignContent(ALIGN_FLEX_END); break;
                case "stretch": this.node.setAlignContent(ALIGN_STRETCH); break;
                default: break;
            }
        }
        if (this.options.alignSelf) {
            switch (this.options.alignSelf) {
                case "center": this.node.setAlignSelf(ALIGN_CENTER); break;
                case "flexStart": this.node.setAlignSelf(ALIGN_FLEX_START); break;
                case "flexEnd": this.node.setAlignSelf(ALIGN_FLEX_END); break;
                case "stretch": this.node.setAlignSelf(ALIGN_STRETCH); break;
                default: break;
            }
        }
        if (this.options.justifyContent) this.node.setJustifyContent(this.options.justifyContent);
    }

    detach() {
        this.node.free();
    }
}

export class LayoutContainer extends LayoutViewPart {
    /** @arg {{children: (LayoutViewPart)[]}} options */
    fromOptions(options) {
        super.fromOptions(options);
        this.children = new Set();
        this.group = new THREE.Group();
        this.futureChildren = options.children;
        this.subscribe(LayoutEvents.layoutChanged, "onLayoutChanged");
    }

    attach(modelState) {
        super.attach(modelState);
        for (const child of this.futureChildren || []) this.addChild(child, false);
        this.publish(LayoutEvents.contentChanged, {});
    }

    addToThreeParent(parent) {
        if (!this.group.parent) parent.add(this.group);
    }

    removeFromThreeParent(parent) {
        if (this.group.parent === parent) parent.remove(this.group);
    }

    /** @arg {LayoutViewPart} child */
    addChild(child, publishContentChanged=true) {
        this.children.add(child);
        this.node.insertChild(child.node, this.node.getChildCount());
        this.subscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.owner.id, child.partId);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        child.addToThreeParent(this.group);
    }

    /** @arg {LayoutViewPart} child */
    removeChild(child, publishContentChanged=true) {
        this.children.delete(child);
        this.node.removeChild(child.node);
        this.unsubscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.owner.id, child.partId);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        child.removeFromThreeParent(this.group);
    }

    onChildContentChanged() {
        this.publish(LayoutEvents.contentChanged, {});
    }

    onLayoutChanged() {
        for (const child of this.children) {
            this.publish(LayoutEvents.layoutChanged, {}, child.owner.id, child.partId);
        }
        this.group.position.setX(this.node.getComputedLeft() / MUL);
        this.group.position.setY(this.node.getComputedTop() / MUL);
        //console.log(this.partId, this.node.getComputedLeft(), this.node.getComputedTop(), this.node.getComputedWidth(), this.node.getComputedHeight());
    }
}

export class LayoutRoot extends LayoutContainer {
    fromOptions(options) {
        options = {target: "object3D", ...options};
        super.fromOptions(options);
        this.targetViewPart = this.owner.parts[options.target];
    }

    attach(modelState) {
        super.attach(modelState);
        this.addToThreeParent(this.targetViewPart.threeObj);
        this.onChildContentChanged();
    }

    onChildContentChanged() {
        this.node.calculateLayout(undefined, undefined, DIRECTION_LTR);
        this.onLayoutChanged();
    }

    onLayoutChanged() {
        super.onLayoutChanged();
        this.group.position.setX(-0.5 * this.node.getComputedWidth() / MUL);
        this.group.position.setY(this.node.getComputedHeight() / MUL);
    }
}

export class LayoutSlotCenter3D extends LayoutViewPart {
    fromOptions(options) {
        options = {affects: "object3D", ...options};
        super.fromOptions(options);
        this.targetViewPart = this.owner.parts[options.affects];
        this.subscribe(LayoutEvents.layoutChanged, "onLayoutChanged");
    }

    attach(modelState) {
        super.attach(modelState);
        const bbox = (new THREE.Box3()).setFromObject(this.targetViewPart.threeObj);
        this.node.setMinWidth((bbox.max.x - bbox.min.x) * MUL);
        this.node.setMinHeight((bbox.max.y - bbox.min.y) * MUL);
        this.node.setWidthAuto();
        this.node.setHeightAuto();
    }

    onLayoutChanged() {
        const targetPos = new THREE.Vector3(
            (this.node.getComputedLeft() + 0.5 * this.node.getComputedWidth()) / MUL,
            -1 * (this.node.getComputedTop() + 0.5 * this.node.getComputedHeight()) / MUL,
            0
        );

        this.targetViewPart.threeObj.position.copy(targetPos);
        //console.log(this.partId, this.node.getComputedLeft(), this.node.getComputedTop(), this.node.getComputedWidth(), this.node.getComputedHeight());
    }

    addToThreeParent(parent) {
        this.targetViewPart.addToThreeParent(parent);
    }

    removeFromThreeParent(parent) {
        this.targetViewPart.removeFromThreeParent(parent);
    }
}

export class LayoutSlotStretch3D extends LayoutSlotCenter3D {
    onLayoutChanged() {
        super.onLayoutChanged();
        this.targetViewPart.threeObj.scale.setX(this.node.getComputedWidth() / MUL);
        this.targetViewPart.threeObj.scale.setY(this.node.getComputedHeight() / MUL);
    }
}

export class LayoutSlotText extends LayoutViewPart {
    fromOptions(options) {
        options = {affects: "text", ...options};
        super.fromOptions(options);
        this.targetViewPart = this.owner.parts[options.affects];
        this.subscribe(LayoutEvents.layoutChanged, "onLayoutChanged");
    }

    onLayoutChanged() {
        const targetPos = new THREE.Vector3(
            (this.node.getComputedLeft()) / MUL,
            -1 * (this.node.getComputedTop()) / MUL,
            0
        );

        this.targetViewPart.threeObj.position.copy(targetPos);
        this.targetViewPart.update({
            width: (this.node.getComputedWidth()) / MUL,
            height: (this.node.getComputedHeight()) / MUL,
            anchor: "top"
        });
        //console.log(this.partId, this.node.getComputedLeft(), this.node.getComputedTop(), this.node.getComputedWidth(), this.node.getComputedHeight());
    }

    addToThreeParent(parent) {
        this.targetViewPart.addToThreeParent(parent);
    }

    removeFromThreeParent(parent) {
        this.targetViewPart.removeFromThreeParent(parent);
    }
}
