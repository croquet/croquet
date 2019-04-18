import { ViewPart } from "../parts";
import { KeyboardEvents, KeyboardTopic, theKeyboardManager } from "../domKeyboardManager";

export class KeyboardViewPart extends ViewPart {
    constructor(model, options) {
        super(model, options);
        this.subscribe(KeyboardTopic, KeyboardEvents.requestfocus, "onRequestFocus");
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
