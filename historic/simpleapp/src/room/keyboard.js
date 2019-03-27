import { ViewPart } from '../view.js';
import { KeyboardEvents, KeyboardTopic, theKeyboardManager } from '../domKeyboardManager.js';

export class KeyboardViewPart extends ViewPart {
    fromOptions(options) {
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
