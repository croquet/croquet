import * as THREE from "three";
import { SpatialEvents } from "../modelParts/spatial";
import { ViewPart, ViewEvents } from "../parts";
import { RENDER_LAYERS } from "../render";
import PortalPart from "../modelParts/portal";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }

export default class PortalViewPart extends ViewPart {
    constructor(options={}) {
        super();
        const source = options.model;
        // maintain a view-local "copy" of the portal info to reuse the traversal logic in the view
        // This allows spatial viewStates to traverse this cloned portal viewState and create the correct events
        this.clonedPortal = PortalPart.create({
            spatial: {
                position: source.parts.spatial.position.clone(),
                quaternion: source.parts.spatial.quaternion.clone(),
            },
            spatialThere: {
                position: source.parts.spatialThere.position.clone(),
                quaternion: source.parts.spatialThere.quaternion.clone(),
            },
            there: source.there,
            roomId: source.roomId
        });

        this.visualOffset = options.visualOffset;

        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1, 1, 1),
            new THREE.MeshBasicMaterial({color: new THREE.Color("#00ffff")})
        );
        const group = new THREE.Group();
        group.add(mesh);

        // TODO: actually use something like internal "TrackSpatial" and "TrackSize" parts here
        group.position.copy(source.parts.spatial.position);
        group.quaternion.copy(source.parts.spatial.quaternion);
        group.scale.copy(source.parts.spatial.scale);

        this.subscribe(source.parts.spatial.id, SpatialEvents.moved, data => this.onMoved(data));
        this.subscribe(source.parts.spatial.id, SpatialEvents.rotated, data => this.onRotated(data));
        this.subscribe(source.parts.spatial.id, SpatialEvents.scaled, data => this.onScaled(data));

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
        this.clonedPortal.parts.spatial.moveTo(newPosition);
        this.publish(this.id, ViewEvents.changedDimensions);
    }

    onRotated(newQuaternion) {
        this.threeObj.quaternion.copy(newQuaternion);
        this.clonedPortal.parts.spatial.rotateTo(newQuaternion);
        this.publish(this.id, ViewEvents.changedDimensions);
    }

    onScaled(newScale) {
        this.threeObj.scale.copy(newScale);
        this.clonedPortal.parts.spatial.scaleTo(newScale);
        this.publish(this.id, ViewEvents.changedDimensions);
    }

    get label() {
        return "Portal to " + this.clonedPortal.there;
    }
}
