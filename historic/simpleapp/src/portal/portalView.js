import * as THREE from 'three';
import { SpatialEvents } from '../stateParts/spatial.js';
import { ViewPart } from '../modelView.js';
import PortalPart, { PortalEvents, PortalTopic } from './portalModel.js';
import { RENDER_LAYERS } from '../render.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export const PortalViewEvents = {
    "traversedView": "portal-traversedView"
};

export default class PortalViewPart extends ViewPart {
    constructor(modelState, options={}) {
        options = {visualOffset: -0.1, source: null, ...options};
        super(modelState, options);

        this.viewState.parts = {
            // maintain a view-local "copy" of the portal info to reuse the traversal logic in the view
            clonedPortal: new PortalPart()
        };
        this.viewState.parts.clonedPortal.init({...modelState.lookUp(options.source), id: null});

        this.visualOffset = options.visualOffset;
        const sourceSpatialPart = modelState.lookUp(options.source).parts.spatial;

        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#00ffff")})
        );
        const group = new THREE.Group();
        group.add(mesh);
        mesh.position.copy(new THREE.Vector3(0, 0, this.visualOffset));

        // TODO: actually use something like internal "TrackSpatial" and "TrackSize" parts here
        group.position.copy(sourceSpatialPart.position);
        group.quaternion.copy(sourceSpatialPart.quaternion);
        group.scale.copy(sourceSpatialPart.scale);

        this.subscribe(SpatialEvents.moved, "onMoved", sourceSpatialPart.id);
        this.subscribe(SpatialEvents.rotated, "onRotated", sourceSpatialPart.id);
        this.subscribe(SpatialEvents.scaled, "onScaled", sourceSpatialPart.id);

        this.subscribe(PortalEvents.traverserMoved, "onTraverserMoved", PortalTopic);

        group.children[0].layers.disable(RENDER_LAYERS.NORMAL);
        group.children[0].layers.enable(RENDER_LAYERS.ALL_PORTALS);
        this.threeObj = group;
    }

    enableLayersAsIndividual() {
        this.threeObj.children[0].layers.enable(RENDER_LAYERS.INDIVIDUAL_PORTAL);
    }

    disableLayersAsIndividual() {
        this.threeObj.children[0].layers.disable(RENDER_LAYERS.INDIVIDUAL_PORTAL);
    }

    onMoved(newPosition) {
        this.threeObj.position.copy(newPosition);
        this.viewState.parts.clonedPortal.parts.spatial.moveTo(newPosition);
    }

    onRotated(newQuaternion) {
        this.threeObj.quaternion.copy(newQuaternion);
        this.viewState.parts.clonedPortal.parts.spatial.rotateTo(newQuaternion);
    }

    onScaled(newScale) {
        this.threeObj.scale.copy(newScale);
        this.viewState.parts.clonedPortal.parts.spatial.scaleTo(newScale);
    }

    onTraverserMoved({from, to, traverserRef}) {
        if (this.viewState.parts.clonedPortal.didTraverse(from, to)) {
            this.publish(PortalViewEvents.traversedView, {portalRef: this.viewState.parts.clonedPortal.id, traverserRef}, PortalTopic);
        }
    }
}
