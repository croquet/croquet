import * as THREE from "three";
import hotreload from "./hotreload.js";
import room1 from './sampleRooms/room1.js';
import room2 from './sampleRooms/room2.js';
import room3 from './sampleRooms/room3.js';
import roomBounce from './sampleRooms/bounce.js';
import RoomViewManager from './room/roomViewManager.js';
import Renderer from './render.js';
import { Controller } from "./island.js";
import {KeyboardManager} from './domKeyboardManager.js';
import Stats from "./util/stats.js";
import urlOptions from "./util/urlOptions.js";

const LOG_HOTRELOAD = false;

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

let hotState = module.hot && module.hot.data || {};

const defaultRoom = window.location.hostname === "croquet.studio" ? "bounce" : "room1";

/** The main function. */
function start() {
    const ALL_ROOMS = {
        room1: {creator: room1},
        room2: {creator: room2},
        room3: {creator: room3},
        bounce: {creator: roomBounce},

        async getIsland(roomName) {
            const ROOM = ALL_ROOMS[roomName];
            if (!ROOM) throw Error("Unknown room: " + roomName);
            if (ROOM.islandPromise) return ROOM.islandPromise;
            const creator = ROOM.creator;
            if (urlOptions.owner) {
                const options = creator.options||{};
                creator.options = {...options, owner: urlOptions.owner};
            }
            const controller = new Controller();
            ROOM.islandPromise = controller.createIsland(roomName, creator);
            return ROOM.island = await ROOM.islandPromise;
        }
    };
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
    const keyboardManager = new KeyboardManager();


    hotState = null; // free memory, and prevent accidental access below

    /** simulate for a given time budget */
    function simulate(budget = 50) {
        const liveRooms = Object.values(ALL_ROOMS).filter(room => room.island);
        const currentIsland = currentRoomName && ALL_ROOMS[currentRoomName].island;
        for (const {island} of liveRooms) {
            const ms = island === currentIsland ? budget : 1;
            island.controller.simulate(ms);
        }
    }

    /** time when last frame was rendered */
    let lastFrame = 0;

    /** time spent simulating the last few frames */
    const simTimes = [];

    // main loop
    hotreload.requestAnimationFrame(frame);
    function frame(timestamp) {
        hotreload.requestAnimationFrame(frame);
        Stats.animationFrame(timestamp);
        if (currentRoomName) {
            const currentIsland = ALL_ROOMS[currentRoomName].island;
            if (currentIsland) {
                const simStart = Date.now();
                const avgSimTime = simTimes.reduce((a,b) => a + b, 0) / simTimes.length;
                // simulate about as long as in the prev frame to distribute load
                simulate(Math.min(avgSimTime, 200));
                // if backlogged, use all CPU time for simulation, but render at least at 5 fps
                if (currentIsland.controller.backlog > 100) simulate(200);
                // keep log of sim times
                simTimes.push(Date.now() - simStart);
                if (simTimes.length > 4) simTimes.shift();
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

            // render views
            Stats.begin("render");
            renderer.render(currentRoomName, ALL_ROOMS, roomViewManager);
            Stats.end("render");

            // update view state
            const currentRoomView = roomViewManager.getIfLoaded(currentRoomName);
            if (currentRoomView) {
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
        if (now - eventTimes[event.type] < 50) return;
        eventTimes[event.type] = now;
    };

    hotreload.addEventListener(window, "mousemove", event => {
        if (throttle(event)) return;
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
    });
    hotreload.addEventListener(window, "mousedown", event => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseDown(event);
    });
    hotreload.addEventListener(window, "mouseup", _ => {
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
        if (currentRoomView) currentRoomView.parts.pointer.onMouseUp();
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
            // for (const [name, {island}] of Object.entries(ALL_ROOMS)) {
            //     if (island) hotData.islands[name] = JSON.stringify(island.asState());
            // }
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
