import * as THREE from 'three';
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import initRoom2 from './sampleRooms/room2.js';
import RoomView from './room/roomView.js';

const LOG_HOTRELOAD = false;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data || {};
if (typeof hotState.islands === "string") hotState.islands = JSON.parse(hotState.islands);

/** The main function. */
function start() {

    const ALL_ISLANDS = {
        room1: initRoom1(hotState.islands && hotState.islands.room1),
        room2: initRoom2(hotState.islands && hotState.islands.room2),
    };

    const offline = true;
    let socket = null;

    if (!offline) {
        socket = new WebSocket("ws://localhost:9090/");
        console.log("connecting to localhost:9090");

        socket.onopen = _event => {
            console.log("websocket connected");
        };

        socket.onmessage = event => {
            console.log("received: ", event.data);
            if (socket.island) {
                const { action, args } = JSON.parse(event.data);
                switch (action) {
                    case 'RECV':
                        socket.island.RECV(args);
                        break;
                    case 'SERVE':
                        console.log('SERVE');
                        socket.send(JSON.stringify({
                            action: args, // reply action
                            args: socket.island.asState(),
                        }));
                        //socket.room.island.sendNoop();
                        console.log('sending SYNC');
                        break;
                    case 'SYNC':
                        console.log('ISLAND');
                        ALL_ISLANDS.room1 = initRoom1(args);
                        joinRoom('room1');
                        ALL_ISLANDS.room1.island.discardOldMessages();
                        break;
                    default: console.log("Unknown action:", action);
                }
            }
        };

        socket.onerror = event => {
            console.log("websocket error: ", event);
        };

        socket.onclose = _event => {
            console.log("websocket closed");
        };
    }

    const activeViews = {};

    /** @type {import('./room/roomView').default} */
    let currentView = null;

    function joinRoom(roomName) {
        // leave previous room
        currentView = null;

        const island = ALL_ISLANDS[roomName];

        if (!activeViews[roomName]) {
            const view = new RoomView(island, {
                activeParticipant: true,
                width: window.innerWidth,
                height: window.innerHeight,
                cameraPosition: new THREE.Vector3(0, 2, 5)
            });
            view.attach(island.get('room')); // HACK! Reaching into island
            activeViews[roomName] = view;
        }

        currentView = activeViews[roomName];
    }

    joinRoom(hotState.currentIslandName || window.location.hash.replace("#", "") || "room1");

    const renderer = hotState.renderer || new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    hotState = null; // free memory, and prevent accidental access below

    let before = Date.now();
    function frame() {
        if (currentView) {
            renderer.render(currentView.parts.roomScene.threeObj, currentView.parts.camera.threeObj);
            currentView.parts.pointer.updatePointer();
        }
        const now = Date.now();
        for (const island of Object.values(ALL_ISLANDS)) {
            if (offline) {
                island.advanceTo(island.time + (now - before));
                island.processModelViewEvents();
            }
        }
        before = now;
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

    hotreload.addEventListener(window, "hashchange", () => joinRoom(window.location.hash.replace("#", "")));

    if (module.hot) {
        // our hot-reload strategy is to reload all the code (meaning no reload
        // handlers in individual modules) but store the complete model state
        // in this dispose handler and restore it in start()
        module.hot.dispose(hotData => {
            // dispose socket
            if (socket) socket.close();
            // release WebGL resources
            for (const roomView of Object.values(activeViews)) {
                roomView.detach();
            }
            // preserve state, will be available as module.hot.data after reload
            const islands = {};
            for (const [name, island] of Object.entries(ALL_ISLANDS)) {
                islands[name] = island.asState();
            }
            Object.assign(hotData, {
                renderer,
                islands: JSON.stringify(islands),   // stringify to catch problems
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
