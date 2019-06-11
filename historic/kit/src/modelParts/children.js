import { ModelPart } from "../parts";

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
