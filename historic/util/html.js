import SeedRandom from "seedrandom";
import QRCode from "./thirdparty-patched/qrcodejs/qrcode";

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
    if (!("ontouchstart" in div)) div.href = url; // open url in new window, but only on desktop
}
