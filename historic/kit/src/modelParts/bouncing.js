import * as THREE from "three";
import Inertial from "./inertial";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

/** A spatial model with inertia, gravity, and bouncing
 * @arg {typeof import('./spatial.js').default} BaseSpatialPartClass
*/
export default function Bouncing() {
    return BaseSpatialPartClass => class BouncingSpatialPart extends Inertial()(BaseSpatialPartClass) {
        init(options={}, id) {
            super.init(options, id);
            this.gravity = options.gravity || new THREE.Vector3(0, -0.001, 0);
            this.bounce = options.bounce || 0.1;
            this.startInertiaPhase();
        }

        applyVelocity() {
            if (this.inInertiaPhase) {
                this.estimatedVelocity.add(this.gravity);
                let bounce = false;
                if (this.position.y < 0.5) { this.estimatedVelocity.y = Math.abs(this.estimatedVelocity.y); this.position.y = 0.5; bounce = true; }
                if (this.position.x < -10) { this.estimatedVelocity.x = Math.abs(this.estimatedVelocity.x); this.position.x = -10; bounce = true; }
                if (this.position.x > 10) { this.estimatedVelocity.x = -Math.abs(this.estimatedVelocity.x); this.position.x =  10; bounce = true; }
                if (this.position.z < -10) { this.estimatedVelocity.z = Math.abs(this.estimatedVelocity.z); this.position.z = -10; bounce = true; }
                if (this.position.z > 10) { this.estimatedVelocity.z = -Math.abs(this.estimatedVelocity.z); this.position.z =  10; bounce = true; }
                if (bounce) {
                    const random = axis => this.random() * this.bounce * (Math.sign(this.estimatedVelocity[axis]) || this.random() - 0.5);
                    this.estimatedVelocity.x += random('x');
                    this.estimatedVelocity.y += random('y');
                    this.estimatedVelocity.z += random('z');
                }
                const speed = this.estimatedVelocity.length();
                if (speed > 1) this.estimatedVelocity.multiplyScalar(0.5);
                super.applyVelocity();
            }
        }

        shouldStop() { return false; }

        toggle() {
            if (this.inInertiaPhase) this.stop();
            else this.startInertiaPhase();
        }
    };
}
