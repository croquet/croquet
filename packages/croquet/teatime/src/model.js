import { StatePart, currentRealm } from "../../../arcos/simpleapp/src/modelView";

export default class Model extends StatePart {

    static create(options) {
        const ModelClass = this;
        const model = new ModelClass();
        model.init(options);
        model.start();
        return model;
    }

    random() { return currentRealm().random(); }

    load(state, allObjects) {
        super.applyState(state, allObjects);
    }

    save(state) {
        super.toState(state);
    }

    start() { }

    publish(scope, event, data) {
        this.realm.publish(event, data, scope);
    }

    subscribe(scope, event, callback) {
        this.realm.subscribe(event, this.id, callback, scope);
    }

    unsubscribe(scope, event) {
        this.realm.unsubscribe(event, this.id, null, scope);
    }


    // old protocol

    applyState() {}

    toState(state) { this.save(state); }

    restore(state, allObjects) {
        this.load(state, allObjects);
    }

    onInitialized(is_new) {
        if (!is_new) this.start();
    }
}
