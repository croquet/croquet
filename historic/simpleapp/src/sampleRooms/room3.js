import Island from '../island.js';
import Room from "../room/roomModel.js";
import { Editor } from '../objects/editableText.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

function initRoom3(state) {
    return new Island(state, () => {
        const room = new Room();
        const text1 = new Editor({
            spatial: { position: {x: -3, y: 1, z: 0} },
            editableText: {
                content: {
                    content: [{text: "man is much more than a tool builder... he is an inventor of universes... Except the real one."}],
                    selection: {start: 0, end: 0}},
                }},
            {
                editable: true,
                font: "Roboto", numLines: 10, width: 3, height: 2
            });
        room.parts.objects.add(text1);

        const text2 = new Editor({
            spatial: { position: {x: 3, y: 1, z: 0} },
            editableText: {
                content: {
                    content: [{text: "man is much more than a tool builder... he is an inventor of universes..."}],
                    selection: {start: 0, end: 0}},
                }},
            {
                editable: true,
                font: "Barlow", numLines: 10, width: 3, height: 2
            });
        room.parts.objects.add(text2);
    });
}

export default {
    moduleID: module.id,
    creatorFn: initRoom3,
};
