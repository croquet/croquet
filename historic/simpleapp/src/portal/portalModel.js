import * as THREE from 'three';
import StatePart from '../statePart.js';
import SpatialPart, { SpatialEvents } from '../stateParts/spatial.js';
import SizePart from '../stateParts/size.js';
import Model from '../model.js';
import PortalView from './portalView.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const PortalEvents = {
    traversed: "portal-traversed",
    traverserMoved: "portal-traverserMoved",
    thereChanged: "portal-thereChanged"
};

export const PortalTopic = "topic-portals";

export default class Portal extends Model {
    buildParts(state={}, _options={}) {
        new SpatialPart(this, state);
        new SpatialPart(this, state, {id: "thereSpatial"});
        new SizePart(this, state);
        new PortalPart(this, state);
    }

    naturalViewClass() {
        return PortalView;
    }
}

export class PortalPart extends StatePart {
    fromState(state={}, options={}) {
        this.hereSpatialPartId = options.hereSpatialPartId || "spatial";
        this.thereSpatialPartId = options.thereSpatialPartId || "thereSpatial";
        this.sizePartId = options.sizePartId || "size";
        this.there = state.there;
        this.subscribe(PortalEvents.traverserMoved, "onTraverserMoved", PortalTopic, null);
    }

    toState(state) {
        super.toState(state);
        state.width = this.width;
        state.height = this.height;
        state.there = this.there;
    }

    worldToLocal(position) {
        const spatialHere = this.owner.parts[this.hereSpatialPartId];

        const matrixHere = new THREE.Matrix4().makeRotationFromQuaternion(spatialHere.quaternion).setPosition(spatialHere.position);
        const inverseMatrixHere = new THREE.Matrix4().getInverse(matrixHere);
        return position.clone().applyMatrix4(inverseMatrixHere);
    }

    projectThroughPortal(sourcePosition, sourceQuaternion) {
        const spatialHere = this.owner.parts[this.hereSpatialPartId];
        const spatialThere = this.owner.parts[this.thereSpatialPartId];

        const sourceInPortalCoords = this.worldToLocal(sourcePosition);
        const sourceToPortalQuaternionDelta = sourceQuaternion.clone().multiply(spatialHere.quaternion.clone().inverse());

        const matrixThere = new THREE.Matrix4().makeRotationFromQuaternion(spatialThere.quaternion).setPosition(spatialThere.position);
        const targetPosition = spatialThere.position.clone().add(sourceInPortalCoords.clone().applyMatrix4(matrixThere));
        const targetQuaternion = spatialThere.quaternion.clone().multiply(sourceToPortalQuaternionDelta);

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
}

export class PortalTraverserPart extends StatePart {
    fromState(state={}, options) {
        this.spatialName = options.spatialName || "spatial";
        this.subscribe(SpatialEvents.moved, "onMoved", this.owner.id, this.spatialName);
        this.lastPosition = state.lastPosition || this.owner.parts[this.spatialName].position;
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
