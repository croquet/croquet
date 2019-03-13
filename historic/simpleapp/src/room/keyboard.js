import { ViewPart } from '../view.js';
import { KeyboardEvents, KeyboardTopic } from '../domKeyboardManager.js';

export class KeyboardViewPart extends ViewPart {
    fromOptions(options) {
	this.subscribe(KeyboardEvents.requestfocus, "onRequestFocus", KeyboardTopic, null);
	this.focus = null;
    }

    onRequestFocus(viewId) {
        this.focus = viewId;
    }

    handleEvent(evt) {
	let type = evt.type;
	if (this.focus) {
	    this.publish(KeyboardEvents[type], evt, ...this.focus.requesterRef.split("."));
	}
    }
}
