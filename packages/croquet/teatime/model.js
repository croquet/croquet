import { StatePart, currentRealm } from "../../arcos/simpleapp/src/modelView";

export default class Model extends StatePart {
    random() { return currentRealm().random(); }

    publish(eventSpec, data) {
        const {event, scope} = this.defaultEventSpecFor(eventSpec);
        this.realm.publish(event, data, scope);
    }

    subscribe(eventSpec, callback) {
        const {event, scope} = this.defaultEventSpecFor(eventSpec);
        this.realm.subscribe(event, this.id, callback, scope);
    }

    unsubscribe(eventSpec) {
        const {event, scope} = this.defaultEventSpecFor(eventSpec);
        this.realm.unsubscribe(event, this.id, null, scope);
    }

    defaultEventSpecFor(event) {
        const eventSpec = typeof event !== "string" ? event : { event };
        if (eventSpec.scope) return eventSpec;
        return {...eventSpec, scope: this.defaultScope || this.id};
    }
}
