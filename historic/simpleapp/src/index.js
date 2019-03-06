import * as THREE from 'three';
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import { RoomView } from './room.js';
import { PointingObserverCameraView, Observer } from './observer.js';
import { execOnIsland } from './island.js';
import initRoom2 from './sampleRooms/room2.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

/** The main function. */
function start() {
    let hotState = module.hot && module.hot.data && module.hot.data.hotState || {};

    const ALL_ROOMS = {
        room1: initRoom1(hotState.rooms && hotState.rooms.room1),
        room2: initRoom2(hotState.rooms && hotState.rooms.room2)
    };

    /** @type {import('./room').Room} */
    let currentRoomIsland = null;
    let currentRoom = null;
    let currentRoomView = null;
    let currentObserver = null;
    let currentObserverView = null;

    function joinRoom(roomName, existingObserverId) {
        // leave previous room
        if (currentRoom) {
            currentObserverView.detach();
            currentObserverView = null;
            currentRoomView.detach();
            currentRoomView = null;
            // TODO: what if this is async? (also see comment below)
            execOnIsland(currentRoomIsland, () => {
                currentRoom.parts.observers.remove(currentObserver);
            });
            currentRoom = null;
            currentObserver = null;
        }

        const island = ALL_ROOMS[roomName].island;
        const room = ALL_ROOMS[roomName].room;
        let observer = island.modelsById[existingObserverId];

        if (!observer) {
            // TODO: what if this is async? When do we have a time to attach views to our newly added observer
            // maybe there should be a callback for running "normal" code after the "in-island" callback has run
            execOnIsland(island, () => {
                observer = new Observer({
                    spatial: {
                        position: new THREE.Vector3(0, 2, 5),
                    },
                    name: "Guest1"
                });
                room.parts.observers.add(observer);
            });
        }

        const roomView = new RoomView(island, {localObserver: observer});
        roomView.attach(room);

        const observerView = new PointingObserverCameraView(island, {width: window.innerWidth, height: window.innerHeight});
        observerView.attach(observer);
        observerView.addToThreeParent(roomView.parts.scene.scene);

        currentRoomIsland = island;
        currentRoom = room;
        currentRoomView = roomView;
        currentObserver = observer;
        currentObserverView = observerView;
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
            renderer.render(currentRoomView.parts.scene.scene, currentObserverView.parts.camera.threeObj);
            currentObserverView.parts.pointer.updatePointer(currentRoomView.parts.scene.scene);
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
        if (currentObserverView) currentObserverView.parts.pointer.onMouseMove(event.clientX, event.clientY);
    });
    hotreload.addEventListener(window, "mousedown", event => {
        if (currentObserverView) currentObserverView.parts.pointer.onMouseDown(event);
    });
    hotreload.addEventListener(window, "mouseup", event => {
        if (currentObserverView) currentObserverView.parts.pointer.onMouseUp(event);
    });
    hotreload.addEventListener(document.body, "touchstart", event => {
        if (currentObserverView) {
            currentObserverView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentObserverView.pointer.updatePointer(currentRoomView.parts.scene);
            currentObserverView.parts.pointer.onMouseDown();
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        if (currentObserverView) {
            currentObserverView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        }
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        if (currentObserverView) {currentObserverView.parts.pointer.onMouseUp();}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        if (currentObserverView) {currentObserverView.parts.treadmillNavigation.onWheel(event);}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(window, "resize", () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (currentObserverView) {currentObserverView.parts.camera.setSize(window.innerWidth, window.innerHeight);}
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
            if (currentRoomView) {
                currentRoomView.detach();
                currentObserverView.detach();
            }
            // preserve state, will be available as module.hot.data after reload
            hotData.hotState = {
                renderer,
                rooms: {},
                observerId: currentObserver && currentObserver.id,
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
