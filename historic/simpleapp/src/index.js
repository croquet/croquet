import * as THREE from "three";
import hotreload from "./hotreload.js";
import room1 from './sampleRooms/room1.js';
import room2 from './sampleRooms/room2.js';
import room3 from './sampleRooms/room3.js';
import roomBounce from './sampleRooms/bounce.js';
import RoomViewManager from './room/roomViewManager.js';
import Renderer from './render.js';
import { connectToReflector, Controller } from "./island.js";
import {theKeyboardManager} from './domKeyboardManager.js';
import Stats from "./util/stats.js";
import urlOptions from "./util/urlOptions.js";
import { uploadCode } from "./modules.js";

const LOG_HOTRELOAD = true;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data || {};

const defaultRoom = window.location.hostname === "croquet.studio" ? "bounce" : "room1";

let codeHashes = null;

/** The main function. */
function start() {
    // start websocket connection
    connectToReflector();

    // upload changed code files
    if (urlOptions.upload !== false) uploadCode(module.id).then(hashes => codeHashes = hashes);

    const ALL_ROOMS = {
        room1: {creator: room1},
        room2: {creator: room2},
        room3: {creator: room3},
        bounce: {creator: roomBounce},
    };

    // if hot-reloading, store the island snapshots in the room creators
    for (const [roomName, room] of Object.entries(ALL_ROOMS)) {
        if (!room.creator.snapshot && hotState.islands && hotState.islands[roomName]) {
            room.creator.snapshot = JSON.parse(hotState.islands[roomName]);
        }
    }

    Object.defineProperty(ALL_ROOMS, 'getIsland', {
        enumerable: false,
        value: async function getIsland(roomName) {
            const ROOM = ALL_ROOMS[roomName];
            if (!ROOM) throw Error("Unknown room: " + roomName);
            if (ROOM.islandPromise) return ROOM.islandPromise;
            const creator = ROOM.creator;
            if (!creator.options) creator.options = {};
            for (const opt of ["owner","session"]) {
                if (urlOptions[opt]) creator.options[opt] = urlOptions[opt];
            }
            creator.destroyerFn = snapshot => {
                Stats.connected(false);
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
            ROOM.islandPromise = controller.createIsland(roomName, creator);
            return ROOM.island = await ROOM.islandPromise;
        }
    });

    let currentRoomName = null;
    const roomViewManager = new RoomViewManager(window.innerWidth, window.innerHeight);

    /** @arg {import('./island').default} island */
    function onTraversedPortalView(portalRef, traverserRef, island, sourceRoomName) {
        const [portalModelId, portalPartId] = portalRef.split(".");
        /** @type {import('./portal/portalModel').PortalPart} */
        const portal = island.modelsById[portalModelId];
        const portalPart = portal.parts[portalPartId];
        /** @type {import('./room/roomModel').default}*/
        const roomView = roomViewManager.expect(sourceRoomName);

        if (traverserRef === roomView.parts.portalTraverser.asPartRef()) {
            const spatialPart = roomView.parts[roomView.parts.portalTraverser.spatialName];
            // TODO: ugly
            const portalSpatialPart = portal.parts[portalPart.hereSpatialPartId];
            const {targetPosition, targetQuaternion} = portalPart.projectThroughPortal(spatialPart.position, spatialPart.quaternion);
            joinRoom(portalPart.there, targetPosition, targetQuaternion, true);

            // take a "step back" in the source room
            const newSourcePosition = portalSpatialPart.position.clone().add(new THREE.Vector3(0, 0, 2.5).applyQuaternion(spatialPart.quaternion));
            roomViewManager.moveCamera(sourceRoomName, newSourcePosition, spatialPart.quaternion.clone());
            roomView.parts.pointer.onMouseUp();
        }
    }

    async function joinRoom(roomName, cameraPosition=new THREE.Vector3(0, 2, 4), cameraQuaternion=new THREE.Quaternion(), overrideCamera) {
        if (!ALL_ROOMS[roomName]) roomName = defaultRoom;
        if (currentRoomName === roomName) return;
        await ALL_ROOMS.getIsland(roomName);
        Stats.connected(true);
        currentRoomName = roomName;
        // request ahead of render, set initial camera position if necessary
        roomViewManager.request(roomName, ALL_ROOMS, {cameraPosition, cameraQuaternion, overrideCamera}, onTraversedPortalView);
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
                Stats.backlog(currentIsland.controller.backlog);
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

    if (urlOptions.upload !== false) {
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
        if (now - eventTimes[event.type] < 50) return;
        eventTimes[event.type] = now;
    };

    hotreload.addEventListener(window, "mousemove", event => {
        if (throttle(event)) return;
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
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
    hotreload.addEventListener(document.body, "touchstart", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentRoomView.parts.pointer.updatePointer();
            currentRoomView.parts.pointer.onMouseDown();
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        if (throttle(event)) return;
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        }
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) {currentRoomView.parts.pointer.onMouseUp();}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        if (throttle(event)) return;
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) {currentRoomView.parts.treadmillNavigation.onWheel(event);}
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
        if (LOG_HOTRELOAD && !module.bundle.v) module.bundle.v = 1;
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
