import * as THREE from 'three';
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import RoomView from './room/view.js';
import initRoom2 from './sampleRooms/room2.js';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

/** The main function. */
function start() {
    let hotState = module.hot && module.hot.data && module.hot.data.hotState || {};

    const ALL_ROOMS = {
        room1: initRoom1(hotState.rooms && hotState.rooms.room1),
        room2: initRoom2(hotState.rooms && hotState.rooms.room2)
    };

    const activeRoomViews = {};

    /** @type {import('./room/model').default} */
    let currentRoom = null;
    /** @type {import('./room/view').default} */
    let currentRoomView = null;

    function joinRoom(roomName) {
        // leave previous room
        if (currentRoom) {
            currentRoomView = null;
            currentRoom = null;
        }

        const island = ALL_ROOMS[roomName].island;
        const room = ALL_ROOMS[roomName].room;

        if (!activeRoomViews[roomName]) {
            const roomView = new RoomView(island, {activeParticipant: true});
            roomView.attach(room);
        }

        currentRoom = room;
        currentRoomView = activeRoomViews[roomName];
    }

    joinRoom(
        hotState.currentRoomName || window.location.hash.replace("#", "") || "room1",
        hotState.observerId
    );

    const renderer = hotState.renderer || new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    hotState = null; // prevent accidental access below

    let before = Date.now();
    function frame() {
        if (currentRoom) {
            renderer.render(currentRoomView.parts.scene.scene, currentRoomView.parts.camera.threeObj);
            currentRoomView.parts.pointer.updatePointer();
        }
        const now = Date.now();
        for (const room of Object.values(ALL_ROOMS)) {
            room.island.advanceTo(room.island.time + (now - before));
            room.island.processModelViewEvents();
        }
        before = now;
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => {
        if (currentRoomView) currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
    });
    hotreload.addEventListener(window, "mousedown", event => {
        if (currentRoomView) currentRoomView.parts.pointer.onMouseDown(event);
    });
    hotreload.addEventListener(window, "mouseup", event => {
        if (currentRoomView) currentRoomView.parts.pointer.onMouseUp(event);
    });
    hotreload.addEventListener(document.body, "touchstart", event => {
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentRoomView.parts.pointer.updatePointer();
            currentRoomView.parts.pointer.onMouseDown();
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        }
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        if (currentRoomView) {currentRoomView.parts.pointer.onMouseUp();}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        if (currentRoomView) {currentRoomView.parts.treadmillNavigation.onWheel(event);}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(window, "resize", () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (currentRoomView) {currentRoomView.parts.camera.setSize(window.innerWidth, window.innerHeight);}
    });

    hotreload.addEventListener(window, "hashchange", () => joinRoom(window.location.hash.replace("#", "")));

    if (module.hot) {
        module.hot.accept(() => { });
        // our hot-reload strategy is to reload all the code (meaning no reload
        // handlers in individual modules) but store the complete model state
        // in this dispose handler and restore it in start()
        module.hot.dispose(hotData => {
            // unregister all callbacks, they refer to old functions
            hotreload.dispose();
            // release WebGL resources
            for (const roomView of activeRoomViews) {
                roomView.detach();
            }
            // preserve state, will be available as module.hot.data after reload
            hotData.hotState = {
                renderer,
                rooms: {},
                currentRoomName: window.location.hash.replace("#", ""),
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
        if (!module.bundle.v) module.bundle.v = 1;
    }
}

start();
