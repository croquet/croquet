import { ViewPart } from "../../arcos/simpleapp/src/modelView.js";

export default class View extends ViewPart {
    random() { return Math.random(); }

    publish(eventSpec, data) {
        const {event, scope} = this.defaultEventSpecFor(eventSpec);
        this.realm.publish(event, data, scope);
    }

    subscribe(eventSpec, callback) {
        const {event, scope, oncePerFrame} = this.defaultEventSpecFor(eventSpec);
        this.realm.subscribe(event, this.id, callback, scope, oncePerFrame);
    }

    unsubscribe(eventSpec) {
        const {event, scope} = this.defaultEventSpecFor(eventSpec);
        this.realm.unsubscribe(event, this.id, null, scope);
    }

    defaultEventSpecFor(event) {
        const eventSpec = typeof event !== "string" ? event : { event };
        if (eventSpec.scope) return eventSpec;
        return {...eventSpec, scope: this.defaultScope || "global"};
    }

}
