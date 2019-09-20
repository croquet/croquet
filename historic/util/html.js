import Toastify from 'toastify-js';
import SeedRandom from "seedrandom";
import QRCode from "./thirdparty-patched/qrcodejs/qrcode";
import urlOptions from "./urlOptions";

// add style for the standard widgets that can appear on a Croquet page
function addWidgetStyle() {
    const widgetCSS = `
        #stats { display: none; position: absolute; z-index: 20; top: 0; right: 0; width: 125px; height: 150px; background: white; opacity: 0.5; }
        #stats canvas { pointer-events: none }
        body.debug #stats { display: block; }
        #qrcode { position: absolute; z-index: 2; border: 3px solid white; bottom: 6px; left: 6px; width: 35px; height: 35px; box-sizing: border-box; opacity: 0.3; cursor: none; transition: all 0.3s ease; }
        #qrcode canvas { width: 100%; height: 100%; image-rendering: pixelated; }
        #qrcode.active { opacity: 0.9; }
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

export function displayError(msg, options) {
    return msg && displayToast(msg, { backgroundColor: "red", ...options });
}

export function displayWarning(msg, options) {
    return msg && displayToast(msg, { backgroundColor: "gold", ...options });
}

export function displayStatus(msg, options) {
    return msg && displayToast(msg, { backgroundColor: "#aaa", ...options });
}

export function displayAppError(where, error) {
    const userStack = error.stack.split("\n").filter(l => !l.match(/croquet-.*\.min.js/)).join('\n');
    displayError(`<b>Error during ${where}: ${error.message}</b>\n\n${userStack}`.replace(/\n/g, "<br>"),  {
        duration: 10000,
        stopOnFocus: true,
    });
}

function displayToast(msg, options) {
    const toastOpts = {
        text: msg,
        duration: 3000,
        //close: true,
        gravity: 'bottom', // `top` or `bottom`
        position: 'left', // `left`, `center` or `right`
        backgroundColor: 'linear-gradient(to right, #00b09b, #96c93d)',
        stopOnFocus: true, // Prevents dismissing of toast on hover
        ...options };
    return Toastify(toastOpts).showToast();
}

export function displaySessionMoniker(id='', element='session') {
    const button = document.getElementById(element);
    document.title = document.title.replace(/:.*/, '');
    if (!id) {
        if (button) button.style.backgroundImage = '';
        return '';
    }
    // random page title suffix
    const random = new SeedRandom(id);
    const letters = ['bcdfghjklmnpqrstvwxyz', 'aeiou'];
    let moniker = '';
    for (let i = 0; i < 10; i++) moniker += letters[i%2][random.quick() * letters[i%2].length|0];
    document.title += ':' + moniker;
    // image derived from id
    if (button) {
        if (urlOptions.noreset) {
            button.style.display = "none";
        } else {
            const hash = [0,0,0,0].map(_=>(random.int32()>>>0).toString(16).padStart(8, '0')).join('');
            button.style.backgroundImage = `url('https://www.gravatar.com/avatar/${hash}?d=identicon&f=y')`;

            const monikerDiv = document.getElementById(element+'-moniker');
            if (monikerDiv) monikerDiv.textContent = moniker.slice(0, 5);
        }
    }
    return moniker;
}

let qrcode;

export function displayQRCode(url, div='qrcode') {
    if (typeof div === "string") div = document.getElementById(div);
    if (!div) return;
    div.onclick = () => {};
    if (urlOptions.noqr) return;
    if (!url) url = window.location.href;
    if (!qrcode) qrcode = new QRCode(div, {
        text: url,
        width: 128,
        height: 128,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L,   // L, M, Q, H
    });
    else qrcode.makeCode(url);
    const active = () => div.classList.contains("active");
    const activate = () => div.classList.add("active");
    const deactivate = () => div.classList.remove("active");
    const setCustomSize = size => {
        div.style.width = div.style.height = `${size}px`;
        div.style.border = `${16 * size / 256}px solid white`;
        };
    const removeCustomSize = () => {
        div.style.width = div.style.height = "";
        div.style.border = "";
        };
    if ("ontouchstart" in div) {
        div.ontouchstart = () => active() ? deactivate() : activate();
    } else {
        div.onclick = () => window.open(url);
        let size = 256;
        div.onwheel = ({deltaY}) => {
            const max = Math.min(window.innerWidth, window.innerHeight) - 2 * div.offsetLeft;
            size = Math.max(64, Math.min(max, div.offsetWidth * 1.05 ** deltaY));
            setCustomSize(size);
        };
        div.onmouseenter = () => {
            activate();
            setCustomSize(size);
            };
        div.onmouseleave = () => {
            deactivate();
            removeCustomSize();
            };
    }
}

const spinnerOverlay = addSpinner();
let spinnerEnabled = !!spinnerOverlay.parentElement;
let spinnerTimeout = 0;

export function displaySpinner(enabled) {
    if (spinnerEnabled === enabled) return;
    spinnerEnabled = enabled;
    if (enabled) {
        clearTimeout(spinnerTimeout);
        spinnerTimeout = setTimeout(() => {
            if (!spinnerEnabled) return;
            document.body.appendChild(spinnerOverlay);
            spinnerOverlay.style.opacity = 0.9; // animate
        }, 500);
    } else {
        spinnerOverlay.style.opacity = 0.0; // animate
        clearTimeout(spinnerTimeout);
        spinnerTimeout = setTimeout(() => {
            if (spinnerEnabled) return;
            if (spinnerOverlay.parentElement) {
                document.body.removeChild(spinnerOverlay);
            } // else console.warn("spinner overlay already removed?!");
        }, 500);
    }
}

function addSpinner() {
    const style = document.createElement("style");
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
    document.body.appendChild(overlay);

    return overlay;
}
