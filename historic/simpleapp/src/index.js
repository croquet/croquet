import * as THREE from "three";
import hotreload from "./hotreload.js";
import room1 from './sampleRooms/room1.js';
import room2 from './sampleRooms/room2.js';
import room3 from './sampleRooms/room3.js';
import roomBounce from './sampleRooms/bounce.js';
import RoomViewManager from './room/roomViewManager.js';
import Renderer from './render.js';
import { connectToReflector, Controller, addMessageTranscoder } from "./island.js";
import {theKeyboardManager} from './domKeyboardManager.js';
import Stats from "./util/stats.js";
import urlOptions from "./util/urlOptions.js";
import { uploadCode } from "./modules.js";

const LOG_HOTRELOAD = true;

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

let hotState = module.hot && module.hot.data || {};

const defaultRoom = window.location.hostname === "croquet.studio" ? "bounce" : "room1";


// default message transcoders
const XYZ = {
    encode: a => [a[0].x, a[0].y, a[0].z],
    decode: a => [{ x: a[0], y: a[1], z: a[2] }],
};
const XYZW = {
    encode: a => [a[0].x, a[0].y, a[0].z, a[0].w],
    decode: a => [{ x: a[0], y: a[1], z: a[2], w: a[3] }],
};
const Identity = {
    encode: a => a,
    decode: a => a,
};
addMessageTranscoder('*#moveTo', XYZ);
addMessageTranscoder('*#rotateTo', XYZW);
addMessageTranscoder('*#onKeyDown', Identity);
addMessageTranscoder('*#updateContents', Identity);
addMessageTranscoder('*#setColor', Identity);


let codeHashes = null;

/** The main function. */
async function start() {
    let reflector = "wss://dev1.os.vision/reflector-v1";
    if ("reflector" in urlOptions) reflector = urlOptions.reflector;

    if (urlOptions.replay) {
        console.warn("Replaying snapshot, overriding all other options");
        const response = await fetch(urlOptions.replay, { mode: "cors" });
        const snapshot = await response.json();
        for (const key of Object.keys(urlOptions)) delete urlOptions[key];
        Object.assign(urlOptions, snapshot.meta.options);
        urlOptions.noupload = true;
        urlOptions.nodownload = true;
        hotState.currentRoomName = snapshot.meta.room;
        hotState.islands = { [snapshot.meta.room]: snapshot };
    }

    // start websocket connection
    connectToReflector(reflector);

    // upload changed code files
    if (!urlOptions.noupload) uploadCode(module.id).then(hashes => codeHashes = hashes);

    const ALL_ROOMS = {
        room1: {creator: room1},
        room2: {creator: room2},
        room3: {creator: room3},
        bounce: {creator: roomBounce},
    };

    // if hot-reloading, store the island snapshots in the room creators
    if (urlOptions.hotreload) for (const [roomName, room] of Object.entries(ALL_ROOMS)) {
        if (!room.creator.snapshot && hotState.islands && hotState.islands[roomName]) {
            const snapshot = hotState.islands[roomName];
            room.creator.snapshot = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
        }
    }

    Object.defineProperty(ALL_ROOMS, 'getIsland', {
        enumerable: false,
        value: async function getIsland(roomName) {
            const ROOM = ALL_ROOMS[roomName];
            if (!ROOM) throw Error("Unknown room: " + roomName);
            if (ROOM.islandPromise) return ROOM.islandPromise;
            const creator = ROOM.creator;
            creator.room = roomName;
            if (!creator.options) creator.options = {};
            for (const opt of ["owner","session"]) {
                if (urlOptions[opt]) creator.options[opt] = urlOptions[opt];
            }
            creator.destroyerFn = snapshot => {
                console.log("destroyer: detaching view for " + roomName);
                delete ROOM.island;
                delete ROOM.islandPromise;
                roomViewManager.detach(roomName);
                creator.snapshot = snapshot;
                if (currentRoomName === roomName) {
                    console.log("destroyer: re-joining " + roomName);
                    currentRoomName = null;
                    joinRoom(roomName);
                }
            };
            const controller = new Controller();
            controller.fetchUpdatedSnapshot = !urlOptions.nodownload;
            ROOM.islandPromise = controller.createIsland(roomName, creator);
            return ROOM.island = await ROOM.islandPromise;
        }
    });

    let currentRoomName = null;
    const roomViewManager = new RoomViewManager(window.innerWidth, window.innerHeight);

    function traversePortalToRoom({targetRoom, targetPosition, targetQuaternion}) {
        joinRoom(targetRoom, targetPosition, targetQuaternion, true);
    }

    async function joinRoom(roomName, cameraPosition=new THREE.Vector3(0, 2, 4), cameraQuaternion=new THREE.Quaternion(), overrideCamera) {
        if (!ALL_ROOMS[roomName]) roomName = defaultRoom;
        if (currentRoomName === roomName) return;
        await ALL_ROOMS.getIsland(roomName);
        currentRoomName = roomName;
        // request ahead of render, set initial camera position if necessary
        roomViewManager.request(roomName, ALL_ROOMS, {cameraPosition, cameraQuaternion, overrideCamera}, traversePortalToRoom);
        const desiredHash = roomName === defaultRoom ? "" : roomName;
        if (window.location.hash.slice(1) !== desiredHash) {
            window.history.pushState({}, "", "#" + desiredHash);
        }
    }

    const startRoom = hotState.currentRoomName || window.location.hash.slice(1) || defaultRoom;
    joinRoom(startRoom);

    /** @type {Renderer} */
    const renderer = hotState.renderer || new Renderer(window.innerWidth, window.innerHeight);
    const keyboardManager = theKeyboardManager; //new KeyboardManager();
    window.keyboardManager = keyboardManager;

    hotState = null; // free memory, and prevent accidental access below

    /** simulate for a given time budget */
    function simulate(deadline) {
        // simulate current room first
        const currentRoom = ALL_ROOMS[currentRoomName];
        const currentIsland = currentRoom && ALL_ROOMS[currentRoomName].island;
        const weHaveMoreTime = !currentIsland || currentIsland.controller.simulate(deadline);
        if (!weHaveMoreTime) return;
        // if we have time, simulate other rooms
        const liveRooms = Object.values(ALL_ROOMS).filter(room => room.island);
        for (const {island} of liveRooms) {
            island.controller.simulate(deadline);
        }
    }

    /** time when last frame was rendered */
    let lastFrame = 0;

    /** time spent simulating the last few frames */
    const simLoad = [0];
    /** number of frames to spread load (TODO: make adaptive to tick rate */
    const loadBalance = 4;
    /** time in ms we allow sim to lag behind before increasing sim budget */
    const balanceMS = loadBalance * (1000 / 60);

    // main loop
    hotreload.requestAnimationFrame(frame);
    function frame(timestamp) {
        hotreload.requestAnimationFrame(frame);
        Stats.animationFrame(timestamp);
        if (currentRoomName) {
            const currentIsland = ALL_ROOMS[currentRoomName].island;
            if (currentIsland) {
                const simStart = Date.now();
                const simBudget = simLoad.reduce((a,b) => a + b, 0) / simLoad.length;
                // simulate about as long as in the prev frame to distribute load
                simulate(simStart + Math.min(simBudget, 200));
                // if backlogged, use all CPU time for simulation, but render at least at 5 fps
                if (currentIsland.controller.backlog > balanceMS) simulate(simStart + 200 - simBudget);
                // keep log of sim times
                simLoad.push(Date.now() - simStart);
                if (simLoad.length > loadBalance) simLoad.shift();
                // update stats
                Stats.users(currentIsland.controller.users);
                Stats.network(Date.now() - currentIsland.controller.lastReceived);
                // remember lastFrame for setInterval()
                lastFrame = Date.now();
            }

            // update views from model
            Stats.begin("update");
            Object.values(ALL_ROOMS).forEach(({island}) => island && island.processModelViewEvents());
            Stats.end("update");

            // update view state
            const currentRoomView = roomViewManager.getIfLoaded(currentRoomName);
            if (currentRoomView) {
                // render views
                Stats.begin("render");
                renderer.render(currentRoomName, ALL_ROOMS, roomViewManager);
                Stats.end("render");
                currentRoomView.parts.pointer.updatePointer();
                keyboardManager.setCurrentRoomView(currentRoomView);
            }
        }
    }

    // simulate even if rendering stopped
    hotreload.setInterval(() => {
        // if we are rendering, do nothing
        if (Date.now() - lastFrame < 100) return;
        // otherwise, simulate a bit
        simulate(10);
    }, 10);

    if (!urlOptions.noupload) {
        // upload snapshots every 30 seconds
        function uploadSnapshots() {
            const liveRooms = Object.values(ALL_ROOMS).filter(room => room.island);
            for (const {island: {controller}} of liveRooms) {
                if (controller.backlog < balanceMS) controller.uploadSnapshot(codeHashes);
            }
        }
        hotreload.setInterval(uploadSnapshots, 30000);
        // also upload when the page gets unloaded
        hotreload.addEventListener(document.body, "unload", uploadSnapshots);
        // ... and on hotreload
        hotreload.addDisposeHandler('snapshots', uploadSnapshots);
    }

    // set up event handlers
    const eventTimes = {};
    const throttle = event => {
        const now = Date.now();
        if (now - eventTimes[event.type] < (1000 / 60)) return true;
        eventTimes[event.type] = now;
        return false;
    };

    hotreload.addEventListener(window, "mousemove", event => {
        if (!throttle(event)) {
            const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
            if (currentRoomView) currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
        }
        event.preventDefault();

    });
    hotreload.addEventListener(window, "mousedown", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseDown(event);
        event.preventDefault();
    });
    hotreload.addEventListener(window, "mouseup", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseUp();
        event.preventDefault();
    });
    const canvas = renderer.renderer.context.canvas;
    hotreload.addEventListener(canvas, "touchstart", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentRoomView.parts.pointer.updatePointer();
            currentRoomView.parts.pointer.onMouseDown();
        }
        event.preventDefault();
        event.stopPropagation();
    }, {passive: false});

    hotreload.addEventListener(canvas, "touchmove", event => {
        if (!throttle(event)) {
            const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
            if (currentRoomView) {
                currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            }
        }
        event.preventDefault();
        event.stopPropagation();
    }, {passive: false});

    hotreload.addEventListener(canvas, "touchend", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) {currentRoomView.parts.pointer.onMouseUp();}
        event.preventDefault();
        event.stopPropagation();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        if (!throttle(event)) {
            const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
            if (currentRoomView) {currentRoomView.parts.treadmill.onWheel(event);}
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(window, "resize", () => {
        renderer.changeViewportSize(window.innerWidth, window.innerHeight);
        roomViewManager.changeViewportSize(window.innerWidth, window.innerHeight);
    });

    hotreload.addEventListener(document.getElementById('reset'), "click", () => {
        if (currentRoomName) {
            const currentIsland = ALL_ROOMS[currentRoomName].island;
            if (currentIsland) currentIsland.broadcastInitialState();
        }
    });

    hotreload.addEventListener(window, "hashchange", () => joinRoom(window.location.hash.slice(1)));

    keyboardManager.install(hotreload);

    if (module.hot) {
        // our hot-reload strategy is to reload all the code (meaning no reload
        // handlers in individual modules) but store the complete model state
        // in this dispose handler and restore it in start()
        module.hot.dispose(hotData => {
            // release WebGL resources
            roomViewManager.detachAll();
            // preserve state, will be available as module.hot.data after reload
            Object.assign(hotData, {
                renderer,
                keyboardManager,
                islands: {},
                currentRoomName
            });
            for (const [name, {island}] of Object.entries(ALL_ROOMS)) {
                if (island) hotData.islands[name] = JSON.stringify(island.asState());
            }
        });
        // start logging module loads
        if (LOG_HOTRELOAD && !module.bundle.v) module.bundle.v = {};
    }
}

if (module.hot) {
    module.hot.accept();
    // preserve hotState
    module.hot.dispose(hotData => {
        Object.assign(hotData, hotState);
        hotreload.dispose(); // specifically, cancel our delayed start()
    });
}

// delay start to let hotreload finish to load all modules
if (!hotState.renderer) start();
else hotreload.setTimeout(start, 0);
