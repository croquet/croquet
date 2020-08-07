import { Model, View, App, Session } from "@croquet/croquet";

let RAPIER;

class RapierModel extends Model {

    static types() {
        return {
            "RAPIER.World": {
                cls: RAPIER.World,
                write: world => world.takeSnapshot(),
                read: snapshot => RAPIER.World.restoreSnapshot(snapshot),
            },
        }
    }
/*

ISSUES:

* separate objects refer to world, cannot be de-serialized separately (need ref to world)
* Q: do we need to manual free() objects we retrieve from rapier?

*/
    init() {
        this.world = new RAPIER.World(0.0, -9.81, 0.0);
        this.world.maxVelocityIterations = 4;
        this.world.maxPositionIterations = 1;
        console.log(this.world);

        this.bodies = [];
        this.colliders = [];
        this.joints = [];

        this.addPendulum();

        this.future(100, this.step);
    }

    addPendulum() {
        // a pendulum made from a pivot and bob connected by a rod

        const pivotDesc = new RAPIER.RigidBodyDesc('static');
        pivotDesc.setTranslation(0, 100, 0);
        const pivot = this.world.createRigidBody(pivotDesc);
        this.bodies.push(pivot);

        const bobDesc = new RAPIER.RigidBodyDesc('dynamic');
        bobDesc.setTranslation(100, 100, 0);
        const bob = this.world.createRigidBody(bobDesc);
        this.bodies.push(bob);

        const colliderDesc = RAPIER.ColliderDesc.ball(5);
        colliderDesc.density = 1;
        const collider = bob.createCollider(colliderDesc);
        this.colliders.push(collider);

        const anchor1 = new RAPIER.Vector(0, 50, 0);
        const anchor2 = new RAPIER.Vector(0, 0, 0);
        const rodDesc = RAPIER.JointDesc.ball(anchor1, anchor2);
        const rod = this.world.createJoint(rodDesc, pivot, bob);
        this.joints.push(rod);
    }

    step() {
        this.world.step();
        //this.future(100, this.step);
    }
}
RapierModel.register("RapierModel");

async function go() {
    RAPIER = await import("@dimforge/rapier3d");
    App.messages = true;
    App.makeWidgetDock();
    const session = await Session.join(`rapier-test-${App.autoSession("q")}`, RapierModel, View);
    console.log(session.model.world);
}

go();
