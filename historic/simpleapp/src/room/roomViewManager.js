import RoomView from "./roomView";
import { inViewRealm } from "../modelView";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class RoomViewManager {
    constructor(width, height) {
        this.activeRoomViews = {};
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

    moveCamera(roomName, cameraPosition, cameraQuaternion) {
        const cameraSpatialPart = this.activeRoomViews[roomName].viewState.parts.cameraSpatial;
        cameraSpatialPart.moveToNoPortalTraverse(cameraPosition, false);
        cameraSpatialPart.rotateTo(cameraQuaternion, false);
        cameraSpatialPart.stop();
    }

    request(roomName, allRooms, {cameraPosition, cameraQuaternion, overrideCamera}, traversePortalToRoom) {
        if (this.activeRoomViews[roomName]) {
            if (overrideCamera) {
                this.moveCamera(roomName, cameraPosition, cameraQuaternion);
            }
        } else {
            const island = allRooms[roomName].island;
            const room = island.get("room");

            inViewRealm(island, () => {
                const roomView = new RoomView({
                    room,
                    activeParticipant: true,
                    width: this.viewportWidth,
                    height: this.viewportHeight,
                    cameraPosition,
                    cameraQuaternion,
                    traversePortalToRoom,
                });
                this.activeRoomViews[roomName] = roomView;
            });
        }

        // might return null in the future if roomViews are constructed asynchronously
        return this.activeRoomViews[roomName];
    }

    getIfLoaded(roomName) {
        return this.activeRoomViews[roomName];
    }

    expect(roomName) {
        const roomView = this.activeRoomViews[roomName];
        if (!roomView) {
            throw new Error(`Expected RoomView for ${roomName} to already exist.`);
        }
        return roomView;
    }

    requestPassive(roomName, allRooms, initialCameraPosition) {
        if (!this.passiveRoomViews[roomName]) {
            const island = allRooms[roomName].island;

            if (!island) { allRooms.getIsland(roomName); return null; }

            const room = island.get("room");

            inViewRealm(island, () => {
                const roomView = new RoomView({
                    room,
                    activeParticipant: false,
                    width: this.viewportWidth,
                    height: this.viewportHeight,
                    cameraPosition: initialCameraPosition
                });
                this.passiveRoomViews[roomName] = roomView;
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
    }
}
