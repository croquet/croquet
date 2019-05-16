import { Room, TextElement, THREE } from "@croquet/kit";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default function initText() {
    const room = Room.create();

    const text1 = TextElement.create({
        spatial: { position: new THREE.Vector3(-2, 1.5, 0) },
        text: {
            content: {
                runs: [{text: "man is much more than a tool builder... he is an inventor of universes... Except the real one."}],
            }
        },
        editable: true,
        visualOptions: {font: "Barlow", numLines: 10, width: 3, height: 3, editable: true},
    });
    room.parts.elements.add(text1);

    const runs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => {
        return {text: 'Croquet is awesome ', style: {color: `hsl(${i * 30}, 100%, 50%)`}};
    });

    const text2 = TextElement.create({
        spatial: { position: new THREE.Vector3(3, 1, 0) },
        text: {
            content: {
                runs,
            }
        },
        editable: false,
        visualOptions: {font: "Barlow", fontSize: 0.1, width: 3, height: 2, showScrollBar: false, editable: false, singleLine: true, autoResize: true}
    });
    room.parts.elements.add(text2);

    return {room};
}
