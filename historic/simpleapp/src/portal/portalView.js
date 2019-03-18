import * as THREE from 'three';
import Object3D from "../viewParts/object3D.js";
import { SpatialEvents } from '../stateParts/spatial.js';
import { SizeEvents } from '../stateParts/size.js';
import View from '../view.js';
import { PortalEvents, PortalTopic } from './portalModel.js';
import { RENDER_LAYERS } from '../render.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const PortalViewEvents = {
    "traversedView": "portal-traversedView"
};

export default class PortalView extends View {
    buildParts() {
        new PortalViewPart(this);
    }
}

export class PortalViewPart extends Object3D {
    fromOptions(options={}) {
        super.fromOptions(options);
        this.visualOffset = options.visualOffset || -0.1;
        this.source = options.source || "model.portal";
    }

    attachWithObject3D(modelState) {
        const portalShape = this.attachWithPortalShape(modelState);
        portalShape.children[0].layers.disable(RENDER_LAYERS.NORMAL);
        portalShape.children[0].layers.enable(RENDER_LAYERS.ALL_PORTALS);
        return portalShape;
    }

    enableLayersAsIndividual() {
        this.threeObj.children[0].layers.enable(RENDER_LAYERS.INDIVIDUAL_PORTAL);
    }

    disableLayersAsIndividual() {
        this.threeObj.children[0].layers.disable(RENDER_LAYERS.INDIVIDUAL_PORTAL);
    }

    /** @abstract */
    attachWithPortalShape(modelState) {
        const [contextName, partId] = this.source.split(".");
        const context = contextName === "model" ? modelState : this.owner;
        this.modelPortalPart = context.parts[partId];
        const hereSpatialPart = context.parts[this.modelPortalPart.hereSpatialPartId];
        const sizePart = context.parts[this.modelPortalPart.sizePartId];
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#00ffff")})
        );
        const group = new THREE.Group();
        group.add(mesh);
        mesh.position.copy(new THREE.Vector3(0, 0, this.visualOffset));

        // TODO: actually use something like internal "TrackSpatial" and "TrackSize" parts here
        group.position.copy(hereSpatialPart.position);
        group.quaternion.copy(hereSpatialPart.quaternion);
        group.scale.copy(sizePart.value);

        this.subscribe(SpatialEvents.moved, "onMoved", context.id, this.modelPortalPart.hereSpatialPartId);
        this.subscribe(SpatialEvents.rotated, "onRotated", context.id, this.modelPortalPart.hereSpatialPartId);
        this.subscribe(SizeEvents.changed, "onResized", context.id, this.modelPortalPart.sizePartId);

        this.subscribe(PortalEvents.traverserMoved, "onTraverserMoved", PortalTopic, null);

        return group;
    }

    onMoved(newPosition) {
        this.threeObj.position.copy(newPosition);
    }

    onRotated(newQuaternion) {
        this.threeObj.quaternion.copy(newQuaternion);
    }

    onResized(newSize) {
        this.threeObj.scale.copy(newSize);
    }

    onTraverserMoved({from, to, traverserRef}) {
        // TODO: this is such a hack. We shouldn't expect to be holding on to a model like this
        if (this.modelPortalPart && this.modelPortalPart.didTraverse(from, to)) {
            this.publish(PortalViewEvents.traversedView, {portalRef: this.modelPortalPart.asPartRef(), traverserRef}, PortalTopic, null);
        }
    }
}
