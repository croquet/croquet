if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

let timeoutHandles = new Set();
let frameHandles = new Set();
let eventListeners = [];
let disposeHandlers = {};

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

function addDisposeHandler(key, fn) {
    // call old handler one last time
    if (disposeHandlers[key]) disposeHandlers[key]();
    // store new handler
    disposeHandlers[key] = fn;
}

function dispose() {
    for (let handle of timeoutHandles) window.clearTimeout(handle);
    for (let handle of frameHandles) window.cancelAnimationFrame(handle);
    for (let {obj, args} of eventListeners) obj.removeEventListener(...args);
    console.log(`Clearing ${timeoutHandles.size} timeouts, ${frameHandles.size} animationFrames, ${eventListeners.length} eventListeners`);
    timeoutHandles = new Set();
    frameHandles = new Set();
    eventListeners = [];
    for (let fn of Object.values(disposeHandlers)) fn();
}

export default {
    setTimeout,
    requestAnimationFrame,
    addEventListener,
    addDisposeHandler,
    dispose,
};
