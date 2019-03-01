import * as THREE from 'three';
import { Node, ALIGN_AUTO, FLEX_DIRECTION_ROW, FLEX_DIRECTION_COLUMN, EDGE_ALL, DIRECTION_LTR } from 'yoga-layout';
import { ViewPart } from '../view.js';

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
        if(this.options.flexDirection) this.node.setFlexDirection(
            this.options.flexDirection === "row" ? FLEX_DIRECTION_ROW : FLEX_DIRECTION_COLUMN
        );
        if(this.options.flex) this.node.setFlex(this.options.flex);
        if(this.options.margin) this.node.setMargin(EDGE_ALL, this.options.margin * MUL);
        if(this.options.padding) this.node.setPadding(EDGE_ALL, this.options.padding * MUL);
        if(this.options.minHeight) this.node.setMinHeight(this.options.minHeight * MUL);
        if(this.options.minWidth) this.node.setMinWidth(this.options.minWidth * MUL);
        if(this.options.alignItems) this.node.setAlignItems(this.options.alignItems);
        if(this.options.alignContent) this.node.setAlignContent(this.options.alignContent);
        if(this.options.alignSelf) this.node.setAlignSelf(this.options.alignSelf);
        if(this.options.justifyContent) this.node.setJustifyContent(this.options.justifyContent);
    }

    detach() {
        this.node.free();
    }
}

export class LayoutContainerViewPart extends LayoutViewPart {
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
        for (let child of this.futureChildren || []) this.addChild(child, false);
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
        this.subscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.owner.id, child.partName);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        child.addToThreeParent(this.group);
    }

    /** @arg {LayoutViewPart} child */
    removeChild(child, publishContentChanged=true) {
        this.children.delete(child);
        this.node.removeChild(child.node);
        this.unsubscribe(LayoutEvents.contentChanged, "onChildContentChanged", child.owner.id, child.partName);
        if (publishContentChanged) this.publish(LayoutEvents.contentChanged, {});
        child.removeFromThreeParent(this.group);
    }

    onChildContentChanged() {
        this.publish(LayoutEvents.contentChanged, {});
    }

    onLayoutChanged() {
        for (let child of this.children) {
            this.publish(LayoutEvents.layoutChanged, {}, child.owner.id, child.partName);
        }
        this.group.position.setX(this.node.getComputedLeft() / MUL);
        this.group.position.setY(this.node.getComputedTop() / MUL);
        console.log(this.partName, this.node.getComputedLeft(), this.node.getComputedTop());
    }
}

export class LayoutRootViewPart extends LayoutContainerViewPart {
    fromOptions(options) {
        options = {
            target: "object3D",
            maxWidth: 10,
            maxHeight: 10,
            alignItems: ALIGN_AUTO,
            ...options
        };
        super.fromOptions(options);
        this.targetViewPart = this.owner.parts[options.target];
    }

    attach(modelState) {
        super.attach(modelState);
        this.addToThreeParent(this.targetViewPart.threeObj);
        this.onChildContentChanged();
    }

    onChildContentChanged() {
        this.node.calculateLayout(null, null, DIRECTION_LTR);
        this.onLayoutChanged();
    }
}

export class CenteredObject3DLayoutViewPart extends LayoutViewPart {
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
    }

    onLayoutChanged() {
        const targetPos = new THREE.Vector3(
            (this.node.getComputedLeft() + 0.5 * this.node.getComputedWidth()) / MUL,
            (this.node.getComputedTop() + 0.5 * this.node.getComputedHeight()) / MUL,
            0
        );

        this.targetViewPart.threeObj.position.copy(targetPos);
    }

    addToThreeParent(parent) {
        this.targetViewPart.addToThreeParent(parent);
    }

    removeFromThreeParent(parent) {
        this.targetViewPart.removeFromThreeParent(parent);
    }
}
