let timeoutHandles = new Set();
let frameHandles = new Set();
let eventListeners = [];
let disposeHandlers = [];

function setTimeout(fn, ms) {
    const handle = window.setTimeout((...args) => {
        timeoutHandles.delete(handle);
        fn(...args);
    }, ms);
    timeoutHandles.add(handle);
    return handle;
}

function requestAnimationFrame(fn) {
    const handle = window.requestAnimationFrame((...args) => {
        frameHandles.delete(handle);
        fn(...args);
    });
    frameHandles.add(handle);
    return handle;
}

function addEventListener(obj, ...args) {
    eventListeners.push({obj, args});
    return obj.addEventListener(...args);
}

function addDisposeHandler(fn) {
    disposeHandlers.push(fn);
}

function dispose() {
    for (let handle of timeoutHandles) window.clearTimeout(handle);
    for (let handle of frameHandles) window.cancelAnimationFrame(handle);
    for (let {obj, args} of eventListeners) obj.removeEventListener(...args);
    for (let fn of disposeHandlers) fn();
    console.log(`Clearing ${timeoutHandles.size} timeouts, ${frameHandles.size} animationFrames, ${eventListeners.length} eventListeners, ${disposeHandlers.length} disposeHandlers`);
    timeoutHandles = new Set();
    frameHandles = new Set();
    eventListeners = [];
    disposeHandlers = [];
}

export default {
    setTimeout,
    requestAnimationFrame,
    addEventListener,
    addDisposeHandler,
    dispose,
};
