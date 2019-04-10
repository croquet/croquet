import { StatePart, ViewPart, currentRealm, inViewRealm } from "../../arcos/simpleapp/src/modelView.js";
import Island, { connectToReflector, Controller as OldController, addMessageTranscoder } from "../../arcos/simpleapp/src/island.js";

class Model extends StatePart {
    random() { return currentRealm().random(); }
}

class View extends ViewPart {
    random() { return currentRealm().random(); }
}

class Controller extends OldController {
    static addMessageTranscoder(...args) { addMessageTranscoder(...args); }
    static connectToReflector(...args) { connectToReflector(...args); }
    static inViewRealm(...args) { inViewRealm(...args); }

    async createIsland(name, creator) {
        return (await super.createIsland(name, {
            ...creator,
            creatorFn: snapshot => new Island(snapshot, island => {
                const namedModels = creator.creatorFn();
                for (const [key, model] of Object.entries(namedModels)) {
                    island.set(key, model);
                }
            })
        })).modelsByName;
    }

    inViewRealm(fn) {
        return inViewRealm(this.island, () => fn(this.island));
    }

    processModelViewEvents() {
        this.island.processModelViewEvents();
    }
}

export {
    Model,
    View,
    Controller,
};
