import { StatePart, currentRealm } from "../../arcos/simpleapp/src/modelView";

export default class Model extends StatePart {
    random() { return currentRealm().random(); }

    publish(scope, event, data) {
        this.realm.publish(event, data, scope);
    }

    subscribe(scope, event, callback) {
        this.realm.subscribe(event, this.id, callback, scope);
    }

    unsubscribe(scope, event) {
        this.realm.unsubscribe(event, this.id, null, scope);
    }
}
