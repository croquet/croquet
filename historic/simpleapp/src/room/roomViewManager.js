import RoomView from "./roomView.js";

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

    request(roomName, allRooms, initialCameraPosition) {
        if (!this.activeRoomViews[roomName]) {
            const island = allRooms[roomName].island;
            const room = allRooms[roomName].room;

            if (!this.activeRoomViews[roomName]) {
                const roomView = new RoomView(island, {
                    activeParticipant: true,
                    width: this.viewportWidth,
                    height: this.viewportHeight,
                    cameraPosition: initialCameraPosition
                });
                roomView.attach(room);
                this.activeRoomViews[roomName] = roomView;
            }
        }

        // might return null in the future if roomViews are constructed asynchronously
        return this.activeRoomViews[roomName];
    }

    requestPassive(roomName, allRooms, initialCameraPosition) {
        if (!this.passiveRoomViews[roomName]) {
            const island = allRooms[roomName].island;
            const room = allRooms[roomName].room;

            if (!this.passiveRoomViews[roomName]) {
                const roomView = new RoomView(island, {
                    activeParticipant: false,
                    width: this.viewportWidth,
                    height: this.viewportHeight,
                    cameraPosition: initialCameraPosition
                });
                roomView.attach(room);
                this.passiveRoomViews[roomName] = roomView;
            }
        }

        // might return null in the future if roomViews are constructed asynchronously
        return this.passiveRoomViews[roomName];
    }

    detachAll() {
        for (const roomView of Object.values(this.activeRoomViews)) {
            roomView.detach();
        }
        for (const roomView of Object.values(this.passiveRoomViews)) {
            roomView.detach();
        }
    }
}
