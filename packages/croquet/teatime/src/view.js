import { ViewPart } from "./modelView";

export default class View extends ViewPart {
    random() { return Math.random(); }

    publish(scope, event, data) {
        this.realm.publish(event, data, scope);
    }

    subscribe(scope, eventSpec, callback) {
        const {event, oncePerFrame} = eventSpec.event ? eventSpec : {event: eventSpec};
        this.realm.subscribe(event, this.id, callback, scope, oncePerFrame);
    }

    unsubscribe(scope, event) {
        this.realm.unsubscribe(event, this.id, null, scope);
    }
}
