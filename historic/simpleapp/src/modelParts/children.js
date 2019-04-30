import { ModelPart } from "../parts";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const ChildEvents = {
    childAdded: "child-added",
    childRemoved: "child-removed",
};

export default class ChildrenPart extends ModelPart {
    init(options, id) {
        super.init(options, id);
        this.children = new Set();
    }

    add(childModel) {
        this.children.add(childModel);
        this.publish(this.id, ChildEvents.childAdded, childModel);
    }

    remove(childModel) {
        this.children.delete(childModel);
        this.publish(this.id, ChildEvents.childRemoved, childModel);
    }
}
