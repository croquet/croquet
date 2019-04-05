import * as THREE from 'three';
import { StatePart } from '../modelView.js';
import SpatialPart from '../stateParts/spatial.js';
import PortalView from './portalView.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export const PortalEvents = {
    traversed: "portal-traversed",
    traverserMoved: "portal-traverserMoved",
    thereChanged: "portal-thereChanged"
};

export const PortalTopic = "topic-portals";

// export default clas

export default class PortalPart extends StatePart {
    constructor() {
        super();
        this.parts = {
            spatial: new SpatialPart(),
            spatialThere: new SpatialPart(),
        };
    }

    onInitialized() {
        this.subscribe(PortalEvents.traverserMoved, "onTraverserMoved", PortalTopic);
    }

    applyState(state) {
        super.applyState(state);
        this.there = state.there;
    }

    toState(state) {
        super.toState(state);
        state.there = this.there;
    }

    worldToLocal(position) {
        const matrixHere = new THREE.Matrix4().makeRotationFromQuaternion(this.parts.spatial.quaternion).setPosition(this.parts.spatial.position);
        const inverseMatrixHere = new THREE.Matrix4().getInverse(matrixHere);
        return position.clone().applyMatrix4(inverseMatrixHere);
    }

    projectThroughPortal(sourcePosition, sourceQuaternion) {
        const sourceInPortalCoords = this.worldToLocal(sourcePosition);
        const sourceToPortalQuaternionDelta = sourceQuaternion.clone().multiply(this.parts.spatial.quaternion.clone().inverse());

        const matrixThere = new THREE.Matrix4().makeRotationFromQuaternion(this.parts.spatialThere.quaternion).setPosition(this.parts.spatialThere.position);
        const targetPosition = this.parts.spatialThere.position.clone().add(sourceInPortalCoords.clone().applyMatrix4(matrixThere));
        const targetQuaternion = this.parts.spatialThere.quaternion.clone().multiply(sourceToPortalQuaternionDelta);

        return {targetPosition, targetQuaternion};
    }

    didTraverse(from, to) {
        const localFrom = this.worldToLocal(from);
        const localTo = this.worldToLocal(to);
        const size = this.parts.spatial.scale;

        // intersection with oriented, bounded plane. Should be easy to extend to oriented box (just add depth).
        if (localFrom.z > 0 &&  localTo.z < 0) {
            const intersectionPointRatio = Math.abs(localTo.z) / (Math.abs(localTo.z) + Math.abs(localFrom.z));
            const localIntersectionPoint = localFrom.lerp(localTo, intersectionPointRatio);
            if (Math.abs(localIntersectionPoint.x) < size.x / 2.0 && Math.abs(localIntersectionPoint.y) < size.y / 2.0) {
                return true;
            }
        }
        return false;
    }

    onTraverserMoved({fromPosition, toPosition, toQuaternion, traverserId}) {
        if (this.didTraverse(fromPosition, toPosition)) {
            const {targetPosition, targetQuaternion} = this.projectThroughPortal(toPosition, toQuaternion);
            this.publish(PortalEvents.traversed, {
                portalId: this.id,
                traverserId,
                targetRoom: this.there,
                targetPosition,
                targetQuaternion
            }, PortalTopic, null);
        }
    }

    naturalViewClass() {
        return PortalView;
    }
}

export function PortalTraversing(BaseSpatialPartClass) {
    return class PortalTraversingSpatial extends BaseSpatialPartClass {
        moveTo(...args) {
            const fromPosition = this.position.clone();
            super.moveTo(...args);
            const toPosition = this.position.clone();
            const toQuaternion = this.quaternion.clone();
            this.publish(PortalEvents.traverserMoved, {fromPosition, toPosition, toQuaternion, traverserId: this.id}, PortalTopic, null);
        }

        moveBy(...args) {
            const fromPosition = this.position.clone();
            super.moveBy(...args);
            const toPosition = this.position.clone();
            const toQuaternion = this.quaternion.clone();
            this.publish(PortalEvents.traverserMoved, {fromPosition, toPosition, toQuaternion, traverserId: this.id}, PortalTopic, null);
        }

        moveToNoPortalTraverse(...args) {
            super.moveTo(...args);
        }

        moveByNoPortalTraverse(...args) {
            super.moveBy(...args);
        }
    };
}
