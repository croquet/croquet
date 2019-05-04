import * as THREE from "three";
import { Controller } from "@croquet/teatime";
import { hotreload, urlOptions, Stats, displaySessionMoniker } from "@croquet/util";
import room1 from "./sampleRooms/room1";
import room2 from "./sampleRooms/room2";
import room3 from "./sampleRooms/room3";
import roomBounce from "./sampleRooms/bounce";
import roomPhysics from "./sampleRooms/physics";
import roomsJump from "./sampleRooms/jump";
import roomARBalls from "./sampleRooms/arBalls";
import RoomViewManager from "./room/roomViewManager";
import Renderer from "./render";
import { SpeedSlider, SpeedSliderView } from "./ui";
import {theKeyboardManager} from "./domKeyboardManager";

const TPS = "20x3"; // 20 ticks/s from server, 60 t/s total
const LOG_HOTRELOAD = true;

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

let hotState = module.hot && module.hot.data || {};

const defaultRoom = urlOptions.ar ? "arBalls" :
                    window.location.hostname === "croquet.studio" ? "bounce" : "room1";

// default message transcoders
const Vec3 = {
    encode: a => [a[0].x, a[0].y, a[0].z],
    decode: a => [new THREE.Vector3(...a)],
};
const Quat = {
    encode: a => [a[0].x, a[0].y, a[0].z, a[0].w],
    decode: a => [new THREE.Quaternion(...a)],
};
const Identity = {
    encode: args => args,
    decode: args => args,
};

/** The main function. */
async function start() {
    Controller.addMessageTranscoder('*>moveTo', Vec3);
    Controller.addMessageTranscoder('*>rotateTo', Quat);
    Controller.addMessageTranscoder('*>onKeyDown', Identity);
    Controller.addMessageTranscoder('*>updateContents', Identity);
    Controller.addMessageTranscoder('*>setColor', Identity);
    Controller.addMessageTranscoder('*>handleModelEventInModel', Identity);
    Controller.addMessageTranscoder('*>receiveEditEvents', Identity);
    Controller.addMessageTranscoder('*>movePaddleTo', Identity);

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
    Controller.connectToReflector(module.id, reflector);

    const ALL_ROOMS = {
        room1: {creator: room1},
        room2: {creator: room2},
        room3: {creator: room3},
        bounce: {creator: roomBounce},
        arBalls: {creator: roomARBalls},
        physics: {creator: roomPhysics},
        ...roomsJump
    };

    // if hot-reloading, store the island snapshots in the room creators
    if (urlOptions.hotreload) for (const [roomName, room] of Object.entries(ALL_ROOMS)) {
        if (!room.creator.snapshot && hotState.islands && hotState.islands[roomName]) {
            const snapshot = hotState.islands[roomName];
            room.creator.snapshot = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
        }
    }

    let speedSlider = null;

    Object.defineProperty(ALL_ROOMS, 'getIsland', {
        enumerable: false,
        value: async function getIsland(roomName) {
            const ROOM = ALL_ROOMS[roomName];
            if (!ROOM) throw Error("Unknown room: " + roomName);
            if (ROOM.namedModelsPromise) return ROOM.namedModelsPromise;
            const creatorFn = ROOM.creator.creatorFn;
            const creator = {...ROOM.creator, room: roomName, tps: TPS };
            creator.creatorFn = options => {
                const models = creatorFn(options);
                models.speedSlider = SpeedSlider.create();
                return models;
            };
            creator.destroyerFn = snapshot => {
                console.log("destroyer: detaching view for " + roomName);
                delete ROOM.namedModels;
                delete ROOM.namedModelsPromise;
                roomViewManager.detach(roomName);
                creator.snapshot = snapshot;
                if (currentRoomName === roomName) {
                    displaySessionMoniker('', 'reset');
                    console.log("destroyer: re-joining " + roomName);
                    currentRoomName = null;
                    joinRoom(roomName);
                }
            };
            const controller = new Controller();
            controller.fetchUpdatedSnapshot = !urlOptions.nodownload;
            ROOM.namedModelsPromise = controller.createIsland(roomName, creator);
            ROOM.controller = controller;
            ROOM.namedModels = await ROOM.namedModelsPromise;
            displaySessionMoniker(controller.id, 'reset');
            if (!speedSlider) speedSlider = controller.inViewRealm(() => new SpeedSliderView());
            speedSlider.attach(ROOM.namedModels.speedSlider, controller);
            return ROOM.namedModels;
        }
    });

    let currentRoomName = null;
    const roomViewManager = new RoomViewManager(window.innerWidth, window.innerHeight);

    function traversePortalToRoom({targetRoom, targetPosition, targetQuaternion, targetVelocity}) {
        joinRoom(targetRoom, targetPosition, targetQuaternion, true, targetVelocity);
    }

    async function joinRoom(roomName, cameraPosition=new THREE.Vector3(0, 2, 4), cameraQuaternion=new THREE.Quaternion(), overrideCamera, cameraVelocity) {
        if (!ALL_ROOMS[roomName]) roomName = defaultRoom;
        if (currentRoomName === roomName) return;
        await ALL_ROOMS.getIsland(roomName);
        currentRoomName = roomName;
        // request ahead of render, set initial camera position if necessary
        roomViewManager.request(roomName, ALL_ROOMS, {cameraPosition, cameraQuaternion, overrideCamera, cameraVelocity}, traversePortalToRoom);
        const desiredHash = roomName === defaultRoom ? "" : roomName;
        if (urlOptions.firstInHash() !== desiredHash) {
            window.history.pushState({}, "", "#" + desiredHash);
        }
    }

    const startRoom = hotState.currentRoomName || urlOptions.firstInHash() || defaultRoom;
    joinRoom(startRoom);

    /** @type {Renderer} */
    const renderer = hotState.renderer || new Renderer(window.innerWidth, window.innerHeight);
    const keyboardManager = theKeyboardManager; //new KeyboardManager();
    window.keyboardManager = keyboardManager;

    if (urlOptions.ar) hotreload.addDisposeHandler('ar', () => {
        try { renderer.arToolkitContext.arController.dispose(); }
        catch (e) { /* empty */ }
        });

    hotState = null; // free memory, and prevent accidental access below

    /** simulate for a given time budget */
    function simulate(deadline) {
        // simulate current room first
        const currentRoom = ALL_ROOMS[currentRoomName];
        const namedModels = currentRoom && currentRoom.namedModels;
        const weHaveMoreTime = !namedModels || currentRoom.controller.simulate(deadline);
        if (!weHaveMoreTime) return;
        // if we have time, simulate other rooms
        const liveRooms = Object.values(ALL_ROOMS).filter(room => room.namedModels);
        for (const {controller} of liveRooms) {
            controller.simulate(deadline);
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
            const namedModels = ALL_ROOMS[currentRoomName].namedModels;
            if (namedModels) {
                const simStart = Date.now();
                const simBudget = simLoad.reduce((a,b) => a + b, 0) / simLoad.length;
                // simulate about as long as in the prev frame to distribute load
                simulate(simStart + Math.min(simBudget, 200));
                // if backlogged, use all CPU time for simulation, but render at least at 5 fps
                if (ALL_ROOMS[currentRoomName].controller.backlog > balanceMS) simulate(simStart + 200 - simBudget);
                // keep log of sim times
                simLoad.push(Date.now() - simStart);
                if (simLoad.length > loadBalance) simLoad.shift();
                // update stats
                Stats.users(ALL_ROOMS[currentRoomName].controller.users);
                Stats.network(Date.now() - ALL_ROOMS[currentRoomName].controller.lastReceived);
                // remember lastFrame for setInterval()
                lastFrame = Date.now();
            }

            // update views from model
            Stats.begin("update");
            Object.values(ALL_ROOMS).forEach(({controller}) => controller && controller.processModelViewEvents());
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

    // set up event handlers
    const eventTimes = {};
    const throttle = event => {
        const now = Date.now();
        if (now - eventTimes[event.type] < (1000 / 60)) return true;
        eventTimes[event.type] = now;
        return false;
    };

    const canvas = renderer.renderer.context.canvas;

    hotreload.addEventListener(canvas, "mousemove", event => {
        if (!throttle(event)) {
            const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
            if (currentRoomView) currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
        }
        event.preventDefault();

    });
    hotreload.addEventListener(canvas, "mousedown", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseDown(event);
        event.preventDefault();
    });
    hotreload.addEventListener(canvas, "mouseup", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseUp();
        event.preventDefault();
    });

    hotreload.addEventListener(canvas, "touchstart", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) {
            currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
            currentRoomView.parts.pointer.updatePointer(true); // force to handle the touch
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
            if (currentRoomView && currentRoomView.parts.treadmill) {currentRoomView.parts.treadmill.onWheel(event);}
        }
        event.stopPropagation();
        event.preventDefault();
    }, {passive: false});

    hotreload.addEventListener(window, "resize", () => {
        renderer.changeViewportSize(window.innerWidth, window.innerHeight);
        roomViewManager.changeViewportSize(window.innerWidth, window.innerHeight);
    });

    hotreload.addEventListener(window, "hashchange", () => joinRoom(urlOptions.firstInHash()));

    hotreload.addEventListener(document.getElementById('reset'), "click", () => {
        if (currentRoomName) {
            const { controller } = ALL_ROOMS[currentRoomName];
            if (controller) controller.requestNewSession();
        }
    });

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
    if (urlOptions.hotreload) module.hot.accept();
    // preserve hotState
    module.hot.dispose(hotData => {
        Object.assign(hotData, hotState);
        hotreload.dispose(); // specifically, cancel our delayed start()
    });
}

// delay start to let hotreload finish to load all modules
if (!hotState.renderer) start();
else hotreload.setTimeout(start, 0);
