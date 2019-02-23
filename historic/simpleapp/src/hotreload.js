let frameHandle = 0;
let eventListeners = [];

function requestAnimationFrame(...args) {
    return frameHandle = window.requestAnimationFrame(...args);
}

function addEventListener(obj, ...args) {
    eventListeners.push({obj, args});
    return obj.addEventListener(...args);
}

function dispose() {
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    for (let {obj, args} of eventListeners) obj.removeEventListener(...args);
    frameHandle = 0;
    eventListeners = [];
}

export default {
    requestAnimationFrame,
    addEventListener,
    dispose,
};
