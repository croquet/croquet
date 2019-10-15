import Toastify from 'toastify-js';
import SeedRandom from "seedrandom";
import QRCode from "./thirdparty-patched/qrcodejs/qrcode";
import urlOptions from "./urlOptions";
import { makeStats } from "./stats";


const TOUCH = 'ontouchstart' in document.documentElement;
const BUTTON_OFFSET = TOUCH ? 20 : 0; // extra % from the right
const BAR_PROPORTION = 18; // percent height of dock

// add style for the standard widgets that can appear on a Croquet page
function addWidgetStyle() {
    const widgetCSS = `
        body._disabled_debug #stats { display: block; }
        #croquet_dock { position: absolute; z-index: 2; border: 3px solid white; bottom: 6px; left: 6px; width: 84px; height: 36px; box-sizing: border-box; background: white; opacity: 0.3; cursor: none; transition: all 0.3s ease; }
        #croquet_dock.active { opacity: 0.95; }
        #croquet_dock_bar { position: absolute; border: 3px solid white; width: 100%; height: 30px; box-sizing: border-box; background: white; }

        #croquet_badge { position: absolute; left: 3px; width: 72px; height: 24px; top: 50%; transform: translate(0px, -50%); box-sizing: border-box; cursor: none; }
        #croquet_badge canvas { position: absolute; width: 100%; height: 100%; }

        #croquet_dock.active .croquet_dock_button { display: block; }
        .croquet_dock_button { display: none; position: absolute; width: 12%; height: 90%; top: 50%; transform: translate(0px, -50%); font-size: 80%; text-align: center; border-radius: 20%; }
        .croquet_dock_button canvas { position: absolute; width: 100%; height: 100%; top: 0px; left: 0px; }
        #croquet_dock_left { right: ${BUTTON_OFFSET + 32}% }
        #croquet_dock_right { right: ${BUTTON_OFFSET + 18}%; }
        #croquet_dock_pin { right: 2%; }

        #croquet_dock.active #croquet_dock_content { display: block; }
        #croquet_dock_content { display: none; position: absolute; top: 30px; left: 3px; bottom: 3px; right: 3px; box-sizing: border-box; background: white; }

        #croquet_qrcode { position: absolute; border: 6px solid white; width: 100%; height: 100%;box-sizing: border-box; opacity: 0; }
        #croquet_qrcode.active { opacity: 1; }
        #croquet_qrcode canvas { width: 100%; height: 100%; image-rendering: pixelated; }

        #croquet_stats { position: absolute; z-index: 20; top: 0; right: 0; width: 125px; height: 150px; background: white; opacity: 0; }
        #croquet_stats.active { opacity: 0.5; }
        #croquet_stats canvas { pointer-events: none }
`;
    const widgetStyle = document.createElement("style");
    widgetStyle.innerHTML = widgetCSS;
    document.head.appendChild(widgetStyle);
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
    document.head.appendChild(toastifyStyle);
}
addToastifyStyle();

// this is the default App.messageFunction
export function showMessageAsToast(msg, options = {}) {
    const level = options.level;
    let color;
    if (level === 'error') color = 'red';
    else if (level === 'warning') color = 'gold';
    else color = '#aaa';

    return displayToast(msg, { backgroundColor: color, ...options });
}

export function displayError(msg, options) {
    return msg && App.messageFunction(msg, { ...options, level: 'error' });
}

export function displayWarning(msg, options) {
    return msg && App.messageFunction(msg, { ...options, level: 'warning' });
}

export function displayStatus(msg, options) {
    return msg && App.messageFunction(msg, { ...options, level: 'status' });
}

export function displayAppError(where, error) {
    const userStack = error.stack.split("\n").filter(l => !l.match(/croquet-.*\.min.js/)).join('\n');
    App.messageFunction(`<b>Error during ${where}: ${error.message}</b>\n\n${userStack}`.replace(/\n/g, "<br>"),  {
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
    // fall through (so body will be used as parent) - in particular, if parentDef === true

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

function gravatarURLForId(id) {
    const random = new SeedRandom(id);
    const hash = [0, 0, 0, 0].map(_ => (random.int32() >>> 0).toString(16).padStart(8, '0')).join('');
    return `url('https://www.gravatar.com/avatar/${hash}?d=identicon&f=y')`;
}

export function clearSessionMoniker() {
    if (App.badge === false) return;

    document.title = document.title.replace(/:.*/, '');
}

function makeInfoDock(session) {
    const dockDiv = document.createElement('div');
    dockDiv.id = 'croquet_dock';
    document.body.appendChild(dockDiv);

    const barDiv = document.createElement('div');
    barDiv.id = 'croquet_dock_bar';
    dockDiv.appendChild(barDiv);

    const badgeDiv = document.createElement('div');
    badgeDiv.id = 'croquet_badge';
    barDiv.appendChild(badgeDiv);
    makeBadge(badgeDiv, session);

    const contentChildren = [];
    let currentContent = 0;
    function shiftContent(dir) {
        const numChildren = contentChildren.length;
        if (numChildren <= 1) return;

        contentChildren[currentContent].classList.remove('active');
        currentContent = (currentContent + numChildren + dir) % numChildren;
        contentChildren[currentContent].classList.add('active');
    }
    function prevContent() { shiftContent(-1); }
    function nextContent() { shiftContent(1); }
    function pin() {}
    makeButtons(barDiv, prevContent, nextContent, pin);

    const contentDiv = document.createElement('div');
    contentDiv.id = 'croquet_dock_content';
    dockDiv.appendChild(contentDiv);

    const url = App.sessionURL;
    let qrDiv;
    if (url) {
        qrDiv = document.createElement('div');
        qrDiv.id = 'croquet_qrcode';
        contentDiv.appendChild(qrDiv);
        makeQRCode(qrDiv, url); // default options
        qrDiv.onclick = () => window.open(url);
        contentChildren.push(qrDiv);
    }

    const statsDiv = document.createElement('div');
    statsDiv.id = 'croquet_stats';
    contentDiv.appendChild(statsDiv);
    contentChildren.push(statsDiv);
    makeStats(statsDiv);

    const expandedSize = 256;
    const expandedBorder = 8;
    const setCustomSize = sz => {
        dockDiv.style.width = `${sz}px`;
        dockDiv.style.height = `${sz * (1 + BAR_PROPORTION/100)}px`;

        const barHeight = sz * BAR_PROPORTION/100;
        barDiv.style.height = `${barHeight}px`;
        contentDiv.style.top = `${barHeight}px`;

        badgeDiv.style.height = `${barHeight * 0.9}px`;
        badgeDiv.style.width = `${barHeight * 0.9 * 3}px`;

        if (qrDiv) qrDiv.style.border = `${expandedBorder * sz / expandedSize}px solid white`;
    };
    const removeCustomSize = () => {
        dockDiv.style.width = dockDiv.style.height = "";

        barDiv.style.height = "";
        contentDiv.style.top = "";

        badgeDiv.style.height = "";
        badgeDiv.style.width = "";

        if (qrDiv) qrDiv.style.border = "";
    };
    let size = expandedSize; // start with default size for "active" state
    const active = () => dockDiv.classList.contains('active');
    const activate = () => {
        dockDiv.classList.add('active');
        setCustomSize(size);
        setTimeout(() => dockDiv.style.transition = "none", 300);
    };
    const deactivate = () => {
        dockDiv.style.transition = "";
        dockDiv.classList.remove('active');
        removeCustomSize();
    };
    if ('ontouchstart' in dockDiv) {
        dockDiv.ontouchstart = () => active() ? deactivate() : activate();
    } else {
        let lastWheelTime = 0;
        dockDiv.onwheel = evt => {
            evt.preventDefault();
            evt.stopPropagation();

            const now = Date.now();
            if (now - lastWheelTime < 100) return;
            lastWheelTime = now;

            const { deltaY } = evt;
            const max = Math.min(window.innerWidth, window.innerHeight) * 0.9;
            size = Math.max(expandedSize / 4, Math.min(max, dockDiv.offsetWidth * 1.05 ** deltaY));
            setCustomSize(size);
        };
        dockDiv.onmouseenter = activate;
        //dockDiv.onmouseleave = deactivate;
    }

}

function makeButtons(barDiv, prevContent, nextContent, pin) {
    function makeButton(text, id, fn) {
        const canvas = document.createElement('canvas');
        const w = canvas.width = 40;
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
        button.onclick = fn;
        button.appendChild(canvas);
        barDiv.appendChild(button);
    }

    makeButton('<', 'croquet_dock_left', prevContent);
    makeButton('>', 'croquet_dock_right', nextContent);
    makeButton('📌', 'croquet_dock_pin', pin);
}

function makeBadge(div, session) {
    //if (App.badge === false) return;

    const id = session.id;
    const moniker = monikerForId(id);
    document.title = document.title.replace(/:.*/, '');
    document.title += ':' + moniker;

    while (div.firstChild) div.removeChild(div.firstChild);
    const canvas = document.createElement('canvas');
    const w = canvas.width = 120;
    const h = canvas.height = 40;
    div.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const colors = colorsForId(id, 2);
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

export function displayQRCodeIfNeeded() {
    if (urlOptions.noqr) return;

    if (App.root === false) return;

    let parentDef = App.qrcode;
    if (parentDef === false) return;

    const url = App.sessionURL;
    if (!url) { console.warn("App.sessionURL is not set"); return; }

    if (parentDef === true) parentDef = 'croquet_qrcode';
    let div = findElement(parentDef);
    if (!div) {
        if (parentDef !== 'croquet_qrcode') return; // we only have the right to create a #croquet_qrcode element

        div = document.createElement('div');
        div.id = 'croquet_qrcode';
        document.body.appendChild(div);
    }
    makeQRCode(div, url); // default options
    div.onclick = () => { };

}

export function displaySessionWidgets(session) {
    makeInfoDock(session);
//    displayQRCodeIfNeeded();
//    displayStatsIfNeeded();
//    displayBadgeIfNeeded(session);
}


let spinnerOverlay;
let spinnerEnabled; // set true when spinner is shown, or about to be shown
let spinnerTimeout = 0; // used to debounce.  only act on enabled true/false if steady for 500ms.

function displaySpinner(enabled) {
    if (spinnerEnabled === enabled) return;

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
    const style = document.createElement('style');
    style.innerHTML = `
        .spinnerOverlay {
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
        .loader,
        .loader:before,
        .loader:after {
          border-radius: 50%;
          width: 2.5em;
          height: 2.5em;
          animation: dots 1.8s infinite ease-in-out;
        }
        .loader {
          color: #fff;
          font-size: 10px;
          margin: 80px auto;
          position: relative;
          text-indent: -9999em;
          animation-delay: -0.16s;
        }
        .loader:before,
        .loader:after {
          content: '';
          position: absolute;
          top: 0;
        }
        .loader:before { left: -3.5em; animation-delay: -0.32s; }
        .loader:after { left: 3.5em; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "spinnerOverlay";

    const spinner = document.createElement("div");
    spinner.className = "loader";
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
    root: true,
    qrcode: false,
    stats: false,
    badge: false,
    messageFunction: showMessageAsToast,

    generateQR(options = {}) {
        if (!App.sessionURL) return null;

        const div = document.createElement('div');
        const qrcode = makeQRCode(div, App.sessionURL, options);
        return qrcode && qrcode.getCanvas();
    },

    showSync(bool) {
        const parentDef = App.root; // element | element id | true (body) | false (off)
        if (parentDef === false) bool = false; // if root (now) false, make sure spinner is gone

        displaySpinner(bool);
    },

    showStats(bool) {
        let rootDef = App.root;
        if (rootDef === false) return;

        let statsDef = App.stats;
        if (statsDef === false) bool = false; // if (now) false, we can only remove
        else if (statsDef === true) statsDef = rootDef;

        if (statsDef === null) statsDef = 'stats';
        const elem = findElement(statsDef, () => {
            const div = document.createElement('div');
            div.id = 'stats';
            document.body.appendChild(div);
            return div;
        });
        if (elem) {}
    },

    showMessage(msg, options={}) {
        if (App.root === false) return null;

        // we have no say in how messageParent will be used.  see displayToast (above)
        // for an example.
        return App.messageFunction(msg, options);
    }
};
