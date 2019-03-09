import * as THREE from 'three';
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import RoomView from './room/roomView.js';
import initRoom2 from './sampleRooms/room2.js';
import initRoom3 from './sampleRooms/room3.js';
import {fontRegistry} from './viewParts/fontRegistry.js';

const LOG_HOTRELOAD = false;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data && module.hot.data.hotState || {};

/** The main function. */
function start() {
    let robotoPromise = fontRegistry.getAtlasFor("Roboto");
    let loraPromise = fontRegistry.getAtlasFor("Lora");
    let barlowPromise = fontRegistry.getAtlasFor("Barlow");

    Promise.all([robotoPromise, loraPromise, barlowPromise]).then(() => {
    const ALL_ROOMS = {
//        room1: initRoom1(hotState.rooms && hotState.rooms.room1),
//        room2: initRoom2(hotState.rooms && hotState.rooms.room2),
        room3: initRoom3(hotState.rooms && hotState.rooms.room3),
    };

    const activeRoomViews = {};


    /** @type {import('./room/roomModel').default} */
    let currentRoom = null;
    /** @type {import('./room/roomView').default} */
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
            const roomView = new RoomView(island, {
                activeParticipant: true,
                width: window.innerWidth,
                height: window.innerHeight,
                cameraPosition: new THREE.Vector3(0, 2, 5)
            });
            roomView.attach(room);
            activeRoomViews[roomName] = roomView;
        }

        currentRoom = room;
        currentRoomView = activeRoomViews[roomName];
    }

    joinRoom(hotState.currentRoomName || window.location.hash.replace("#", "") || "room3");


    let renderer = hotState.renderer;
    if (!renderer) {
	let contextAttributes = {
            alpha: false,
            depth: true,
            stencil: true,
            antialias: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "default"
        };
	const canvas = document.createElement('canvas');
	const context = canvas.getContext("webgl2", contextAttributes);

	renderer = new THREE.WebGLRenderer({canvas, context});
	renderer.setSize(window.innerWidth, window.innerHeight);
	document.body.appendChild(renderer.domElement);
    }

    hotState = null; // free memory, and prevent accidental access below

    let before = Date.now();
    function frame() {
        if (currentRoomView) {
            renderer.render(currentRoomView.parts.roomScene.threeObj, currentRoomView.parts.camera.threeObj);
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
        // our hot-reload strategy is to reload all the code (meaning no reload
        // handlers in individual modules) but store the complete model state
        // in this dispose handler and restore it in start()
        module.hot.dispose(hotData => {
            // release WebGL resources
            for (const roomView of Object.values(activeRoomViews)) {
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
        if (LOG_HOTRELOAD && !module.bundle.v) module.bundle.v = 1;
    }
    })
}

if (module.hot) {
    // no module.hot.accept(), to force reloading of all dependencies
    // but preserve hotState
    module.hot.dispose(hotData => {
        hotData.hotState = hotState;
        hotreload.dispose(); // specifically, cancel our delayed start()
    });
}

// delay start to let hotreload finish to load all modules
if (!hotState.renderer) start();
else hotreload.setTimeout(start, 0);
