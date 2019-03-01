import * as THREE from 'three';

if (module.bundle.v) console.log(`Hot reload ${module.bundle.v++}: ${module.id}`);

export default class LazyObject3D extends THREE.Group {
    constructor(placeholder, object3DPromise) {
        super();

        if (placeholder) {
            this.placeholder = placeholder;
            this.add(placeholder);
        }

        object3DPromise.then(object3D => {
            if (this.placeholder) this.remove(this.placeholder);
            this.add(object3D);
        });
    }
}
