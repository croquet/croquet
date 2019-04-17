import { currentRealm } from "./realms";


const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


export default class View {

    constructor() {
        this.realm = currentRealm();
        this.id = this.realm.register(this);
    }

    detach() {
        this.realm.unsubscribeAll(this.id);
        this.realm.deregister(this);
    }

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

    // Misc

    /** @returns {this} */
    future(tOffset=0) {
        return this.realm.futureProxy(tOffset, this);
    }

    random() {
        return currentRealm().random();
    }

    [Symbol.toPrimitive]() {
        const className = this.constructor.name;
        if (className.includes('View')) return className;
        return `View:${className}`;
    }
}
