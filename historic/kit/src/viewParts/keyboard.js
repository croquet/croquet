import { ViewPart } from "../parts";
import { KeyboardEvents, KeyboardTopic, theKeyboardManager } from "../domKeyboardManager";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export class KeyboardViewPart extends ViewPart {
    constructor(model, options) {
        super(model, options);
        this.subscribe(KeyboardTopic, KeyboardEvents.requestfocus, data => this.onRequestFocus(data));
        this.focus = null;
    }

    onRequestFocus(request) {
        this.focus = request.requesterRef;
        theKeyboardManager.focus();
    }

    handleEvent(evt) {
        if (this.focus) {
            this.publish(this.focus, KeyboardEvents[evt.type], evt);
        }
    }
}
