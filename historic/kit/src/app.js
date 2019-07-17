import * as THREE from "three";
import { Model, Controller } from "@croquet/teatime";
import { urlOptions, Stats, displaySessionMoniker, displayQRCode } from "@croquet/util";
import RoomViewManager from "./room/roomViewManager";
import Renderer from "./render";
import { theKeyboardManager } from "./domKeyboardManager";
import { theDragDropHandler } from "./domDragDrop";

// hack for Parts that still use constructors
Model.allowConstructors();

export default class App {
    constructor(rooms, canvas, width, height, options={}) {
        Controller.connectToReflectorIfNeeded();
        this.roomStates = {};

        for (const [roomName, roomInit] of Object.entries(rooms)) {
            this.roomStates[roomName] = {creator: {init: roomInit}};
        }

        if (options.initialSnapshots) for (const [roomName, snapshot] of options.initialSnapshots) {
            const parsedSnapshot = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
            this.roomStates[roomName].creator.snapshot = parsedSnapshot;
        }

        this.defaultRoom = options.defaultRoom || null;
        this.currentRoomName = this.defaultRoom;
        this.roomViewManager = new RoomViewManager(width, height);
        this.tps = options.tps || "20x3";
        this.roomInitOptions = options.roomInitOptions || {};

        this.canvas = canvas;
        this.renderer = options.recycleRenderer || new Renderer(width, height, canvas);
        this.keyboardManager = theKeyboardManager;
        this.dragDropHandler = theDragDropHandler;

        this.domEventManager = options.domEventManager || {
            requestAnimationFrame(...args) { return window.requestAnimationFrame(...args);},
            addEventListener(target, event, listener, otps) { return target.addEventListener(event, listener, otps);},
            setInterval(...args) { return window.setInterval(...args);},
            setTimeout(...args) { return window.setTimeout(...args);},
        };

        /** time when last frame was rendered */
        this.lastFrame = 0;

        /** time spent simulating the last few frames */
        this.simLoad = [0];
        /** number of frames to spread load (TODO: make adaptive to tick rate */
        this.loadBalance = options.spreadLoadOverFrames || 4;
        /** time in ms we allow sim to lag behind before increasing sim budget */
        this.balanceMS = this.loadBalance * (1000 / 60);

        this.frameBound = this.frame.bind(this);
        this.loadRoomBound = this.loadRoom.bind(this);
    }

    async loadRoom(roomName) {
        const roomState = this.roomStates[roomName];
        if (!roomState) throw Error("Unknown room: " + roomName);
        if (roomState.namedModelsPromise) return roomState.namedModelsPromise;

        roomState.creator.room = roomName;
        roomState.creator.multiRoom = true;
        roomState.creator.multiSession = true;
        roomState.creator.autoSession = true;
        roomState.creator.login = true;
        roomState.creator.tps = this.tps;
        roomState.creator.destroyerFn = snapshot => {
            console.log("destroyer: detaching view for " + roomName);
            delete roomState.namedModels;
            delete roomState.namedModelsPromise;
            this.roomViewManager.detach(roomName);
            roomState.creator.snapshot = snapshot;
            if (this.currentRoomName === roomName) {
                displaySessionMoniker('', 'reset');
                console.log("destroyer: re-joining " + roomName);
                this.currentRoomName = null;
                this.joinRoom(roomName);
            }
        };
        roomState.creator.options = this.roomInitOptions;

        const controller = new Controller();
        roomState.namedModelsPromise = controller.establishSession(roomName, roomState.creator);
        roomState.controller = controller;
        roomState.namedModels = await roomState.namedModelsPromise;
        return roomState.namedModels;
    }

    traversePortalToRoom({targetRoom, targetPosition, targetQuaternion, targetVelocity}) {
        this.joinRoom(targetRoom, targetPosition, targetQuaternion, true, targetVelocity);
    }

    async joinRoom(roomName, cameraPosition=new THREE.Vector3(0, 2, 4), cameraQuaternion=new THREE.Quaternion(), overrideCamera, cameraVelocity) {
        if (!this.roomStates[roomName]) throw Error("Unknown room: " + roomName);
        if (this.currentRoomName === roomName) return;
        const hadSession = urlOptions.getSession().includes('/');
        await this.loadRoom(roomName);
        const prevRoomName = this.currentRoomName;
        const {controller} = this.roomStates[roomName];
        urlOptions.setSession(controller.session, !hadSession);
        window.parent.postMessage({session: controller.sesssion, url: window.location + ""}, "*");
        displaySessionMoniker(controller.id, 'reset');
        displayQRCode(window.location.href, 'qrcode');
        this.currentRoomName = roomName;
        // leave old room after changing current room (see destroyerFn above)
        this.roomViewManager.leave(prevRoomName, this.roomStates);
        // request ahead of render, set initial camera position if necessary
        this.roomViewManager.request(
            roomName,
            this.roomStates,
            {cameraPosition, cameraQuaternion, overrideCamera, cameraVelocity},
            info => this.traversePortalToRoom(info)
        );
    }

    /** simulate for a given time budget */
    simulate(deadline) {
        // simulate current room first
        const currentRoom = this.roomStates[this.currentRoomName];
        const namedModels = currentRoom && currentRoom.namedModels;
        const weHaveMoreTime = !namedModels || currentRoom.controller.simulate(deadline);
        if (!weHaveMoreTime) return;
        // if we have time, simulate other rooms
        const liveRooms = Object.values(this.roomStates).filter(room => room.namedModels);
        for (const {controller} of liveRooms) {
            controller.simulate(deadline);
        }
    }

    frame(timestamp) {
        this.domEventManager.requestAnimationFrame(this.frameBound);
        Stats.animationFrame(timestamp);
        if (this.currentRoomName) {
            const namedModels = this.roomStates[this.currentRoomName].namedModels;
            if (namedModels) {
                const simStart = Date.now();
                const simBudget = this.simLoad.reduce((a,b) => a + b, 0) / this.simLoad.length;
                // simulate about as long as in the prev frame to distribute load
                this.simulate(simStart + Math.min(simBudget, 200));
                // if backlogged, use all CPU time for simulation, but render at least at 5 fps
                const { backlog } = this.roomStates[this.currentRoomName].controller;
                if (backlog > this.balanceMS) this.simulate(simStart + 200 - simBudget);
                // keep log of sim times
                this.simLoad.push(Date.now() - simStart);
                if (this.simLoad.length > this.loadBalance) this.simLoad.shift();
                // update stats
                const {latency, users, lastReceived, lastSent} = this.roomStates[this.currentRoomName].controller;
                Stats.users(users);
                Stats.network(Date.now() - lastReceived);
                Stats.latency(latency);
                Stats.activity(Date.now() - lastSent);
                // remember lastFrame for setInterval()
                this.lastFrame = Date.now();
                // no view updates / render if backlogged
                if (backlog > 1000) return;
            }

            // update views from model
            Stats.begin("update");
            Object.values(this.roomStates).forEach(({controller}) => controller && controller.processModelViewEvents());
            Stats.end("update");

            // update view state
            const currentRoomView = this.roomViewManager.getIfLoaded(this.currentRoomName);
            if (currentRoomView) {
                // render views
                Stats.begin("render");
                this.renderer.render(this.currentRoomName, this.roomStates, this.loadRoomBound, this.roomViewManager);
                Stats.end("render");
                currentRoomView.parts.pointer.updatePointer();
                this.keyboardManager.setCurrentRoomView(currentRoomView);
                if (namedModels) this.dragDropHandler.setCurrentRoom(namedModels.room, currentRoomView);
            }
        }
    }

    start() {
        this.domEventManager.requestAnimationFrame(this.frameBound);

        // simulate even if rendering stopped
        this.domEventManager.setInterval(() => {
            // if we are rendering, do nothing
            if (Date.now() - this.lastFrame < 100) return;
            // otherwise, simulate a bit
            this.simulate(10);
        }, 10);

        this.setupEventHandlers();
    }

    get currentRoomView() {
        return this.currentRoomName && this.roomViewManager.getIfLoaded(this.currentRoomName);
    }

    setupEventHandlers() {
        const eventTimes = {};
        const throttle = event => {
            const now = Date.now();
            if (now - eventTimes[event.type] < (1000 / 20)) return true;
            eventTimes[event.type] = now;
            return false;
        };

        this.domEventManager.addEventListener(this.canvas, "mousemove", event => {
            if (!throttle(event)) {
                if (this.currentRoomView) this.currentRoomView.parts.pointer.onMouseMove(event.clientX, event.clientY);
            }
            event.preventDefault();

        });
        this.domEventManager.addEventListener(this.canvas, "mousedown", event => {
            if (this.currentRoomView) this.currentRoomView.parts.pointer.onMouseDown(event);
            event.preventDefault();
        });
        this.domEventManager.addEventListener(this.canvas, "mouseup", event => {
            if (this.currentRoomView) this.currentRoomView.parts.pointer.onMouseUp();
            event.preventDefault();
        });

        this.domEventManager.addEventListener(this.canvas, "touchstart", event => {
            if (this.currentRoomView) {
                this.currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
                this.currentRoomView.parts.pointer.updatePointer(true); // force to handle the touch
                this.currentRoomView.parts.pointer.onMouseDown();
            }
            event.preventDefault();
            event.stopPropagation();
        }, {passive: false});

        this.domEventManager.addEventListener(this.canvas, "touchmove", event => {
            if (!throttle(event)) {
                if (this.currentRoomView) {
                    this.currentRoomView.parts.pointer.onMouseMove(event.touches[0].clientX, event.touches[0].clientY);
                }
            }
            event.preventDefault();
            event.stopPropagation();
        }, {passive: false});

        this.domEventManager.addEventListener(this.canvas, "touchend", event => {
            if (this.currentRoomView) {this.currentRoomView.parts.pointer.onMouseUp();}
            event.preventDefault();
            event.stopPropagation();
        }, {passive: false});

        this.domEventManager.addEventListener(document.body, "wheel", event => {
            if (!throttle(event)) {
                if (this.currentRoomView && this.currentRoomView.parts.treadmill) {this.currentRoomView.parts.treadmill.onWheel(event);}
            }
            event.stopPropagation();
            event.preventDefault();
        }, {passive: false});

        this.domEventManager.addEventListener(window, "resize", () => {
            this.renderer.changeViewportSize(window.innerWidth, window.innerHeight);
            this.roomViewManager.changeViewportSize(window.innerWidth, window.innerHeight);
        });

        const roomFromSession = () => urlOptions.getSession().split("/")[0];
        this.domEventManager.addEventListener(window, "hashchange", () => this.joinRoom(roomFromSession()));

        this.domEventManager.addEventListener(document.getElementById('reset'), "click", () => {
            if (this.currentRoomName) {
                const { controller } = this.roomStates[this.currentRoomName];
                this.roomViewManager.detachAll();
                if (controller) controller.requestNewSession();
            }
        });

        // NB: per https://developer.mozilla.org/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations, one must cancel (e.g., preventDefault()) on dragenter and dragover events to indicate willingness to receive drop.
        this.domEventManager.addEventListener(this.canvas, "dragenter", event => {
            //console.log("ENTER");
            event.preventDefault();
        });

        this.domEventManager.addEventListener(this.canvas, "dragover", event => {
            //console.log("OVER");
            event.preventDefault();
        });

        this.domEventManager.addEventListener(this.canvas, "dragleave", event => {
            //console.log("LEAVE");
            event.preventDefault();
        });

        this.domEventManager.addEventListener(this.canvas, "drop", event => {
            event.preventDefault();
            this.dragDropHandler.onDrop(event);
        });

        this.keyboardManager.install(this.domEventManager);
    }
}
