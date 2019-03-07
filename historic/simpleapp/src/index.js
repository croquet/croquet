import * as THREE from 'three';
import hotreload from "./hotreload.js";
import initRoom1 from './sampleRooms/room1.js';
import RoomView from './room/roomView.js';
import initRoom2 from './sampleRooms/room2.js';

const LOG_HOTRELOAD = false;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data || {};
if (typeof hotState.rooms === "string") hotState.rooms = JSON.parse(hotState.rooms);

/** The main function. */
function start() {

    const ALL_ROOMS = {
        room1: initRoom1(hotState.rooms && hotState.rooms.room1),
        room2: initRoom2(hotState.rooms && hotState.rooms.room2)
    };

    const socket = new WebSocket("ws://localhost:9090/");
    console.log("connecting to localhost:9090");

    socket.onopen = _event => {
        console.log("websocket connected");
    };

    socket.onmessage = event => {
        console.log("received: ", event.data);
        if (socket.room) {
            const { action, args } = JSON.parse(event.data);
            switch (action) {
                case 'RECV': socket.room.island.RECV(args); break;
                case 'SNAPSHOT': {
                    console.log('SNAPSHOT');
                    socket.send(JSON.stringify({
                        action: 'ISLAND',
                        args: {
                            island: socket.room.island.asState(),
                            room: socket.room.room.id,
                        }
                    }));
                    //socket.room.island.sendNoop();
                    console.log('sending ISLAND');
                    break;
                }
                case 'ISLAND': {
                    console.log('ISLAND');
                    ALL_ROOMS.room1 = initRoom1(args);
                    joinRoom('room1');
                    ALL_ROOMS.room1.island.discardOldMessages();
                    break;
                }
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

    const activeRoomViews = {};

    /** @type {import('./room/roomModel').default} */
    let currentRoom = null;
    /** @type {import('./room/roomView').default} */
    let currentRoomView = null;

    function joinRoom(roomName) {
        // leave previous room
        if (currentRoom) {
            socket.room = null;
            currentRoomView = null;
            currentRoom = null;
        }

        const island = ALL_ROOMS[roomName].island;
        const room = ALL_ROOMS[roomName].room;

        //socket.room = ALL_ROOMS[roomName];
        //island.socket = socket;
        //console.log('Joining at time', island.time);

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

    joinRoom(hotState.currentRoomName || window.location.hash.replace("#", "") || "room1");

    const renderer = hotState.renderer || new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

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
            // dispose socket
            socket.close();
            // release WebGL resources
            for (const roomView of Object.values(activeRoomViews)) {
                roomView.detach();
            }
            // preserve state, will be available as module.hot.data after reload
            const rooms = {};
            for (const [roomName, room] of Object.entries(ALL_ROOMS)) {
                rooms[roomName] = {
                    island: room.island.asState(),
                    room: room.room.id,
                };
            }
            Object.assign(hotData, {
                renderer,
                rooms: JSON.stringify(rooms),   // stringify to catch problems
                currentRoomName: window.location.hash.replace("#", ""),
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
