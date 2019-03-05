import { ModelPart } from "../model.js";

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

export const ChildEvents = {
    childAdded: "child-added",
    childRemoved: "child-removed",
};

export default class ChildrenPart extends ModelPart {
    fromState(_state, _options) {
        this.children = new Set();
    }

    restoreObjectReferences(state, objectsByID) {
        this.children = new Set(state.children.map(id => objectsByID[id]));
    }

    toState(state) {
        state.children = [...this.children].map(childModel => childModel.id);
    }

    add(childModel) {
        this.children.add(childModel);
        this.publish(ChildEvents.childAdded, childModel);
    }

    remove(childModel) {
        this.children.delete(childModel);
        this.publish(ChildEvents.childRemoved, childModel);
    }
}
