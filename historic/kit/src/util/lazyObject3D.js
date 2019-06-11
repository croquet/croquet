import * as THREE from "three";

export default class LazyObject3D extends THREE.Group {
    constructor(placeholder, object3DPromise) {
        super();

        if (placeholder) {
            this.currentObject3D = placeholder;
            this.add(placeholder);
        }

        if (object3DPromise) this.replace(object3DPromise);
    }

    replace(object3DPromise) {
        this.newestPromise = object3DPromise;
        this.loading = true;
        object3DPromise.then(object3D => {
            if (this.newestPromise === object3DPromise) {
                // TODO: who should handle disposal?
                if (this.currentObject3D) this.remove(this.currentObject3D);
                this.currentObject3D = object3D;
                this.add(object3D);
                this.loading = false;
                this.newestPromise = undefined;
            }
        }).catch(error => console.error(error));
    }
}
