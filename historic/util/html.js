import Toastify from 'toastify-js';
import SeedRandom from "seedrandom/seedrandom";
import QRCode from "./thirdparty-patched/qrcodejs/qrcode";
import urlOptions from "./urlOptions";
import { makeStats } from "./stats";


const TOUCH = 'ontouchstart' in document.documentElement;
const BAR_PROPORTION = 18; // height of dock, in % of content size
const BUTTON_RIGHT = 2; // %
const BUTTON_WIDTH = TOUCH ? 20 : 12; // %
const BUTTON_SEPARATION = 2; // %
const BUTTON_OFFSET = TOUCH ? 0 : 15; // extra % from the right
const CONTENT_MARGIN = 2; // px
const TRANSITION_TIME = 0.3; // seconds

// add style for the standard widgets that can appear on a Croquet page
function addWidgetStyle() {
    const widgetCSS = `
        #croquet_dock { position: absolute; z-index: 2; border: 3px solid white; bottom: 6px; left: 6px; width: 84px; height: 36px; box-sizing: border-box; background: white; opacity: 0.4; transition: all ${TRANSITION_TIME}s ease; }
        #croquet_dock.active { opacity: 0.95; border-radius: 12px; }
        #croquet_dock_bar { position: absolute; border: 3px solid white; width: 100%; height: 30px; box-sizing: border-box; background: white; }

        #croquet_badge { position: absolute; width: 72px; height: 24px; top: 50%; transform: translate(0px, -50%); cursor: none; }
        #croquet_dock.active #croquet_badge { left: 2%; }

        .croquet_dock_button { position: absolute; width: ${BUTTON_WIDTH}%; height: 90%; top: 50%; transform: translate(0px, -50%); border-radius: 20%; }
        .croquet_dock_button:focus { outline: 0; }
        .croquet_dock_button canvas { position: absolute; width: 100%; height: 100%; top: 0px; left: 0px; }
        #croquet_dock:not(.active) .croquet_dock_button { display: none; }
        #croquet_dock_left { right: ${BUTTON_RIGHT + BUTTON_OFFSET + BUTTON_WIDTH + BUTTON_SEPARATION}% }
        #croquet_dock_right { right: ${BUTTON_RIGHT + BUTTON_OFFSET}%; }
        #croquet_dock_pin { right: ${BUTTON_RIGHT}%; }
        #croquet_dock_pin.pinned { background: #cce6ff; }

        #croquet_dock_content { position: absolute; left: ${CONTENT_MARGIN}px; top: ${CONTENT_MARGIN}px; right: ${CONTENT_MARGIN}px; bottom: ${CONTENT_MARGIN}px; background: white; }
        #croquet_dock:not(.active) #croquet_dock_content { display: none; }
        #croquet_dock:not(.active) #croquet_dock_content div { display: none; }

        #croquet_qrcode { position: absolute; border: 6px solid white; width: 100%; height: 100%;box-sizing: border-box; cursor: crosshair; }
        #croquet_qrcode:not(.active) { display: none; }
        #croquet_qrcode canvas { image-rendering: pixelated; }

        #croquet_stats { position: absolute; width: 70%; height: 90%; left: 15%; top: 5%; opacity: 0.8; font-family: sans-serif; }
        #croquet_stats:not(.active) { display: none; }

        #croquet_spinnerOverlay {
            z-index: 1000;
            position: fixed;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color:#333;
            opacity:0.9;
            display:flex;
            align-items:center;
            justify-content:center;
            transition: opacity 1.0s ease-out;
        }
        /* https://github.com/lukehaas/css-loaders */
        @keyframes dots {
            0%, 80%, 100% { box-shadow: 0 2.5em 0 -1.3em; }
            40% { box-shadow: 0 2.5em 0 0; }
        }
        #croquet_loader,
        #croquet_loader:before,
        #croquet_loader:after {
          border-radius: 50%;
          width: 2.5em;
          height: 2.5em;
          animation: dots 1.8s infinite ease-in-out;
        }
        #croquet_loader {
          color: #fff;
          font-size: 10px;
          margin: 80px auto;
          position: relative;
          text-indent: -9999em;
          animation-delay: -0.16s;
        }
        #croquet_loader:before,
        #croquet_loader:after {
          content: '';
          position: absolute;
          top: 0;
        }
        #croquet_loader:before { left: -3.5em; animation-delay: -0.32s; }
        #croquet_loader:after { left: 3.5em; }
`;
    const widgetStyle = document.createElement("style");
    widgetStyle.innerHTML = widgetCSS;
    document.head.insertBefore(widgetStyle, document.head.getElementsByTagName("style")[0]);
}
addWidgetStyle();

function addToastifyStyle() {
    // inject toastify's standard css
    let toastifyCSS = `/*!
        * Toastify js 1.5.0
        * https://github.com/apvarun/toastify-js
        * @license MIT licensed
        *
        * Copyright (C) 2018 Varun A P
        */
        .toastify {
            padding: 12px 20px;
            color: #ffffff;
            display: inline-block;
            box-shadow: 0 3px 6px -1px rgba(0, 0, 0, 0.12), 0 10px 36px -4px rgba(77, 96, 232, 0.3);
            background: -webkit-linear-gradient(315deg, #73a5ff, #5477f5);
            background: linear-gradient(135deg, #73a5ff, #5477f5);
            position: fixed;
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.215, 0.61, 0.355, 1);
            border-radius: 2px;
            cursor: pointer;
            text-decoration: none;
            max-width: calc(50% - 20px);
            z-index: 2147483647;
        }
        .toastify.on {
            opacity: 1;
        }
        .toast-close {
            opacity: 0.4;
            padding: 0 5px;
        }
        .toastify-right {
            right: 15px;
        }
        .toastify-left {
            left: 15px;
        }
        .toastify-top {
            top: -150px;
        }
        .toastify-bottom {
            bottom: -150px;
        }
        .toastify-rounded {
            border-radius: 25px;
        }
        .toastify-avatar {
            width: 1.5em;
            height: 1.5em;
            margin: 0 5px;
            border-radius: 2px;
        }
        @media only screen and (max-width: 360px) {
            .toastify-right, .toastify-left {
                margin-left: auto;
                margin-right: auto;
                left: 0;
                right: 0;
                max-width: fit-content;
            }
        }
`;
    // add our own preferences
    toastifyCSS += `
        .toastify { font-family: sans-serif; border-radius: 8px; }
`;
    const toastifyStyle = document.createElement("style");
    toastifyStyle.innerHTML = toastifyCSS;
    document.head.insertBefore(toastifyStyle, document.head.getElementsByTagName("style")[0]);
}
addToastifyStyle();

const seenMessages = new Set();

// this is the default App.messageFunction
export function showMessageAsToast(msg, options = {}) {
    if (options.only === "once") {
        if (seenMessages.has(msg)) return null;
        seenMessages.add(msg);
    }
    const level = options.level;
    let color;
    if (level === 'error') { color = 'red'; console.error(msg); }
    else if (level === 'warning') { color = 'gold'; console.warn(msg); }
    else color = '#aaa';

    return displayToast(msg, { backgroundColor: color, ...options });
}

export function displayError(msg, options={}) {
    return msg && App.showMessage(msg, { ...options, level: 'error' });
}

export function displayWarning(msg, options={}) {
    return msg && App.showMessage(msg, { ...options, level: 'warning' });
}

export function displayStatus(msg, options={}) {
    return msg && App.showMessage(msg, { ...options, level: 'status' });
}

export function displayAppError(where, error) {
    console.error(`Error during ${where}`, error);
    const userStack = (error.stack || '').split("\n").filter(l => !l.match(/croquet-.*\.min.js/)).join('\n');
    App.showMessage(`<b>Error during ${where}: ${error.message}</b>\n\n${userStack}`.replace(/\n/g, "<br>"),  {
        level: 'error',
        duration: 10000,
        stopOnFocus: true,
    });
}

function displayToast(msg, options) {
    const parentDef = App.root;
    if (parentDef === false) return null;

    const toastOpts = {
        text: msg,
        duration: 3000,
        //close: true,
        gravity: 'bottom', // `top` or `bottom`
        position: 'left', // `left`, `center` or `right`
        backgroundColor: 'linear-gradient(to right, #00b09b, #96c93d)',
        stopOnFocus: true, // Prevents dismissing of toast on hover
        ...options };

    let selector;
    if (parentDef instanceof Element && parentDef !== document.body) {
        // toastify needs an id, not an element.  if the element has no id, give it one.
        selector = parentDef.id;
        if (!selector) parentDef.id = selector = '_croquetToastParent';
    } else if (typeof parentDef === 'string') selector = parentDef;
    // else fall through with no selector (so body will be used as parent)

    if (selector) toastOpts.selector = selector;

    return Toastify(toastOpts).showToast();
}

function monikerForId(id) {
    // random page title suffix
    const random = new SeedRandom(id);
    const letters = ['bcdfghjklmnpqrstvwxyz', 'aeiou'];
    let moniker = '';
    for (let i = 0; i < 5; i++) moniker += letters[i % 2][random.quick() * letters[i % 2].length | 0];
    return moniker;
}

function colorsForId(id, n=1) {
    const random = new SeedRandom(id);
    const colors = [];
    for (let i=0; i<n; i++) colors.push(`hsl(${random.quick() * 360}, 50%, 70%)`);
    return colors;
}

function clearSessionMoniker() {
    if (App.badge === false) return; // we have reason to believe the moniker was never set (so don't mess with a title that might be being used to show something else)

    document.title = document.title.replace(/:.*/, '');
}

const dockState = {
    get pinned() { return localStorage['croquet-debug-ui-pinned'] === "true"; },
    set pinned(bool) { localStorage['croquet-debug-ui-pinned'] = !!bool; },
    get activePage() { return localStorage['croquet-debug-ui-activePage']; },
    set activePage(id) { localStorage['croquet-debug-ui-activePage'] = id; },
};

// an app can call App.makeWidgetDock with options specifying which of the widgets to include
// in the dock.  by default, widgets badge, qrcode, stats are shown; turn off by setting
// corresponding options property to false.
function makeWidgetDock(options = {}) {
    if (urlOptions.nodock) return;

    const oldDockDiv = document.getElementById('croquet_dock');
    if (oldDockDiv) oldDockDiv.parentElement.removeChild(oldDockDiv);

    const dockParent = findElement(App.root);
    if (!dockParent) return;

    const dockDiv = document.createElement('div');
    dockDiv.id = 'croquet_dock';
    dockParent.appendChild(dockDiv);

    const barDiv = document.createElement('div');
    barDiv.id = 'croquet_dock_bar';
    dockDiv.appendChild(barDiv);

    let badgeDiv;
    if (options.badge !== false) {
        badgeDiv = document.createElement('div');
        badgeDiv.id = 'croquet_badge';
        barDiv.appendChild(badgeDiv);
        App.badge = badgeDiv;
    }

    const contentDiv = document.createElement('div');
    contentDiv.id = 'croquet_dock_content';
    dockDiv.appendChild(contentDiv);

    const dockPageIds = []; // an ordered collection of available page (i.e., element) ids

    let qrDiv;
    if (options.qrcode !== false) {
        const url = App.sessionURL;
        if (url) {
            qrDiv = document.createElement('div');
            qrDiv.id = 'croquet_qrcode';
            contentDiv.appendChild(qrDiv);
            dockPageIds.push(qrDiv.id);
            App.qrcode = qrDiv;
        }
    }

    let statsDiv;
    if (options.stats !== false) {
        statsDiv = document.createElement('div');
        statsDiv.id = 'croquet_stats';
        contentDiv.appendChild(statsDiv);
        dockPageIds.push(statsDiv.id);
        App.stats = statsDiv;
    }

    if (dockPageIds.length) {
        function shiftPage(dir) {
            const numPages = dockPageIds.length;
            // on reconnect it's possible that a previously selected page is no longer available.
            // if so, or if no page has been selected yet, act as if the first was.
            let oldIndex = 0, oldElem;
            if (dockState.activePage) {
                const index = dockPageIds.indexOf(dockState.activePage);
                if (index >= 0) {
                    oldIndex = index;
                    oldElem = document.getElementById(dockState.activePage);
                } else dockState.activePage = null;
            }
            const newIndex = (oldIndex + numPages + dir) % numPages, newPage = dockPageIds[newIndex];
            let newElem;
            if (newPage === dockState.activePage) newElem = oldElem;
            else {
                if (oldElem) oldElem.classList.remove('active');
                newElem = document.getElementById(newPage);
            }
            if (newElem) newElem.classList.add('active');

            dockState.activePage = newPage;
        }

        if (dockPageIds.length > 1) {
            barDiv.appendChild(makeButton('<', 'croquet_dock_left', () => shiftPage(-1)));
            barDiv.appendChild(makeButton('>', 'croquet_dock_right', () => shiftPage(1)));
        }

        shiftPage(0); // set up a starting page (or re-select, if already set)
    }

    if (!TOUCH) {
        const pinButton = makeButton('📌', 'croquet_dock_pin', () => {
            dockState.pinned = !dockState.pinned;
            setPinState();
            });
        const setPinState = () => { if (dockState.pinned) pinButton.classList.add('pinned'); else pinButton.classList.remove('pinned'); };
        setPinState();
        barDiv.appendChild(pinButton);
    }

    const expandedSize = 200;
    const minExpandedSize = 166;
    const expandedBorder = 8;
    const setCustomSize = sz => {
        dockDiv.style.width = `${sz}px`;
        dockDiv.style.height = `${sz * (1 + BAR_PROPORTION/100)}px`;

        const barHeight = sz * BAR_PROPORTION/100;
        barDiv.style.height = `${barHeight}px`;
        contentDiv.style.top = `${barHeight + CONTENT_MARGIN}px`;

        if (badgeDiv) {
            badgeDiv.style.height = `${barHeight * 0.9}px`;
            badgeDiv.style.width = `${barHeight * 0.9 * 3}px`;
        }

        if (qrDiv) qrDiv.style.border = `${expandedBorder * sz / expandedSize}px solid white`;
    };
    const removeCustomSize = () => {
        dockDiv.style.width = dockDiv.style.height = "";

        barDiv.style.height = "";
        contentDiv.style.top = "";

        if (badgeDiv) badgeDiv.style.height = badgeDiv.style.width = "";
        if (qrDiv) qrDiv.style.border = "";
    };
    let size = expandedSize; // start with default size for "active" state
    const active = () => dockDiv.classList.contains('active');
    const activate = () => {
        dockDiv.classList.add('active');
        setCustomSize(size);
        // remove timed transition, to allow instant response during mouse-wheel resizing
        setTimeout(() => dockDiv.style.transition = "none", TRANSITION_TIME * 1000);
        };
    const deactivate = () => {
        dockDiv.style.transition = ""; // remove override - i.e., revert to timed transition
        dockDiv.classList.remove('active');
        removeCustomSize();
        };
    if (TOUCH) {
        deactivate();
        dockDiv.ontouchstart = evt => {
            evt.preventDefault();
            evt.stopPropagation();
            if (active()) deactivate(); else activate();
            };
    } else {
        if (dockState.pinned) activate(); else deactivate();
        let lastWheelTime = 0;
        dockDiv.onwheel = evt => {
            evt.preventDefault();
            evt.stopPropagation();

            const now = Date.now();
            if (now - lastWheelTime < 100) return;
            lastWheelTime = now;

            let { deltaY } = evt;
            deltaY = Math.sign(deltaY) * Math.min(5, Math.abs(deltaY)); // real mouse wheels generate huge deltas
            const max = Math.min(window.innerWidth, window.innerHeight) * 0.8;
            size = Math.max(minExpandedSize, Math.min(max, dockDiv.offsetWidth * 1.05 ** deltaY));
            setCustomSize(size);
        };
        dockDiv.onmouseenter = activate;
        dockDiv.onmouseleave = () => { if (!dockState.pinned) deactivate(); };
    }
}

function makeButton(text, id, fn) {
    const canvas = document.createElement('canvas');
    const w = canvas.width = 40 * BUTTON_WIDTH/12; // @@ fudge to allow diff button width on touch
    const h = canvas.height = 60;
    const ctx = canvas.getContext('2d');
    ctx.font = "36px Arial";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'black';
    ctx.fillText(text, w / 2, h * 0.55);

    const button = document.createElement('button');
    button.id = id;
    button.className = 'croquet_dock_button';
    const trigger = evt => {
        evt.preventDefault();
        evt.stopPropagation();
        fn();
        };
    if (TOUCH) button.ontouchstart = trigger;
    else button.onclick = trigger;
    button.appendChild(canvas);
    return button;
}

function makeBadge(div, sessionId) {
    if (App.badge === false) return;

    const moniker = monikerForId(sessionId);
    document.title = document.title.replace(/:.*/, '');
    document.title += ':' + moniker;

    while (div.firstChild) div.removeChild(div.firstChild);
    const canvas = document.createElement('canvas');
    const w = canvas.width = 120;
    const h = canvas.height = 40;
    canvas.style.width = "100%";
    div.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const colors = colorsForId(sessionId, 2);
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, h);
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = colors[1];
    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.font = "30px Arial";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'black';
    ctx.fillText(moniker, w/2, h/2);
}

// the QRCode maker takes an element and options (including the text for the code).
// it adds a canvas to the element, draws the code into the canvas, and returns an
// object that allows the code to be cleared and replaced.
function makeQRCode(div, url, options={}) {
    while (div.firstChild) div.removeChild(div.firstChild);
    return new QRCode(div, {
        text: url,
        width: 128,
        height: 128,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.L,   // L, M, Q, H
        ...options
        });
}

function displayBadgeIfNeeded(sessionId) {
    if (!sessionId || App.root === false) return;

    const badgeDiv = findElement(App.badge);
    if (!badgeDiv) return;

    makeBadge(badgeDiv, sessionId);
}

function displayQRCodeIfNeeded() {
    if (App.root === false || App.qrcode === false) return;
    if (urlOptions.noqr) return;

    const url = App.sessionURL;
    if (!url) { console.warn("App.sessionURL is not set"); return; }

    const qrDiv = findElement(App.qrcode);
    if (!qrDiv) return;

    if (!TOUCH) qrDiv.onclick = evt => {
        evt.preventDefault();
        evt.stopPropagation();
        window.open(url);
        };
    const qrcode = makeQRCode(qrDiv, url); // default options
    qrcode.getCanvas().style.width = "100%";
}

function displayStatsIfNeeded() {
    if (App.root === false) return;
    if (urlOptions.nostats) return;

    const statsDiv = findElement(App.stats);
    if (!statsDiv) return;

    makeStats(statsDiv);
}

function makeSessionWidgets(sessionId) {
    // sessionId can be undefined (in which case you won't get a badge)
    displayBadgeIfNeeded(sessionId);
    displayQRCodeIfNeeded();
    displayStatsIfNeeded();
}


let spinnerOverlay;
let spinnerEnabled; // set true when spinner is shown, or about to be shown
let spinnerTimeout = 0; // used to debounce.  only act on enabled true/false if steady for 500ms.

function displaySpinner(enabled) {
    if (spinnerEnabled === enabled) return;

    if (App.sync === false) enabled = false;

    if (enabled && !spinnerOverlay) spinnerOverlay = makeSpinner(); // lazily create when first enabled

    spinnerEnabled = enabled;
    if (enabled) {
        clearTimeout(spinnerTimeout);

        // set timer to add the overlay after 500ms iff still enabled
        spinnerTimeout = setTimeout(() => {
            if (!spinnerEnabled) return; // not enabled any more.  don't show.

            const parent = findElement(App.root, () => document.body);
            parent.appendChild(spinnerOverlay);

            spinnerOverlay.style.opacity = 0.9; // animate into view
        }, 500);
    } else {
        if (!spinnerOverlay) return;

        clearTimeout(spinnerTimeout);

        spinnerOverlay.style.opacity = 0.0; // start the animated fade

        // set timer to remove the overlay after 500ms iff still disabled
        spinnerTimeout = setTimeout(() => {
            if (spinnerEnabled) return; // now enabled.  don't remove.

            if (spinnerOverlay.parentElement) spinnerOverlay.parentElement.removeChild(spinnerOverlay);
        }, 500);
    }
}

function makeSpinner() {
    const overlay = document.createElement("div");
    overlay.id = "croquet_spinnerOverlay";

    const spinner = document.createElement("div");
    spinner.id = "croquet_loader";
    spinner.innerText = "Catching up...";

    overlay.appendChild(spinner);

    return overlay;
}

function findElement(value, ifNotFoundDo) {
    if (value === false) return false;

    if (value instanceof Element) return value;

    if (typeof value === "string") {
        const elem = document.getElementById(value);
        if (elem) return elem;
    }

    return ifNotFoundDo ? ifNotFoundDo() : null;
}

export const App = {
    sessionURL: window.location.href,
    root: document.body, // root for messages, the sync spinner, and the info dock
    sync: true, // whether to show the sync spinner while starting a session, or catching up
    messages: false, // whether to show status messages (e.g., as toasts)

    // the following can take a DOM element, an element ID, or false (to suppress)
    badge: false, // the two-colour session badge and 5-letter moniker
    stats: false, // the frame-by-frame stats display
    qrcode: false,

    // make a fancy collapsible dock of info widgets (currently badge, qrcode, stats).
    // disable any widget by setting e.g. { stats: false } in the options.
    makeWidgetDock,

    // build widgets in accordance with latest settings for root, badge, stats, and qrcode.
    // called internally immediately after a session is established.
    // can be called by an app at any time, to take account of changes in the settings.
    makeSessionWidgets,

    // make a canvas painted with the qr code for the currently set sessionURL (if there is one).
    // options are used as overrides on our default settings, which are:
    // { width: 128, height: 128, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L }
    // the available CorrectLevel values are L, M, Q, H
    makeQRCanvas(options = {}) {
        if (!App.sessionURL) return null;

        const div = document.createElement('div');
        const qrcode = makeQRCode(div, App.sessionURL, options);
        return qrcode && qrcode.getCanvas();
    },

    clearSessionMoniker,

    showSyncWait(bool) {
        const parentDef = App.root;
        if (parentDef === false) bool = false; // if root (now) false, only allow disabling

        displaySpinner(bool);
    },

    // messageFunction(msg, options) - where options from internally generated messages will include { level: 'status' | 'warning' | 'error' }
    messageFunction: showMessageAsToast,

    showMessage(msg, options={}) {
        // thin layer on top of messageFunction, to discard messages if there's nowhere
        // (or no permission) to show them.
        if (urlOptions.nomessages || App.root === false || App.messages === false || !App.messageFunction) return null;

        return App.messageFunction(msg, options);
    }
};
