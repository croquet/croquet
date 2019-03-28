// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// helper

function comparePosition(pos1, pos2) {
  // pos1.row < pos2.row = -2
  // pos1.row = pos2.row and pos1.column < pos2.column  = -1
  // pos1 = pos2  = 0
  // pos1.row = pos2.row and pos1.column > pos2.column  = 1
  // pos1.row > pos2.row = 2
  let {row, column} = pos1,
      {row: row2, column: column2} = pos2;
  if (row < row2) return -2;
  if (row === row2) {
    if (column < column2) return -1;
    if (column === column2) return 0;
    return 1;
  }
  return 2;
}

function eqPosition(p1, p2) {
  return comparePosition(p1, p2) === 0;
}

function maybeSelectCommentOrLine(morph) {
  // Dan's famous selection behvior! Here it goes...
  /*   If you click to the right of '//' in the following...
  'wrong' // 'try this'.slice(4)  //should print 'this'
  'http://zork'.slice(7)          //should print 'zork'
  */
  // If click is in comment, just select that part
  var sel = morph.selection,
      {row, column} = sel.lead,
      text = morph.selectionOrLineString();

  if (!sel.isEmpty()) return;

  // text now equals the text of the current line, now look for JS comment
  var idx = text.indexOf('//');
  if (idx === -1                          // Didn't find '//' comment
      || column < idx                 // the click was before the comment
      || (idx>0 && (':"'+"'").indexOf(text[idx-1]) >=0)    // weird cases
      ) { morph.selectLine(row); return }

  // Select and return the text between the comment slashes and end of method
  sel.range = {start: {row, column: idx + 2}, end: {row, column: text.length}};
}

function doEval(morph, range, additionalOpts, code) {
  if (!range)
    range = morph.selection.isEmpty() ? morph.lineRange() : morph.selection.range;
  if (!code)
    code = morph.textInRange(range)
  // eval code here
}


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// commands

let textCommands = {
    "clipboard copy": {
        doc: "placeholder for native copy",
        exec: text => false
    },

    "clipboard cut": {
        doc: "placeholder for native cut",
        exec: text => false
    },

    "clipboard paste": {
        doc: "placeholder for native paste",
        exec: text => false
    },
};

let jsEditorCommands = {
    "doit": {
        doc: "Evaluates the selected code or the current line and report the result",
        exec: async (text, opts, count = 1) => {
            maybeSelectCommentOrLine(text);
            let result, err;
            try {
                opts = Object.assign({}, opts, {inspect: true, inspectDepth: count});
                result = await doEval(text, undefined, opts);
                err = result.isError ? result.value : null;
            } catch (e) { err = e; }
            if (err) console.log('**' + err);
            return result;
        }
    },

    "printit": {
        doc: "Evaluates selected code or the current line and inserts the result in a printed representation",
        exec: async (text, opts) => {
            // opts = {targetModule}
            maybeSelectCommentOrLine(text);
            let result, err;
            try {
                opts = Object.assign({}, opts, {asString: true});
                result = await doEval(text, undefined, opts);
                err = result.isError ? result.value : null;
            } catch (e) { err = e; }
            text.selection.collapseToEnd();
            text.insertTextAndSelect(err ?
                                     String(err) + (err.stack ? "\n" + err.stack : "") :
                                     String(result.value));
            return result;
        }
    },

    "save": {
        doc: "Saves...",
        handlesCount: true,
        exec: async (text, opts, count = 1) => {
            //if (morph.saveTextToModel) return morph.saveTextToModel();
            //const container = morph.getContainer();
            //console.log(`container is a ${container.constructor}`)
            //if (container && container.save) return container.save();
            // The following line makes ‘save’ work in the TSystemBrowser,
            // but it should be handled by a better route than tParent
            //if (morph.tParent && morph.tParent.save) return morph.tParent.save();
            console.log("this text doesn't know how to save");
            return true;
        }
    }
};

export const defaultCommands = Object.assign({}, textCommands, jsEditorCommands);

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// keybindings

export const defaultKeyBindings = [
  {keys: {mac: 'Meta-C', win: 'Ctrl-C'}, command: "clipboard copy"},
  {keys: {mac: 'Meta-X', win: 'Ctrl-X'}, command: "clipboard cut"},
  {keys: {mac: 'Meta-V', win: 'Ctrl-V'}, command: "clipboard paste"},

  {keys: {mac: 'Meta-Z', win: 'Ctrl-Z'}, command: "text undo"},
  //{keys: {mac: 'Meta-Shift-Z', win: 'Ctrl-Shift-Z'}, command: "text redo"},

  {keys: {mac: 'Meta-D', win:  'Ctrl-D'}, command: "doit"},
  {keys: {mac: 'Meta-P', win: 'Ctrl-P'}, command: "printit"},
  {keys: {mac: 'Meta-S', win: 'Ctrl-S'}, command: "save"},
];

export function lookup(evt, bindings) {
    for (let i = 0; i < bindings.length; i++) {
        let b = bindings[i];
        let keys = b.keys;
        // use bowser for real
        for (let k in keys) {
            if (keys[k] === evt.keyCombo) {
                return b.command;
            }
        }
    }
    return null;
}

function computeHashIdOfEvent(evt) {
    let letterRe = /[a-z]/i;

    let key = evt.key,
        ctrlKey = evt.ctrlKey,
        altKey = evt.altKey,
        shiftKey = evt.shiftKey,
        metaKey = evt.metaKey,
        hashId = 0 | (ctrlKey ? 1 : 0) | (altKey ? 2 : 0) | (shiftKey ? 4 : 0) | (metaKey ? 8 : 0);

    if (hashId === 0 && !canonicalizeFunctionKey(key) && key && letterRe.test(key)) hashId = -1;
  return hashId;
}

let KEY_MODS = (function () {
    let base = {
        "control": 1, "ctrl": 1, "alt": 2, "option": 2, "shift": 4,
        "super": 8, "win": 8, "meta": 8, "command": 8, "cmd": 8
    };

    let mods = ["alt", "ctrl", "meta", "shift"];
    for (let i = 2 ** mods.length; i--;) {
        base[i] = mods.filter(x => i & base[x]).join("-") + "-";
    }
    base[0] = "";
    base[-1] = "input-";

  return base;
})();

let isNumber = function (key) {
    return /^[0-9]+$/.test(key);
};


function isModifier(key) {
    if (isNumber(key)) return false;
    key = key.replace(/-$/, "").toLowerCase();

    return KEY_MODS.hasOwnProperty(key);
}

let FUNCTION_KEYS = [
    "backspace", "tab", "enter", "pause", "escape", " ", "pageup", "pagedown", "end", "home", "left", "up", "right", "down", "print", "insert", "delete", "numpad0", "numpad1", "numpad2", "numpad3", "numpad4", "numpad5", "numpad6", "numpad7", "numpad8", "numpad9", "numpadenter", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "numlock", "scrolllock"];

function canonicalizeFunctionKey(key) {
    key = key.toLowerCase();
    switch (key) {
    case 'space':
        key = "space";
        break;
    case 'esc':
        key = "escape";
        break;
    case 'return':
        key = "enter";
        break;
    case 'arrowleft':
        key = "left";
        break;
    case 'arrowright':
        key = "right";
        break;
    case 'arrowup':
        key = "up";
        break;
    case 'arrowdown':
        key = "down";
        break;
    default:
        break;
    }

    if (FUNCTION_KEYS.includes(key)) {
        return key[0].toUpperCase() + key.slice(1);
    }
    return "";
}

function decodeKeyIdentifier(identifier, keyCode) {
    // trying to find out what the String representation of the key pressed
    // in key event is.
    // Uses keyIdentifier which can be Unicode like "U+0021"

    let id = identifier,
        unicodeDecodeRe = /u\+?([\d\w]{4})/gi,
        unicodeReplacer = (match, grp) => {
            return String.fromCharCode(parseInt(grp, 16));
        },
    key = id && id.replace(unicodeDecodeRe, unicodeReplacer);

    if (key === 'Command' || key === 'Cmd') key = "Meta";
    if (key === ' ') key = "Space";
    if (keyCode === 8 /*KEY_BACKSPACE*/) key = "Backspace";
    return key;
}

function identifyKeyFromCode(evt) {
    let code = evt.code;

    // works on Chrome and Safari
    // https://developer.mozilla.org/en/docs/Web/API/KeyboardEvent/code
    // For certain inputs evt.key or keyCode will return the inserted char, not
    // the key pressed. For keybindings it is nicer to have the actual key,
    // however

    if (typeof code !== "string") return null;

    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Numpad")) return code;
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Arrow")) return code.slice(5);
    if (code.match(/^F[0-9]{1-2}$/)) return code;

    switch (code) {
    case "Insert":
    case "Home":
    case "PageUp":
    case "PageDown":
        return code;
    case 'Period':
        return ".";
    case 'Comma':
        return ",";
    case 'Help':
        return "Insert";
    case 'Equal':
        return "=";
    case 'Backslash':
    case 'IntlBackslash':
        return "\\";
    case 'Equal':
        return "=";
    case "Minus":
        return "-";
    case "BracketRight":
        return "]";
    case "BracketLeft":
        return "[";
    case "Quote":
        return "'";
    case 'Backquote':
        return "`";
    case 'Semicolon':
        return ";";
    default:
        return null;
    }
}

function dedasherize(keyCombo) {
    // splits string like Meta-x or Ctrl-- into its parts
    // dedasherize("Ctrl--") => ["Ctrl", "-"]
    let parts = [];
    while (true) {
        let idx = keyCombo.indexOf("-");
        if (idx === -1) {
            if (keyCombo) parts.push(keyCombo);
            return parts;
        }
        if (idx === 0) {
            parts.push(keyCombo[0]);
            keyCombo = keyCombo.slice(2);
        } else {
            parts.push(keyCombo.slice(0, idx));
            keyCombo = keyCombo.slice(idx + 1);
        }
    }
}

function keyComboToEventSpec(keyCombo, evt) {
    // 1. create a key event object. We first gather what properties need to be
    // passed to the event creator in terms of the keyboard state

    let spec = {
        keyCombo: "",
        key: '',
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        altGraphKey: false,
        isFunctionKey: false,
        isModified: false,
        onlyModifiers: false,
        onlyShiftModifier: null,
        type: evt.type,
        keyCode: evt.keyCode
    };

    // 2. Are any modifier keys pressed?
    let keyMods = dedasherize(keyCombo),
        modsToEvent = {
            shift: "shiftKey",
            control: "ctrlKey",
            ctrl: "ctrlKey",
            alt: "altKey",
            meta: "metaKey",
            command: "metaKey",
            cmd: "metaKey",
        };

    if (keyMods[0] === "input" && keyMods.length === 2) {
        spec.keyCombo = keyCombo;
        spec.key = keyMods[1];
        return spec;
    }

    for (let i = keyMods.length - 1; i >= 0; i--) {
        let mod = keyMods[i],
            modEventFlag = modsToEvent[mod.toLowerCase()];
        if (!modEventFlag) continue;
        if (spec.onlyShiftModifier === null) {
            spec.onlyShiftModifier = mod === "Shift";
        }
        keyMods.splice(i, 1);
        spec.isModified = true;
        spec[modEventFlag] = true;
    }

    // only modifiers
    if (!keyMods.length) {
        let combo = eventToKeyCombo(spec);
        let dedash = dedasherize(combo);
        spec.keyCombo = combo;
        spec.key = dedash[dedash.length - 1];
        spec.onlyModifiers = true;
        return spec;
    }

    if (keyMods.length > 1) {
        console.warn("Strange key \"" + keyCombo + "\" encountered in keyComboToEventSpec, parsing probably failed");
    }

    let trailing = keyMods[keyMods.length-1];

    // 3. determine the key code and key string of the event.
    let fnKey = canonicalizeFunctionKey(trailing);
    if (fnKey) {
        spec.isFunctionKey = true;
        spec.key = fnKey;
    } else if (spec.isModified) {
        if (spec.onlyShiftModifier) {
            spec.key = evt.key;
        } else {
            spec.key = trailing[0].toUpperCase() + trailing.slice(1);
        }
    } else {
        spec.key = trailing;
    }

    spec.keyCombo = eventToKeyCombo(spec);
    return spec;
}

function eventToKeyCombo(evt, options) {
    // var evt = Keys.keyComboToEventSpec("Enter")
    // var evt = {type: "keydown", keyIdentifier: "Meta"}
    // Keys.eventToKeyCombo(x)
    // stringify event to a key or key combo
    let key = evt.key,
        data = evt.data,
        keyIdentifier = evt.keyIdentifier;

    // deal with input events: They are considered coming from verbatim key
    // presses which might not be real but we maintain the data this way

    if (typeof data === "string") return "input-" + data;

    // fallback to keyIdentifier for Safari...
    if (!key && keyIdentifier) {
      key = decodeKeyIdentifier(keyIdentifier, evt.which || evt.keyCode);
      evt.key = key = key[evt.shiftKey ? "toUpperCase" : "toLowerCase"]();
      if (isModifier(key)) return key[0].toUpperCase() + key.slice(1);
    }

    let mod = KEY_MODS[computeHashIdOfEvent(evt)];

    if (mod === "input-") return mod + key;

    if (evt.code) key = identifyKeyFromCode(evt) || key;

    let keyCombo = !key || isModifier(key) ? mod.replace(/-$/, "") : mod + key;

    if (keyCombo.match(/\s$/)) keyCombo = keyCombo.replace(/\s$/, "Space");

    // I don't know what this is
    return keyCombo.replace(/(^|-)([a-z])/g,
                            (_, start, char) => start + char.toUpperCase());
}

export let canonicalize = {
    canonicalizeEvent: function canonicalizeEvent(evt) {
        return keyComboToEventSpec(eventToKeyCombo(evt), evt);
    }
};
