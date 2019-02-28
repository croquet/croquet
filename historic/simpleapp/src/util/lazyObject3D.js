import * as THREE from 'three';

const moduleVersion = module.id + " #" + (module.bundle.v = (module.bundle.v || 0) + 1);
console.log("Loading " + moduleVersion);

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
