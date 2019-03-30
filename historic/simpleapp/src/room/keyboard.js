import { ViewPart } from '../modelView.js';
import { KeyboardEvents, KeyboardTopic } from '../domKeyboardManager.js';

export class KeyboardViewPart extends ViewPart {
    constructor(modelState, options) {
        super(modelState, options);
        this.subscribe(KeyboardEvents.requestfocus, "onRequestFocus", KeyboardTopic, null);
        this.focus = null;
    }

    onRequestFocus(viewId) {
        this.focus = viewId;
    }

    handleEvent(evt) {
        if (this.focus) {
            this.publish(KeyboardEvents[evt.type], evt, ...this.focus.requesterRef.split("."));
        }
    }
}
