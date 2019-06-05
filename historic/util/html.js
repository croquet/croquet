import SeedRandom from "seedrandom";
import QRCode from "./thirdparty-patched/qrcodejs/qrcode";
import { urlOptions } from ".";

export function displaySessionMoniker(id='', element='session') {
    const button = document.getElementById(element);
    document.title = document.title.replace(/:.*/, '');
    if (!id) {
        if (button) button.style.backgroundImage = '';
        return;
    }
    // random page title suffix
    document.title += ':';
    const random = new SeedRandom(id);
    const letters = ['bcdfghjklmnpqrstvwxyz', 'aeiou'];
    for (let i = 0; i < 10; i++) document.title += letters[i%2][random.quick() * letters[i%2].length|0];
    // image derived from id
    if (button) {
        const hash = [0,0,0,0].map(_=>(random.int32()>>>0).toString(16).padStart(8, '0')).join('');
        button.style.backgroundImage = `url('https://www.gravatar.com/avatar/${hash}?d=identicon&f=y')`;
    }
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
    if ("ontouchstart" in div) {
        div.ontouchstart = () => active() ? deactivate() : activate();
    } else {
        div.onclick = () => window.open(url);
        let size = 256;
        div.onwheel = ({deltaY}) => {
            const max = Math.min(window.innerWidth, window.innerHeight) - 2 * div.offsetLeft;
            size = Math.max(64, Math.min(max, div.offsetWidth * 1.05 ** deltaY));
            div.style.width = div.style.height = `${size}px`;
        };
        div.onmouseenter = () => { activate(); div.style.width = div.style.height = `${size}px`; };
        div.onmouseleave = () => { deactivate(); div.style.width = div.style.height = ""; };
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
            }
        }, 500);
    }
}

function addSpinner() {
    const style = document.createElement("style");
    style.innerHTML = `
        .spinnerOverlay {
            z-index: 10000;
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
