import * as THREE from "three";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/** A spatial model with inertia
 * @arg {typeof import('./spatial.js').default} BaseSpatialPartClass
*/
export default function Inertial() {
    return BaseSpatialPartClass => class InertialSpatialPart extends BaseSpatialPartClass {
        init(options={}, id) {
            super.init(options, id);
            this.estimatedVelocity = new THREE.Vector3(0, 0, 0);
            this.estimatedRotationalVelocity = new THREE.Quaternion();
            this.dampening = options.dampening || 0.01;
        }

        moveBy(delta, addInertia=true) {
            super.moveBy(delta);
            if (addInertia) this.estimatedVelocity.copy(this.estimatedVelocity.clone().multiplyScalar(0.7).addScaledVector(delta, 0.3));
            this.startInertiaPhase();
        }

        moveTo(newPosition, addInertia=true) {
            const positionBefore = this.position.clone();
            super.moveTo(newPosition);
            const delta = newPosition.sub(positionBefore);
            if (addInertia) this.estimatedVelocity.copy(this.estimatedVelocity.clone().multiplyScalar(0.7).addScaledVector(delta, 0.3));
            this.startInertiaPhase();
        }

        rotateBy(deltaQuaternion, addInertia=true) {
            super.rotateBy(deltaQuaternion);
            if (addInertia) this.estimatedRotationalVelocity.copy(this.estimatedRotationalVelocity.clone().slerp(deltaQuaternion, 0.3));
            this.startInertiaPhase();
        }

        rotateTo(quaternion, addInertia=true) {
            const deltaQuaternion = quaternion.clone().multiply(this.quaternion.clone().inverse());
            super.rotateTo(quaternion);
            if (addInertia) this.estimatedRotationalVelocity.copy(this.estimatedRotationalVelocity.clone().slerp(deltaQuaternion, 0.3));
            this.startInertiaPhase();
        }

        stop() {
            this.estimatedVelocity = new THREE.Vector3(0, 0, 0);
            this.estimatedRotationalVelocity = new THREE.Quaternion();
            this.inInertiaPhase = false;
        }

        setVelocity(velocity) {
            this.estimatedVelocity.copy(velocity);
            this.startInertiaPhase();
        }

        startInertiaPhase() {
            if (!this.inInertiaPhase) {
                this.inInertiaPhase = true;
                this.future(1000 / 60).applyVelocity();
            }
        }

        applyVelocity() {
            if (this.inInertiaPhase) {
                super.moveBy(this.estimatedVelocity.clone());
                super.rotateBy(this.estimatedRotationalVelocity.clone());
                this.estimatedVelocity.multiplyScalar(1 - this.dampening);
                this.estimatedRotationalVelocity.slerp(new THREE.Quaternion(), this.dampening);
                if (this.shouldStop()) this.inInertiaPhase = false;
                else this.future(1000 / 60).applyVelocity();
            }
        }

        shouldStop() {
            return this.estimatedVelocity.manhattanLength() +
                this.estimatedRotationalVelocity.manhattanLength() - 1 < 0.00001;
        }
    };
}

if (!THREE.Quaternion.prototype.manhattanLength) THREE.Quaternion.prototype.manhattanLength = function() {
    return Math.abs(this._x) + Math.abs(this._y) + Math.abs(this._z) + Math.abs(this._w);
};
