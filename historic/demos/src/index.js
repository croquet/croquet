import { App /*, theDragDropHandler */ } from "@croquet/kit";
import { hotreloadEventManager, urlOptions } from "@croquet/util";
import kitchenSink from "./rooms/kitchenSink/kitchenSink";
import portals from "./rooms/portals/portals";
import text from "./rooms/text/text";
import bounce from "./rooms/bounce/bounce";
import physics from "./rooms/physics/physics";
import jenga from "./rooms/jenga/jenga";
import minipool from "./rooms/minipool/minipool";
import knockdown from "./rooms/knockdown/knockdown";
import jumpRooms from "./rooms/jump/jump";
import arBalls from "./rooms/arBalls/arBalls";

const tps = "20x3"; // 20 ticks/s from server, 60 t/s total
const LOG_HOTRELOAD = true;

const hotState = module.hot && module.hot.data || {};

const defaultRoom = urlOptions.ar ? "arBalls" : "bounce";

const rooms = {
    kitchenSink,
    portals,
    text,
    bounce,
    arBalls,
    physics,
    jenga,
    knockdown,
    minipool,
    ...jumpRooms
};

const app = new App(
    rooms,
    urlOptions.reflector || "wss://dev1.os.vision/reflector-v1",
    document.getElementById("qanvas"),
    window.innerWidth,
    window.innerHeight,
    {
        initialSnapshots: urlOptions.hotreload && hotState.roomSnapshots,
        recycleRenderer: urlOptions.hotreload && hotState.renderer,
        domEventManager: urlOptions.hotreload && hotreloadEventManager,
        tps,
        roomInitOptions: {...urlOptions},
    }
);

const roomFromSession = () => urlOptions.getSession().split("/")[0];
const startRoom = hotState.currentRoomName || roomFromSession() || defaultRoom;
app.joinRoom(startRoom);

if (urlOptions.ar) hotreloadEventManager.addDisposeHandler('ar', () => {
    try { app.renderer.arToolkitContext.arController.dispose(); }
    catch (e) { /* empty */ }
});

if (module.hot) {
    if (urlOptions.hotreload) module.hot.accept();

    // our hot-reload strategy is to reload all the code (meaning no reload
    // handlers in individual modules) but store the complete model state
    // in this dispose handler and restore it in start()
    module.hot.dispose(hotData => {
        // release WebGL resources
        app.roomViewManager.detachAll();
        // preserve state, will be available as module.hot.data after reload
        Object.assign(hotData, {
            renderer: app.renderer,
            roomSnapshots: {},
            currentRoomName: app.currentRoomName
        });

        for (const [name, {island}] of Object.entries(app.roomStates)) {
            if (island) hotData.roomSnapshots[name] = JSON.stringify(island.asState());
        }

        // preserve hotState
        Object.assign(hotData, hotState);
        hotreloadEventManager.dispose(); // specifically, cancel our delayed start()
    });
    // start logging module loads
    if (LOG_HOTRELOAD && !module.bundle.v) module.bundle.v = {};
}

// delay start to let hotreload finish to load all modules
if (!hotState.renderer) app.start();
else hotreloadEventManager.setTimeout(() => app.start, 0);
