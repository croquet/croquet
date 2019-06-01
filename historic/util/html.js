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
