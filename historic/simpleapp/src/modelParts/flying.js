import * as THREE from "three";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/** A spatial model with gravity
 * @arg {typeof import('./spatial.js').default} BaseSpatialPartClass
*/
export default function Flying() {
    return BaseSpatialPartClass => class FlyingSpatialPart extends BaseSpatialPartClass {
        init(options={}, id) {
            super.init(options, id);
            this.gravity = options.gravity || new THREE.Vector3(0, -0.001, 0);
            const vscale = 0.1;
            this.estimatedVelocity = options.velocity || new THREE.Vector3(vscale*(this.random()-0.5), vscale*(this.random()-0.5), vscale*(this.random()-0.5));
            this.future(1000 / 60).applyVelocity();
        }

        load(state, allModels) {
            super.load(state, allModels);
            this.gravity = new THREE.Vector3().fromArray(state.gravity);
            this.estimatedVelocity = new THREE.Vector3().fromArray(state.estimatedVelocity);
        }

        save(state) {
            super.save(state);
            state.gravity = this.gravity.toArray(state.gravity);
            state.estimatedVelocity = this.estimatedVelocity.toArray();
        }

        applyVelocity() {
            super.moveBy(this.estimatedVelocity.clone());
            this.estimatedVelocity.add(this.gravity);
            const speed = this.estimatedVelocity.length();
            if (speed > 1) this.estimatedVelocity.multiplyScalar(0.5);
            this.future(1000 / 60).applyVelocity();
        }

        shouldStop() { return false; }
    };
}
