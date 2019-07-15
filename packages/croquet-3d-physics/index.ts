import * as OIMO from 'oimo';
import { gatherInternalClassTypes, Model } from 'croquet';
import { Observable } from 'croquet-observable';

export const PhysicsEvents = {
    worldStepped: "physics-worldStepped"
};

export class PhysicsWorld extends Observable(Model) {
    static types() {
        const dummyWorld = new OIMO.World({timestep: 1/60, iterations: 16, broadphase: 3, worldscale: 1, random: false, info: false, gravity: [0, -9.82, 0] });
        dummyWorld.add({type: 'sphere', size: [1,1,1], pos: [0,3,0], move: true, density: 1, friction: 0.2, restitution: 0.2, belongsTo: 1, collidesWith: 0xffffffff});
        dummyWorld.add({type: 'cylinder', size: [1,1,1], pos: [0,3.5,0], move: true, density: 1, friction: 0.2, restitution: 0.2, belongsTo: 1, collidesWith: 0xffffffff});
        dummyWorld.add({type: 'box', size: [1,1,1], pos: [0,1,0]});
        dummyWorld.step();
        return gatherInternalClassTypes(dummyWorld, "OIMO");
    }
}
