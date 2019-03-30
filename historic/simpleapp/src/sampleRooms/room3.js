import Island from '../island.js';
import Room from "../room/roomModel.js";
import { CarotaEditorObject } from '../objects/editableText.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

function initRoom3(state) {
    return new Island(state, island => {
        const room = new Room().init({});
        island.set("room", room);
        const text1 = new CarotaEditorObject().init({
            spatial: { position: {x: -3, y: 1, z: 0} },
            text: { content: [{text: "man is much more than a tool builder... he is an inventor of universes... Except the real one."}], font: "Roboto", numLines: 10, width: 3, height: 2}
        });
        room.parts.objects.add(text1);
    });
}

export default {
    moduleID: module.id,
    creatorFn: initRoom3,
};
