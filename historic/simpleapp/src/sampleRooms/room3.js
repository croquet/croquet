import Island from '../island.js';
import Room from "../room/roomModel.js";
import { WarotaEditorObject } from '../objects/editableText.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

function initRoom3(state) {
    return new Island(state, island => {
        const room = new Room().init({});
        island.set("room", room);
        const text1 = new WarotaEditorObject().init({
            spatial: { position: {x: -3, y: 1, z: 0} },
            text: {
                content: {
                    content: [{text: "man is much more than a tool builder... he is an inventor of universes... Except the real one."}],
                    selections: {},
                    timezone: 0,
                    queue: []
                },
                font: "Roboto", numLines: 10, width: 3, height: 2
            }
        });
        room.parts.objects.add(text1);

        const text2 = new WarotaEditorObject().init({
            spatial: { position: {x: 3, y: 1, z: 0} },
            text: {
                content: {
                    content: [{text: "man is much more than a tool builder... he is an inventor of universes..."}],
                    selections: {},
                    timezone: 0,
                    queue: []
                },
                font: "Roboto", numLines: 10, width: 2, height: 2
            }
        });
        room.parts.objects.add(text2);
    });
}

export default {
    moduleID: module.id,
    creatorFn: initRoom3,
};
