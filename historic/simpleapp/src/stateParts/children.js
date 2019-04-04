import { StatePart } from "../modelView.js";

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const ChildEvents = {
    childAdded: "child-added",
    childRemoved: "child-removed",
};

export default class ChildrenPart extends StatePart {
    applyState(state={}, topLevelPartsById) {
        if (state.children) {
            this.children = new Set(state.children.map(id => topLevelPartsById[id]));
        } else {
            this.children = new Set();
        }
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
