import { ViewPart } from '../view.js';

export default class KeyboardViewPart extends ViewPart {
    fromOptions(options) {
        options = {textPartName: "text", ...options};
        this.textPart = this.owner.parts[options.textPartName];
    }

    onKeyDown(evt) {
    }

    onKeyUp(evt) {
    }

    onInput(evt) {
    }
}
