import RoomView from "./roomView";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class RoomViewManager {
    constructor(width, height) {
        /** @type { { String: RoomView } } rooms we are actively participating in */
        this.activeRoomViews = {};
        /** @type { { String: RoomView } } rooms we see through a portal */
        this.passiveRoomViews = {};
        this.changeViewportSize(width, height);
    }

    changeViewportSize(width, height) {
        this.viewportWidth = width;
        this.viewportHeight = height;
        for (const roomView of Object.values(this.activeRoomViews)) {
            roomView.parts.camera.setSize(width, height);
        }
        for (const roomView of Object.values(this.passiveRoomViews)) {
            roomView.parts.camera.setSize(width, height);
        }
    }

    moveCamera(roomName, cameraPosition, cameraQuaternion, cameraVelocity) {
        const cameraSpatialPart = this.activeRoomViews[roomName].cameraSpatial;
        cameraSpatialPart.moveToNoPortalTraverse(cameraPosition, false);
        cameraSpatialPart.rotateTo(cameraQuaternion, false);
        cameraSpatialPart.stop();
        if (cameraVelocity) cameraSpatialPart.setVelocity(cameraVelocity);
    }

    request(roomName, allRooms, {cameraPosition, cameraQuaternion, overrideCamera, cameraVelocity, addElementManipulators}, traversePortalToRoom) {
        if (this.activeRoomViews[roomName]) {
            if (overrideCamera) {
                this.moveCamera(roomName, cameraPosition, cameraQuaternion, cameraVelocity);
            }
        } else {
            const room = allRooms[roomName].namedModels.room;

            allRooms[roomName].controller.inViewRealm(() => {
                const roomView = new RoomView({
                    room,
                    activeParticipant: true,
                    width: this.viewportWidth,
                    height: this.viewportHeight,
                    cameraPosition,
                    cameraQuaternion,
                    addElementManipulators,
                    traversePortalToRoom,
                });
                this.activeRoomViews[roomName] = roomView;
                console.log(`ROOMVIEWS active: [${Object.keys(this.activeRoomViews).join(', ')}], passive: [${Object.keys(this.passiveRoomViews).join(',')}]`);
            });
        }

        // might return null in the future if roomViews are constructed asynchronously
        return this.activeRoomViews[roomName];
    }

    leave(roomName, allRooms) {
        if (this.activeRoomViews[roomName]) {
            this.activeRoomViews[roomName].detach();
            delete this.activeRoomViews[roomName];
        }
        if (!this.passiveRoomViews[roomName] && allRooms[roomName]) {
            const controller = allRooms[roomName].controller;
            if (controller) controller.leave(true);
        }
        console.log(`ROOMVIEWS active: [${Object.keys(this.activeRoomViews).join(', ')}], passive: [${Object.keys(this.passiveRoomViews).join(',')}]`);
    }

    getIfLoaded(roomName) {
        return this.activeRoomViews[roomName];
    }

    /** @param {String} roomName */
    expect(roomName) {
        const roomView = this.activeRoomViews[roomName];
        if (!roomView) {
            throw Error(`Expected RoomView for ${roomName} to already exist.`);
        }
        return roomView;
    }

    requestPassive(roomName, allRooms, loadRoom, initialCameraPosition) {
        if (!this.passiveRoomViews[roomName]) {
            if (!allRooms[roomName].namedModels) {
                loadRoom(roomName);
                return null;
            }
            const room = allRooms[roomName].namedModels.room;

            allRooms[roomName].controller.inViewRealm(() => {
                const roomView = new RoomView({
                    room,
                    activeParticipant: false,
                    width: this.viewportWidth,
                    height: this.viewportHeight,
                    cameraPosition: initialCameraPosition
                });
                this.passiveRoomViews[roomName] = roomView;
                console.log(`ROOMVIEWS active: [${Object.keys(this.activeRoomViews).join(', ')}], passive: [${Object.keys(this.passiveRoomViews).join(',')}]`);
            });
        }

        return this.passiveRoomViews[roomName];
    }

    detach(roomName) {
        if (this.activeRoomViews[roomName]) {
            this.activeRoomViews[roomName].detach();
            delete this.activeRoomViews[roomName];
        }
        if (this.passiveRoomViews[roomName]) {
            this.passiveRoomViews[roomName].detach();
            delete this.passiveRoomViews[roomName];
        }
        console.log(`ROOMVIEWS active: [${Object.keys(this.activeRoomViews).join(', ')}], passive: [${Object.keys(this.passiveRoomViews).join(',')}]`);
    }

    detachAll() {
        for (const roomView of Object.values(this.activeRoomViews)) {
            roomView.detach();
        }
        for (const roomView of Object.values(this.passiveRoomViews)) {
            roomView.detach();
        }
        this.activeRoomViews = {};
        this.passiveRoomViews = {};
        console.log(`ROOMVIEWS active: [], passive: []`);
    }
}
