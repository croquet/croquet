import { Model, View, App, Session } from "@croquet/croquet";

let RAPIER;

class RapierModel extends Model {

    static types() {
        return {
            "RAPIER.World": {
                cls: RAPIER.World,
                write: world => world.takeSnapshot(),
                read: snapshot => {
                    const world = RAPIER.World.restoreSnapshot(snapshot);
                    // provide a mapping solely for use in reading objects
                    world._bodyMap = new Map();
                    world._colliderMap = new Map();
                    // world._jointMap = new Map();
                    world.forEachRigidBody(body => { body.world = world; world._bodyMap.set(body.handle(), body); });
                    world.forEachCollider(collider => { collider.world = world; world._colliderMap.set(collider.handle(), collider); });
                    // world.forEachJoint(joint => { joint.world = world; world._jointMap.set(joint.handle(), joint); });
                    return world;
                },
            },
            "RAPIER.RigidBody": {
                cls: RAPIER.RigidBody,
                write: body => ({world: body.world, handle: body.handle()}),
                read: ({world, handle}) => world._bodyMap.get(handle),
            },
            "RAPIER.Collider": {
                cls: RAPIER.Collider,
                write: collider => ({world: collider.world, handle: collider.handle()}),
                read: ({world, handle}) => world._colliderMap.get(handle),
            },
            // "RAPIER.Joint": {
            //     cls: RAPIER.Joint,
            //     write: joint => ({world: joint.world, handle: joint.handle()}),
            //     read: ({world, handle}) => { debugger; return world._jointMap.get(handle)},
            // },
        }
    }
/*

ISSUES

* separate objects refer to world, cannot be de-serialized separately (need ref to world)
  => now hacking world ref into every engine object
* there appears to be no world.forEachJoint iterator, nor join.handle() method, so we can't restore joints
* Q: how to set position of an object after creation?
* Q: do we need to manual free() objects we retrieve from rapier?
* Q: are handles unique to each world? Can we have multiple rapier worlds at the same time?

RESOURCES
* Extracting info about objects extractWorldDescription()
  https://github.com/sebcrozet/rapier.js/blob/master/testbed3d/src/Testbed.js#L41
* creating worlds:
  https://github.com/sebcrozet/rapier.js/blob/master/testbed3d/src/demos/
*/
    init() {
        this.reset();

        this.subscribe(this.id, "reset", this.reset);

        this.future(100, this.step);
    }

    addPendulum() {
        // a pendulum made from a pivot and bob connected by a rod

        const pivotDesc = new RAPIER.RigidBodyDesc('static');
        pivotDesc.setTranslation(0, 100, 0);
        const pivot = this.world.createRigidBody(pivotDesc);
        pivot.world = this.world; // HACK to give serializer access to world
        this.bodies.push(pivot);

        const bobDesc = new RAPIER.RigidBodyDesc('dynamic');
        bobDesc.setTranslation(100, 100, 0);
        const bob = this.world.createRigidBody(bobDesc);
        bob.world = this.world; // HACK to give serializer access to world
        this.bodies.push(bob);

        const colliderDesc = RAPIER.ColliderDesc.ball(5);
        colliderDesc.density = 1;
        const collider = bob.createCollider(colliderDesc);
        collider.world = this.world; // HACK to give serializer access to world
        this.colliders.push(collider);

        const anchor1 = new RAPIER.Vector(0, 50, 0);
        const anchor2 = new RAPIER.Vector(0, 0, 0);
        const rodDesc = RAPIER.JointDesc.ball(anchor1, anchor2);
        const rod = this.world.createJoint(rodDesc, pivot, bob);
        rod.world = this.world; // HACK to give serializer access to world
        // this.joints.push(rod);
    }

    reset() {
        // there appears to be no way to move objects, so we just recreate the world for now
        this.world = new RAPIER.World(0.0, -9.81, 0.0);
        this.bodies = [];
        this.colliders = [];
        // this.joints = [];
        this.addPendulum();

        this.publish(this.id, "bodies-changed");
    }

    step() {
        this.world.step();
        this.publish(this.id, "bodies-changed");
        this.future(100, this.step);
    }
}
RapierModel.register("RapierModel");

class RapierView extends View {
    constructor(model) {
        super(model);
        this.model = model;
        this.subscribe(model.id, "bodies-changed", this.bodiesChanged);
        TestCanvas.onclick = () => this.publish(model.id, "reset");
    }

    bodiesChanged() {
        const ctx = TestCanvas.getContext('2d');
        ctx.resetTransform();
        ctx.clearRect(0, 0, 500, 500);
        ctx.translate(250, 0);
        for (const body of this.model.bodies) {
            const pos = body.translation();
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 10, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'red';
            ctx.fill();
        }
    }
}

async function go() {
    RAPIER = await import("@dimforge/rapier3d");
    App.messages = true;
    App.makeWidgetDock();
    const session = await Session.join(`rapier-test-${App.autoSession("q")}`, RapierModel, RapierView);
    console.log(session.model.world);
}

go();
