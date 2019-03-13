import * as THREE from 'three';
import Island from "../island.js";
import Room from "../room/roomModel.js";
import Model from '../model.js';
import SpatialPart from '../stateParts/spatial.js';
import View from '../view.js';
import PortalViewPart from '../viewParts/portal.js';
import TrackSpatial from '../viewParts/trackSpatial.js';

const moduleVersion = `${module.id}#${module.bundle.v || 0}`;
if (module.bundle.v) { console.log(`Hot reload ${moduleVersion}`); module.bundle.v++; }

export class Portal extends Model {
    buildParts(state) {
        new SpatialPart(this, state);
    }

    naturalViewClass(_viewContext) { return PortalView; }
}

class PortalView extends View {
    buildParts() {
        new PortalViewPart(this, {
            targetRoom: "room1",
            positionInTargetRoom: new THREE.Vector3(-4, 1, 4),
            quaternionInTargetRoom: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4)
        });
        new TrackSpatial(this, {affects: "portal"});
    }
}

export default function initRoom2(state = {}) {
    state = { id: "2bb90375ea596139cc2cdcf474df4117", ...state };
    return new Island(state, () => {
        const room = new Room({color: {value: new THREE.Color("#000088")}});

        const portal = new Portal({ spatial: { position: new THREE.Vector3(0, 0.5, 0) } });
        room.parts.objects.add(portal);
    });
}
