/** THIS WILL REPLACE THE YOGA-BASED LAYOUT.JS SOON-ISH */

import kiwi, { Operator, Constraint } from 'kiwi.js';
import { ViewPart } from "../modelView";

export const KiwiLayoutEvents = {
    contentChanged: "layout-content-changed",
    layoutChanged: "layout-layout-changed"
};

export class KiwiLayoutNode extends ViewPart {
    constructor() {
        super();
        this.left = new kiwi.Variable();
        this.right = new kiwi.Variable();
        this.width = new kiwi.Variable();
        this.bottom = new kiwi.Variable();
        this.top = new kiwi.Variable();
        this.height = new kiwi.Variable();
    }

    onAddedToParent(parent) {
        this.parent = parent;
        /** @type {kiwi.Solver} */
        this.solver = parent.solver;

        this.solver.addConstraint(new Constraint(this.left.plus(this.width), Operator.Eq, this.right));
        this.solver.addConstraint(new Constraint(this.bottom.plus(this.height), Operator.Eq, this.top));
    }
}

export class KiwiLayoutContainer extends KiwiLayoutNode {
    constructor(options) {
        super();
        this.children = options.children;
    }

    onAddedToParent(parent) {
        super.onAddedToParent(parent);
    }

    /** @arg {KiwiLayoutNode} child */
    addChild(child, publishContentChanged=true) {
        this.children.push(child);
        this.subscribe(KiwiLayoutEvents.contentChanged, "onChildContentChanged", child.id);
        if (publishContentChanged) this.publish(KiwiLayoutEvents.contentChanged, {});
        this.group.add(...child.threeObjs());
    }

    /** @arg {KiwiLayoutNode} child */
    removeChild(child, publishContentChanged=true) {
        const idx = this.children.indexOf(child);
        this.children.splice(idx, 1);
        this.yogaNode.removeChild(child.yogaNode);
        this.unsubscribe(KiwiLayoutEvents.contentChanged, "onChildContentChanged", child.id);
        if (publishContentChanged) this.publish(KiwiLayoutEvents.contentChanged, {});
        this.group.remove(...child.threeObjs());
    }

    onChildContentChanged() {
        this.publish(KiwiLayoutEvents.contentChanged, {});
    }

    onLayoutChanged() {
        for (const child of this.children) {
            this.publish(KiwiLayoutEvents.layoutChanged, {}, child.id);
        }
    }
}
