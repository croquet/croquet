import { ModelComponent } from "../model";

export const ChildEvents = {
    childAdded: "child-added",
    childRemoved: "child-removed",
};

export default class ModelChildrenComponent extends ModelComponent {
    constructor(owner, componentName="children") {
        super(owner, componentName);
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
        this.children.remove(childModel);
        this.publish(ChildEvents.childRemoved, childModel);
    }
}