import {
    Model, View, Session, Data, Constants, App, Messenger, VERSION
} from "./teatime";

export {
    Model, View, Session, Data, Constants, App, Messenger, VERSION
};

const Croquet = {
    Model, View, Session, Data, Constants, App, Messenger, VERSION
};

Model.Croquet = Croquet;
View.Croquet = Croquet;

if (typeof globalThis !== 'undefined') {
    if (globalThis.__CROQUET__) {
        console.warn( 'WARNING: Multiple instances of Croquet being imported.' );
    } else {
        globalThis.__CROQUET__ = VERSION;
    }
}
