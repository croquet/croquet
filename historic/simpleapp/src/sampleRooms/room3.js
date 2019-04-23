import * as THREE from "three";
import Room from "../room/roomModel";
import TextElement from "../elements/textElement";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

function initRoom3() {
    const room = Room.create();

    const text1 = TextElement.create({
        spatial: { position: new THREE.Vector3(-3, 1.5, 0) },
        text: {
            content: {
                runs: [{text: "man is much more than a tool builder... he is an inventor of universes... Except the real one."}],
            }
        },
        editable: true,
        viewOptions: {font: "Roboto", numLines: 10, width: 3, height: 3, editable: true},
    });
    room.parts.elements.add(text1);

    const text2 = TextElement.create({
        spatial: { position: new THREE.Vector3(3, 1, 0) },
        text: {
            content: {
                runs: [{text: "man is much more than a tool builder... he is an inventor of universes..."}],
            }
        },
        editable: true,
        viewOptions: {font: "Roboto", fontSize: 0.1, width: 3, height: 2, showScrollBar: false, editable: false}
    });
    room.parts.elements.add(text2);

    return {room};
}

export default { creatorFn: initRoom3 };
