/** THIS WILL REPLACE THE YOGA-BASED LAYOUT.JS SOON-ISH */

import kiwi, { Operator, Constraint } from 'kiwi.js';
import { ViewPart } from "../parts";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const KiwiLayoutEvents = {
    contentChanged: "layout-content-changed",
    layoutChanged: "layout-layout-changed"
};

export class KiwiLayoutNode extends ViewPart {
    constructor() {
        super();
        this.top = new kiwi.Variable();
        this.right = new kiwi.Variable();
        this.bottom = new kiwi.Variable();
        this.left = new kiwi.Variable();
        this.width = new kiwi.Variable();
        this.height = new kiwi.Variable();
        this.center = new kiwi.Variable();
        this.middle = new kiwi.Variable();
        this.widthConstraint = new Constraint(this.left.plus(this.width), Operator.Eq, this.right);
        this.heightConstraint = new Constraint(this.bottom.plus(this.height), Operator.Eq, this.top);
        this.centerConstraint = new Constraint(this.left.plus(this.width.multiply(0.5)), Operator.Eq, this.center);
        this.middleConstraint = new Constraint(this.top.plus(this.height.multiply(0.5)), Operator.Eq, this.middle);
    }

    onAddedToParent(parent) {
        this.parent = parent;
        /** @type {kiwi.Solver} */
        this.solver = parent.solver;

        this.solver.addConstraint(this.widthConstraint);
        this.solver.addConstraint(this.heightConstraint);
        this.solver.addConstraint(this.centerConstraint);
        this.solver.addConstraint(this.middleConstraint);
    }

    onRemovedFromParent() {
        this.solver.removeConstraint(this.widthConstraint);
        this.solver.removeConstraint(this.heightConstraint);
        this.solver.removeConstraint(this.centerConstraint);
        this.solver.removeConstraint(this.middleConstraint);
        this.parent = null;
        this.solver = null;
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
        child.onAddedToParent(this);
        this.subscribe(child.id, KiwiLayoutEvents.contentChanged, data => this.onChildContentChanged(data));
        if (publishContentChanged) this.publish(this.id, KiwiLayoutEvents.contentChanged, {});
        this.group.add(...child.threeObjs());
    }

    /** @arg {KiwiLayoutNode} child */
    removeChild(child, publishContentChanged=true) {
        const idx = this.children.indexOf(child);
        this.children.splice(idx, 1);
        child.onRemovedFromParent(this);
        this.unsubscribe(child.id, KiwiLayoutEvents.contentChanged);
        if (publishContentChanged) this.publish(this.id, KiwiLayoutEvents.contentChanged, {});
        this.group.remove(...child.threeObjs());
    }

    onChildContentChanged() {
        this.publish(this.id, KiwiLayoutEvents.contentChanged, {});
    }

    onLayoutChanged() {
        for (const child of this.children) {
            this.publish(child.id, KiwiLayoutEvents.layoutChanged, {});
        }
    }
}

export class KiwiLayoutRoot extends KiwiLayoutContainer {
    constructor(_options) {
        super();

    }
}
