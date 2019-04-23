import * as THREE from "three";
import { ModelPart } from "../parts";
import SpatialPart from "./spatial";
import PortalViewPart from "../viewParts/portalView";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const PortalEvents = {
    traversed: "portal-traversed",
    traverserMoved: "portal-traverserMoved",
    thereChanged: "portal-thereChanged"
};

export const PortalTopicPrefix = "topic-portals-";

// export default clas

export default class PortalPart extends ModelPart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart(),
            spatialThere: new SpatialPart(),
        };
    }

    init(options, id) {
        super.init(options, id);
        this.there = options.there;
        this.roomId = options.roomId;
        this.subscribe(PortalTopicPrefix + this.roomId, PortalEvents.traverserMoved, data => this.onTraverserMoved(data));
    }

    load(state, allModels) {
        super.load(state, allModels);
        this.there = state.there;
        this.roomId = state.roomId;
    }

    save(state) {
        super.save(state);
        state.there = this.there;
        state.roomId = this.roomId;
    }

    worldToLocal(position) {
        const matrixHere = new THREE.Matrix4().makeRotationFromQuaternion(this.parts.spatial.quaternion).setPosition(this.parts.spatial.position);
        const inverseMatrixHere = new THREE.Matrix4().getInverse(matrixHere);
        return position.clone().applyMatrix4(inverseMatrixHere);
    }

    projectThroughPortal(sourcePosition, sourceQuaternion, sourceVelocity) {
        const sourceInPortalCoords = this.worldToLocal(sourcePosition);
        const sourceToPortalQuaternionDelta = sourceQuaternion.clone().multiply(this.parts.spatial.quaternion.clone().inverse());

        const matrixThere = new THREE.Matrix4().makeRotationFromQuaternion(this.parts.spatialThere.quaternion).setPosition(this.parts.spatialThere.position);
        const targetPosition = this.parts.spatialThere.position.clone().add(sourceInPortalCoords.clone().applyMatrix4(matrixThere));
        const targetQuaternion = this.parts.spatialThere.quaternion.clone().multiply(sourceToPortalQuaternionDelta);

        let targetVelocity;

        if (sourceVelocity) {
            targetVelocity = sourceVelocity.clone().applyQuaternion(this.parts.spatial.quaternion.clone().inverse()).applyQuaternion(this.parts.spatialThere.quaternion);
        }

        return {targetPosition, targetQuaternion, targetVelocity};
    }

    didTraverse(from, to) {
        const localFrom = this.worldToLocal(from);
        const localTo = this.worldToLocal(to);
        const size = this.parts.spatial.scale;

        // intersection with oriented, bounded plane. Should be easy to extend to oriented box (just add depth).
        if (localFrom.z > -0.1 && localTo.z < 0.1) {
            //const intersectionPointRatio = Math.abs(localTo.z) / (Math.abs(localTo.z) + Math.abs(localFrom.z));
            const localIntersectionPoint = localTo;//localFrom.lerp(localTo, intersectionPointRatio);
            if (Math.abs(localIntersectionPoint.x) < size.x / 2.0 && Math.abs(localIntersectionPoint.y) < size.y / 2.0) {
                return true;
            }
        }
        return false;
    }

    onTraverserMoved(data /*{fromPosition, toPosition, toQuaternion, traverserId}*/) {
        // TODO: workaround until we get generic message encoding
        const fromPosition = new THREE.Vector3().copy(data.fromPosition);
        const toPosition = new THREE.Vector3().copy(data.toPosition);
        const toQuaternion = new THREE.Quaternion().copy(data.toQuaternion);
        const estimatedVelocity = data.estimatedVelocity && new THREE.Vector3().copy(data.estimatedVelocity);
        const traverserId = data.traverserId;
        if (this.didTraverse(fromPosition, toPosition)) {
            const {targetPosition, targetQuaternion, targetVelocity} = this.projectThroughPortal(toPosition, toQuaternion, estimatedVelocity);
            this.publish(PortalTopicPrefix + this.roomId, PortalEvents.traversed, {
                portalId: this.id,
                traverserId,
                targetRoom: this.there,
                targetPosition,
                targetQuaternion,
                targetVelocity
            });
        }
    }

    naturalViewClass() {
        return PortalViewPart;
    }
}

export function PortalTraversing(traverseOptions) {
    return BaseSpatialPartClass => class PortalTraversingSpatial extends BaseSpatialPartClass {
        moveTo(...args) {
            const fromPosition = this.position.clone();
            super.moveTo(...args);
            const toPosition = this.position.clone();
            const toQuaternion = this.quaternion.clone();
            this.publish(PortalTopicPrefix + traverseOptions.roomId, PortalEvents.traverserMoved, {
                fromPosition, toPosition, toQuaternion, traverserId: this.id, estimatedVelocity: this.estimatedVelocity && this.estimatedVelocity.clone()
            });
        }

        moveBy(...args) {
            const fromPosition = this.position.clone();
            super.moveBy(...args);
            const toPosition = this.position.clone();
            const toQuaternion = this.quaternion.clone();
            this.publish(PortalTopicPrefix + traverseOptions.roomId, PortalEvents.traverserMoved, {
                fromPosition, toPosition, toQuaternion, traverserId: this.id, estimatedVelocity: this.estimatedVelocity && this.estimatedVelocity.clone()
            });
        }

        moveToNoPortalTraverse(...args) {
            super.moveTo(...args);
        }

        moveByNoPortalTraverse(...args) {
            super.moveBy(...args);
        }
    };
}
