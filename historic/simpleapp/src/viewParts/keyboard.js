import { ViewPart } from "../modelView";
import { KeyboardEvents, KeyboardTopic, theKeyboardManager } from "../domKeyboardManager";

export class KeyboardViewPart extends ViewPart {
    constructor(model, options) {
        super(model, options);
        this.subscribe(KeyboardEvents.requestfocus, "onRequestFocus", KeyboardTopic, null);
        this.focus = null;
    }

    onRequestFocus(viewId) {
        this.focus = viewId;
        theKeyboardManager.focus();
    }

    handleEvent(evt) {
        if (this.focus) {
            this.publish(KeyboardEvents[evt.type], evt, ...this.focus.requesterRef.split("."));
        }
    }
}
