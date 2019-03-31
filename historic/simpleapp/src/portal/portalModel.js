import * as THREE from 'three';
import { StatePart } from '../modelView.js';
import SpatialPart, { SpatialEvents } from '../stateParts/spatial.js';
import PortalView from './portalView.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

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
        const size = this.owner.parts[this.sizePartId].value;

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

    /** @arg {{from: THREE.Vector3, to: THREE.Vector3, traverserRef: string}} data */
    onTraverserMoved({from, to, traverserRef}) {
        if (this.didTraverse(from, to)) {
            this.publish(PortalEvents.traversed, {portalRef: this.asPartRef(), traverserRef}, PortalTopic, null);
        }
    }

    naturalViewClass() {
        return PortalView;
    }
}

export class PortalTraverserPart extends StatePart {
    constructor(options) {
        super();
        // this.spatialName = options.spatialName || "spatial";
        // this.subscribe(SpatialEvents.moved, "onMoved", this.owner.id, this.spatialName);
    }

    applyState(state) {
        super.applyState(state);
        // this.lastPosition = state.lastPosition || this.owner.parts[this.spatialName].position;
    }

    toState(state) {
        super.toState(state);
        state.lastPosition = this.lastPosition;
    }

    onMoved(newPosition) {
        this.publish(PortalEvents.traverserMoved, {from: this.lastPosition, to: newPosition, traverserRef: this.asPartRef()}, PortalTopic, null);
        this.lastPosition = newPosition.clone();
    }
}
