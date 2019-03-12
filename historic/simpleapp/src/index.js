import * as THREE from "three";
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import initRoom2 from './sampleRooms/room2.js';
import RoomViewManager from './room/roomViewManager.js';
import Renderer from './render.js';

const LOG_HOTRELOAD = false;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data || {};
if (typeof hotState.island === "string") hotState.island = JSON.parse(hotState.island);


/** The main function. */
function start() {
    let currentView = null;

    const ALL_ROOMS = {
        room1: initRoom1(hotState.rooms && hotState.rooms.room1),
        room2: initRoom2(hotState.rooms && hotState.rooms.room2)
    };

    /** @type {import('./room/roomModel').default} */
    let currentRoomName = null;
    const roomViewManager = new RoomViewManager(window.innerWidth, window.innerHeight);

    function joinRoom(roomName) {
        currentRoomName = roomName;
        // request ahead of render, set initial camera position if necessary
        roomViewManager.request(roomName, ALL_ROOMS, new THREE.Vector3(0, 2, 4));
    }

    controller.newIsland(initRoom1, hotState.island, island => {
        if (currentView) currentView.detach();
        currentView = new RoomView(island, {
            activeParticipant: true,
            width: window.innerWidth,
            height: window.innerHeight,
            cameraPosition: new THREE.Vector3(0, 2, 5)
        });
        currentView.attach(island.get('room')); // HACK! Reaching into island
    });

    /** @type {Renderer} */
    const renderer = hotState.renderer || new Renderer(window.innerWidth, window.innerHeight);

    hotState = null; // free memory, and prevent accidental access below

    function frame() {
        if (currentRoomName) {
            renderer.render(currentRoomName, ALL_ROOMS, roomViewManager);
            const currentRoomView = roomViewManager.request(currentRoomName, ALL_ROOMS);

            if (currentRoomView) {
                currentRoomView.parts.pointer.updatePointer();
            }
        }

        const now = Date.now();
        for (const room of Object.values(ALL_ROOMS)) {
            room.island.advanceTo(room.island.time + (now - before));
            room.island.processModelViewEvents();
        }
        controller.island.processModelViewEvents();
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ROOMS);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
    });
    hotreload.addEventListener(window, "mousedown", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ROOMS);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseDown(event);
    });
    hotreload.addEventListener(window, "mouseup", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ROOMS);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseUp(event);
    });
    hotreload.addEventListener(document.body, "touchstart", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ROOMS);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentRoomView.parts.pointer.updatePointer();
            currentRoomView.parts.pointer.onMouseDown();
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ROOMS);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        }
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ROOMS);
        if (currentRoomView) {currentRoomView.parts.pointer.onMouseUp();}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ROOMS);
        if (currentRoomView) {currentRoomView.parts.treadmillNavigation.onWheel(event);}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(window, "resize", () => {
        renderer.changeViewportSize(window.innerWidth, window.innerHeight);
        roomViewManager.changeViewportSize(window.innerWidth, window.innerHeight);
    });

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
                rooms: {},
                currentRoomName,
            };

            for (const roomName of Object.keys(ALL_ROOMS)) {
                const room = ALL_ROOMS[roomName];
                hotData.hotState.rooms[roomName] = {
                    island: room.island.toState(),
                    room: room.room.id,
                };
            }
        });
        // start logging module loads
        if (LOG_HOTRELOAD && !module.bundle.v) module.bundle.v = 1;
    }
}

if (module.hot) {
    // no module.hot.accept(), to force reloading of all dependencies
    // but preserve hotState
    module.hot.dispose(hotData => {
        Object.assign(hotData, hotState);
        hotreload.dispose(); // specifically, cancel our delayed start()
    });
}

// delay start to let hotreload finish to load all modules
if (!hotState.renderer) start();
else hotreload.setTimeout(start, 0);
