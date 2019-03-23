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
            const controller = new Controller();
            ROOM.islandPromise = controller.create(roomName, creator);
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
        await ALL_ROOMS.getIsland(roomName);
        currentRoomName = roomName;
        // request ahead of render, set initial camera position if necessary
        roomViewManager.request(roomName, ALL_ROOMS, {cameraPosition, cameraQuaternion, overrideCamera}, onTraversedPortalView);
        if (window.location.hash.replace("#", "") !== roomName) {
            window.history.pushState({}, "", "#" + roomName);
        }
    }

    const startRoom = hotState.currentRoomName || window.location.hash.slice(1) || defaultRoom;
    joinRoom(startRoom);

    /** @type {Renderer} */
    const renderer = hotState.renderer || new Renderer(window.innerWidth, window.innerHeight);
    const keyboardManager = new KeyboardManager();


    hotState = null; // free memory, and prevent accidental access below

    function frame() {
        const frameBudget = 1000 / 60;
        const startOfFrame = Date.now();
        if (currentRoomName) {
            renderer.render(currentRoomName, ALL_ROOMS, roomViewManager);
            const currentRoomView = roomViewManager.getIfLoaded(currentRoomName);

            if (currentRoomView) {
                Object.values(ALL_ROOMS).forEach(({island}) => island && island.processModelViewEvents());
                currentRoomView.parts.pointer.updatePointer();
                keyboardManager.setCurrentRoomView(currentRoomView);
            }
        }
        const deadline = startOfFrame + frameBudget;
        for (const {island} of Object.values(ALL_ROOMS)) {
            if (island) island.controller.processMessages(deadline);
        }
        hotreload.requestAnimationFrame(frame);
    }

    hotreload.requestAnimationFrame(frame);

    hotreload.addEventListener(window, "mousemove", event => {
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
        const currentRoomView = currentRoomName && roomViewManager.getIfLoaded(currentRoomName);
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
