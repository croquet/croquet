import * as THREE from 'three';
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import RoomView from './room/roomView.js';
import { Controller } from './island.js';

const LOG_HOTRELOAD = false;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data || {};
if (typeof hotState.island === "string") hotState.island = JSON.parse(hotState.island);


/** The main function. */
function start() {
    let currentView = null;

    const controller = new Controller();
    controller.startHeartBeat(50);

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

    const renderer = hotState.renderer || new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    hotState = null; // free memory, and prevent accidental access below

    function frame() {
        if (currentView) {
            renderer.render(currentView.parts.roomScene.threeObj, currentView.parts.camera.threeObj);
            currentView.parts.pointer.updatePointer();
        }
        controller.island.processModelViewEvents();
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => {
        if (currentView) currentView.parts.pointer.onMouseMove(event.clientX, event.clientY);
    });
    hotreload.addEventListener(window, "mousedown", event => {
        if (currentView) currentView.parts.pointer.onMouseDown(event);
    });
    hotreload.addEventListener(window, "mouseup", event => {
        if (currentView) currentView.parts.pointer.onMouseUp(event);
    });
    hotreload.addEventListener(document.body, "touchstart", event => {
        if (currentView) {
            currentView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentView.parts.pointer.updatePointer();
            currentView.parts.pointer.onMouseDown();
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchmove", event => {
        if (currentView) {
            currentView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
        }
    }, {passive: false});

    hotreload.addEventListener(document.body, "touchend", event => {
        if (currentView) {currentView.parts.pointer.onMouseUp();}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(document.body, "wheel", event => {
        if (currentView) {currentView.parts.treadmillNavigation.onWheel(event);}
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(window, "resize", () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (currentView) {currentView.parts.camera.setSize(window.innerWidth, window.innerHeight);}
    });

    if (module.hot) {
        // our hot-reload strategy is to reload all the code (meaning no reload
        // handlers in individual modules) but store the complete model state
        // in this dispose handler and restore it in start()
        module.hot.dispose(hotData => {
            // release WebGL resources
            if (currentView) currentView.detach();

            // preserve state, will be available as module.hot.data after reload
            Object.assign(hotData, {
                renderer,
                island: JSON.stringify(controller.island.asState()),   // stringify to catch problems
                currentIslandName: window.location.hash.replace("#", ""),
            });

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
