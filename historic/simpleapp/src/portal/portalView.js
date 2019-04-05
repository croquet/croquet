import * as THREE from 'three';
import { SpatialEvents } from '../stateParts/spatial.js';
import { ViewPart } from '../modelView.js';
import PortalPart from './portalModel.js';
import { RENDER_LAYERS } from '../render.js';

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class PortalViewPart extends ViewPart {
    constructor(modelState, options={}) {
        options = {visualOffset: -0.1, source: null, ...options};
        super(modelState, options);

        this.viewState.parts = {
            // maintain a view-local "copy" of the portal info to reuse the traversal logic in the view
            // This allows spatial viewStates to traverse this cloned portal viewState and create the correct events
            clonedPortal: new PortalPart()
        };
        const stateToClone = {};
        modelState.lookUp(options.source).toState(stateToClone);
        this.viewState.parts.clonedPortal.init({...stateToClone, id: null});

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
}
