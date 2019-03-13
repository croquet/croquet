import * as THREE from "three";
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import initRoom2 from './sampleRooms/room2.js';
import initRoom3 from './sampleRooms/room3.js';
import RoomViewManager from './room/roomViewManager.js';
import Renderer from './render.js';
import { Controller } from "./island.js";
import {KeyboardManager} from './domKeyboardManager.js';
import {fontRegistry} from './viewParts/fontRegistry.js';

const LOG_HOTRELOAD = false;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data || {};

/** The main function. */
function start() {
    let robotoPromise = fontRegistry.getAtlasFor("Roboto");
    //let loraPromise = fontRegistry.getAtlasFor("Lora");
    //let barlowPromise = fontRegistry.getAtlasFor("Barlow");

    Promise.all([robotoPromise/*, loraPromise, barlowPromise*/]).then(() => {

    const ALL_ISLANDS = {};
    let currentRoomName = null;
    const roomViewManager = new RoomViewManager(window.innerWidth, window.innerHeight);

    function joinRoom(roomName) {
        currentRoomName = roomName;
        // request ahead of render, set initial camera position if necessary
        roomViewManager.request(roomName, ALL_ISLANDS, new THREE.Vector3(0, 2, 4));
    }

    const startRoom = hotState.currentRoomName || window.location.hash.replace("#", "") || "room1";

    function newIsland(roomName, creatorFn) {
        let state = hotState.islands && hotState.islands[roomName];
        if (state) state = JSON.parse(state);
        const controller = new Controller();
        controller.newIsland(creatorFn, state, island => {
            ALL_ISLANDS[roomName] = island;
            if (roomName === startRoom) joinRoom(roomName);
        });
        return controller.island;
    }

    newIsland("room1", initRoom1);
    newIsland("room2", initRoom2);
    newIsland("room3", initRoom3);

    /** @type {Renderer} */
    const renderer = hotState.renderer || new Renderer(window.innerWidth, window.innerHeight);
    let keyboardManager = new KeyboardManager();


    hotState = null; // free memory, and prevent accidental access below

    function frame() {
        if (currentRoomName) {
            renderer.render(currentRoomName, ALL_ISLANDS, roomViewManager);
            const currentRoomView = roomViewManager.request(currentRoomName, ALL_ISLANDS);

            if (currentRoomView) {
                currentRoomView.parts.pointer.updatePointer();
		keyboardManager.setCurrentRoomView(currentRoomView);
            }
        }
        for (const island of Object.values(ALL_ISLANDS)) {
            island.processModelViewEvents();
        }
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ISLANDS);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
    });
    hotreload.addEventListener(window, "mousedown", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ISLANDS);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseDown(event);
    });
    hotreload.addEventListener(window, "mouseup", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ISLANDS);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseUp(event);
    });
    hotreload.addEventListener(document.body, "touchstart", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ISLANDS);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentRoomView.parts.pointer.updatePointer();
            currentRoomView.parts.pointer.onMouseDown();
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ISLANDS);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        }
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ISLANDS);
        if (currentRoomView) {currentRoomView.parts.pointer.onMouseUp();}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        const currentRoomView = currentRoomName && roomViewManager.request(currentRoomName, ALL_ISLANDS);
        if (currentRoomView) {currentRoomView.parts.treadmillNavigation.onWheel(event);}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(window, "resize", () => {
        renderer.changeViewportSize(window.innerWidth, window.innerHeight);
        roomViewManager.changeViewportSize(window.innerWidth, window.innerHeight);
    });

    hotreload.addEventListener(window, "hashchange", () => joinRoom(window.location.hash.replace("#", "")));

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
            for (const [name, island] of Object.entries(ALL_ISLANDS)) {
                hotData.islands[name] = JSON.stringify(island.asState());
            }
        });
        // start logging module loads
        if (LOG_HOTRELOAD && !module.bundle.v) module.bundle.v = 1;
    }
    });
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
