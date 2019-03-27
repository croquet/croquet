import * as THREE from 'three';
import { defaultCommands, defaultKeyBindings, canonicalize, lookup } from './viewParts/editableText/text-commands.js';

const moduleVersion = `${module.id}#${module.bundle.v||0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let bowser = {}; // we probably use bowser or something to detect the browser

export const KeyboardEvents = {
    keydown: "keyboard-down",
    keyup: "keyboard-up",
    input: "keyboard-input",
    copy: "keyboard-copy",
    cut: "keyboard-cut",
    paste: "keyboard-paste",
    requestfocus: "keyboard-requestFocus"
};

export const KeyboardTopic = "topic-keyboard";

let placeholderValue = "\x01\x01";
let placeholderRe = new RegExp("\x01", "g");

export class KeyboardManager {
    constructor() {
        let options = {};
        this.keepTextNodeFocused = options.hasOwnProperty("keepTextNodeFocused") ? options.keepTextNodeFocused : false;

        this.domState = {
            rootNode: null,
            textareaNode: null,
            eventHandlers: [],
            isInstalled: false
        };

        this.inputState = {
            composition: null,
            manualCopy: null,
            manualPaste: null
        };
    }

    setCurrentRoomView(roomView) {
        this.currentRoomView = roomView;
    }

    dispatchDOMEvent(evt) {
        let view = this.currentRoomView;
        if (!view) {return false;}
        let keyboardView = view.parts["keyboard"];
        if (!keyboardView) {return false;}

        if (evt.constructor === KeyboardEvent) {
            let cEvt = canonicalize.canonicalizeEvent(evt);
            let command = defaultCommands[lookup(cEvt, defaultKeyBindings)];
            if (command) {
                return command.exec(this);
                // it's a bit weird but cut/copy/paste are handled by
                // ClipboardEvent generated when the key event is not handled.
                // so effectively their "text => false" functions are noop
            }
            evt.preventDefault();
            return keyboardView.handleEvent(cEvt);
        }
        // ClipboardEvent
        return keyboardView.handleEvent(evt);
    }

    install(hotreload) {
        let domState = this.domState,
            doc = window.document,
            rootNode = domState.rootNode,
            newRootNode = doc.body;

        if (domState.isInstalled) {
            if (rootNode === window) return null;
            //this.uninstall();
        }

        domState.isInstalled = true;
        domState.rootNode = newRootNode;

        doc.tabIndex = 1; // focusable so that we can relay the focus to the textarea

        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // textarea element that acts as an event proxy

        let textareaNode = domState.textareaNode = doc.createElement("textarea");

        textareaNode.setAttribute("style", "\n      position: absolute;\n      /*extent cannot be 0, input won't work correctly in Chrome 52.0*/\n      width: 20px; height: 20px;\n      z-index: 0;\n      opacity: 0;\n      background: transparent;\n      -moz-appearance: none;\n      appearance: none;\n      border: none;\n      resize: none;\n      outline: none;\n      overflow: hidden;\n      font: inherit;\n      padding: 0 1px;\n      margin: 0 -1px;\n      text-indent: -1em;\n      -ms-user-select: text;\n      -moz-user-select: text;\n      -webkit-user-select: text;\n      user-select: text;\n      /*with pre-line chrome inserts &nbsp; instead of space*/\n      white-space: pre!important;");

        // if (bowser.tablet || bowser.mobile) textareaNode.setAttribute("x-palm-disable-auto-cap", true);  // Need to check if this is what we want, and what is the good way to install

        textareaNode.setAttribute("wrap", "off");
        textareaNode.setAttribute("autocorrect", "off");
        textareaNode.setAttribute("autocapitalize", "off");
        textareaNode.setAttribute("spellcheck", false);
        textareaNode.className = "lively-text-input";
        textareaNode.value = "";
        newRootNode.insertBefore(textareaNode, newRootNode.firstChild);

        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // event handlers
        domState.eventHandlers = [
            { type: "keydown", node: newRootNode,
              fn: evt => this.onRootNodeKeyDown(evt), capturing: false },
            { type: "keyup", node: newRootNode,
              fn: evt => this.onRootNodeKeyUp(evt), capturing: false },
            { type: "focus", node: textareaNode,
              fn: evt => this.focusTextareaNode(), capturing: true },
            { type: "blur", node: textareaNode,
              fn: evt => this.onTextareaBlur(evt), capturing: true },
            //{ type: "keydown", node: textareaNode,
            //fn: evt => this.onTextareaKeyDown(evt), capturing: false },
            //{ type: "keyup", node: textareaNode,
            //fn: evt => this.onTextareaKeyUp(evt), capturing: false },
            { type: "cut", node: textareaNode,
              fn: evt => this.onTextareaCut(evt), capturing: false },
            { type: "copy", node: textareaNode,
              fn: evt => this.onTextareaCopy(evt), capturing: false },
            { type: "paste", node: textareaNode,
              fn: evt => this.onTextareaPaste(evt), capturing: false },
            { type: "compositionstart", node: textareaNode,
              fn: evt => this.onCompositionStart(evt), capturing: false },
            { type: "compositionend", node: textareaNode,
              fn: evt => this.onCompositionEnd(evt), capturing: false },
            { type: "compositionupdate", node: textareaNode,
              fn: evt => this.onCompositionUpdate(evt), capturing: false },
            { type: "input", node: textareaNode,
              fn: evt => this.onTextareaInput(evt), capturing: false }];
        domState.eventHandlers.forEach((ref) => {
            let {type, node, fn, capturing} = ref;
            hotreload.addEventListener(node, type, fn, capturing);
        });
        return this;
    }

    uninstall() {
        let domState = this.domState;
        domState.isInstalled = false;
        domState.eventHandlers.forEach((_ref) => {
            let {type, node, fn, capturing} =_ref;
            return node.removeEventListener(type, fn, capturing);
        });

        let n = domState.textareaNode;
        if (n && n.parentNode) n.parentNode.removeChild(n);
        domState.rootNode = null;
        return this;
    }

    resetValue() {
        let node = this.domState.textareaNode;
        if (node) node.value = placeholderValue;
    }

    readValue() {
        let node = this.domState.textareaNode;
        return node ? node.value.replace(placeholderRe, "") : "";
    }

    focus(obj, room) {
        let node = this.domState.textareaNode;
        if (!node) return;
        if (node.ownerDocument.activeElement !== node) node.focus();

        if (bowser.firefox) {
            // FF needs an extra invitation...
            Promise.resolve().then(() => {
                return node.ownerDocument.activeElement !== node && node.focus();
            });
        }
        if (obj) {
            //this.ensureBeingAtCursorOfText(morph)
        } else if (room) {
            //this.ensureBeingInVisibleBoundsOfWorld(world);
        }
    }

    focusTextareaNode(_morph, _world) {
      return this.focus(_morph, _world);
    }

    focusRootNode(_morph, _world) {
        let node = this.domState.rootNode;
        if (!node) return;
        if (node.ownerDocument.activeElement !== node) node.focus();
    }

    blur() {
        var node = this.domState.textareaNode;
        if (node) node.blur();
    }

    onRootNodeFocus(evt) {
        let textareaNode = this.domState.textareaNode,
            rootNode = this.domState.rootNode;

        if (this.keepTextNodeFocused && (evt.target === textareaNode || evt.target === rootNode)) this.focus();
        this.inputState.composition = null;
    }

    onTextareaBlur(evt) {
        setTimeout(() => {
            let textareaNode = this.domState.textareaNode,
                rootNode = this.domState.rootNode;

            if (rootNode && document.activeElement === rootNode) rootNode && rootNode.focus();
      }, 0);
    }

    onRootNodeKeyUp(evt) {
        this.dispatchDOMEvent(evt);
    }

    onRootNodeKeyDown(evt) {
        this.dispatchDOMEvent(evt);
    }

    onTextareaKeyUp(evt) {
        this.dispatchDOMEvent(evt);
        evt.stopPropagation();
    }

    onTextareaKeyDown(evt) {
        this.dispatchDOMEvent(evt);
        evt.stopPropagation();
    }

    onTextareaInput(evt) {
        if (this.inputState.composition) return;
        // if (!evt.data) {
        //     const data = this.readValue();
        //     //evt.__defineGetter__('data', () => data); // ??
        // }
        this.resetValue();
        this.dispatchDOMEvent(evt);
    }

    onCompositionStart(evt) {
        this.inputState.composition = {};
    }

    onCompositionUpdate(evt) {
        let c = this.inputState.composition,
            val = this.readValue();

        if (c.lastValue === val) return;
        c.lastValue = val;
    }

    onCompositionEnd(evt) {
        this.inputState.composition = null;
    }

    onTextareaPaste(evt) {
        if (this.inputState.manualPaste) {
            this.inputState.manualPaste.onEvent(evt);
        } else {
            this.dispatchDOMEvent(evt);
        }
    }

    onTextareaCopy(evt) {
        if (this.inputState.manualCopy) {
            this.inputState.manualCopy.onEvent(evt);
        } else {
            this.dispatchDOMEvent(evt);
        }
    }

    onTextareaCut(evt) {
        this.dispatchDOMEvent(evt);
    }
}

export let theKeyboardManager = new KeyboardManager();
