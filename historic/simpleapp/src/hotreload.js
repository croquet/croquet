const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

const timeoutHandles = new Set();
const intervalHandles = new Set();
const frameHandles = new Set();
const eventListeners = [];
const disposeHandlers = {};

let promisesOK = true;
function promiseResolveThen(fn) {
    Promise.resolve().then(() => promisesOK && fn());
}

function setTimeout(fn, ms) {
    const handle = window.setTimeout((...args) => {
        timeoutHandles.delete(handle);
        fn(...args);
    }, ms);
    timeoutHandles.add(handle);
    return handle;
}

function setInterval(fn, ms) {
    const handle = window.setInterval((...args) => {
        intervalHandles.delete(handle);
        fn(...args);
    }, ms);
    intervalHandles.add(handle);
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

function callDisposeHandlers() {
    for (const fn of Object.values(disposeHandlers)) fn();
}

function dispose() {
    document.getElementById("error").innerText = '';
    for (const handle of timeoutHandles) window.clearTimeout(handle);
    for (const handle of intervalHandles) window.clearTimeout(handle);
    for (const handle of frameHandles) window.cancelAnimationFrame(handle);
    for (const {obj, args} of eventListeners) obj.removeEventListener(...args);
    if (module.bundle.v) console.log(`Clearing ${timeoutHandles.size} timeouts, ${frameHandles.size} animationFrames, ${eventListeners.length} eventListeners`);
    timeoutHandles.clear();
    frameHandles.clear();
    eventListeners.length = 0;
    callDisposeHandlers();
    promisesOK = false;
}

window.onbeforeunload = callDisposeHandlers;

export default {
    promiseResolveThen,
    setTimeout,
    setInterval,
    requestAnimationFrame,
    addEventListener,
    addDisposeHandler,
    dispose,
};
