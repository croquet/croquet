import * as THREE from "three";
import { SpatialEvents } from "../modelParts/spatial";
import { ViewPart } from "../parts";
import PortalPart from "../modelParts/portal";
import { RENDER_LAYERS } from "../render";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class PortalViewPart extends ViewPart {
    constructor(options={}) {
        super();
        options = {visualOffset: -0.1, ...options};
        const source = options.model;
        // maintain a view-local "copy" of the portal info to reuse the traversal logic in the view
        // This allows spatial viewStates to traverse this cloned portal viewState and create the correct events
        const stateToClone = {};
        source.save(stateToClone);
        this.clonedPortal = PortalPart.create({...stateToClone});

        this.visualOffset = options.visualOffset;

        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#00ffff")})
        );
        const group = new THREE.Group();
        group.add(mesh);
        mesh.position.copy(new THREE.Vector3(0, 0, this.visualOffset));

        // TODO: actually use something like internal "TrackSpatial" and "TrackSize" parts here
        group.position.copy(source.parts.spatial.position);
        group.quaternion.copy(source.parts.spatial.quaternion);
        group.scale.copy(source.parts.spatial.scale);

        this.subscribe(source.parts.spatial.id, SpatialEvents.moved, "onMoved");
        this.subscribe(source.parts.spatial.id, SpatialEvents.rotated, "onRotated");
        this.subscribe(source.parts.spatial.id, SpatialEvents.scaled, "onScaled");

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
