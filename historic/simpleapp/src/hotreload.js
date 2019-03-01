if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

const timeoutHandles = new Set();
const frameHandles = new Set();
const eventListeners = [];
const disposeHandlers = {};

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
    for (const handle of timeoutHandles) window.clearTimeout(handle);
    for (const handle of frameHandles) window.cancelAnimationFrame(handle);
    for (const {obj, args} of eventListeners) obj.removeEventListener(...args);
    console.log(`Clearing ${timeoutHandles.size} timeouts, ${frameHandles.size} animationFrames, ${eventListeners.length} eventListeners`);
    timeoutHandles.clear();
    frameHandles.clear();
    eventListeners.length = 0;
    for (const fn of Object.values(disposeHandlers)) fn();
}

export default {
    setTimeout,
    requestAnimationFrame,
    addEventListener,
    addDisposeHandler,
    dispose,
};
