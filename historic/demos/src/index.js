import { DemoApp /*, theDragDropHandler */ } from "@croquet/kit";
import { urlOptions } from "@croquet/util";
import kitchenSink from "./rooms/kitchenSink/kitchenSink";
import portals from "./rooms/portals/portals";
import text from "./rooms/text/text";
import bounce from "./rooms/bounce/bounce";
import physics from "./rooms/physics/physics";
import jenga from "./rooms/jenga/jenga";
import minipool from "./rooms/minipool/minipool";
import knockdown from "./rooms/knockdown/knockdown";
import blockfall from "./rooms/blockfall/blockfall";
import jumpRooms from "./rooms/jump/jump";
import arBalls from "./rooms/arBalls/arBalls";

const tps = "20x3"; // 20 ticks/s from server, 60 t/s total

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
    blockfall,
    ...jumpRooms
};

const app = new DemoApp(
    rooms,
    document.getElementById("qanvas"),
    window.innerWidth,
    window.innerHeight,
    {
        tps,
        roomInitOptions: {...urlOptions},
    }
);

const roomFromSession = () => urlOptions.getSession().split("/")[0];
const startRoom = roomFromSession() || defaultRoom;
app.joinRoom(startRoom);

/*
if (urlOptions.ar) hotreloadEventManager.addDisposeHandler('ar', () => {
    try { app.renderer.arToolkitContext.arController.dispose(); }
    catch (e) { }
});
*/

app.start();
