import Island from '../island.js';
import Room from "../room/roomModel.js";
import { Editor } from '../objects/editableText.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export default function initRoom3(state) {
    state = { id: "2bb90375ea596139cc2cdcf474df4118", ...state };
    return new Island(state, () => {
        const room = new Room();
        const text1 = new Editor({
            spatial: { position: {x: -3, y: 1, z: 0} },
            editableText: { content: [{text: "man is much more than a tool builder... he is an inventor of universes... Except the real one."}], font: "Roboto", numLines: 10, width: 3, height: 2}
        },
        {
            editable: true,
        });
        room.parts.objects.add(text1);
    });
}
