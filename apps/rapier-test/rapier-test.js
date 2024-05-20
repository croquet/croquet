import { Model, View, App, Session } from "@croquet/croquet";

import RAPIER from "@dimforge/rapier2d";

/*

ISSUES

* separate objects refer to world, cannot be de-serialized separately (need ref to world)
  => now hacking world ref into every engine object
* Q: how to set position of an object after creation?
* Q: do we need to manual free() objects we retrieve from rapier?
* Q: are handles unique to each world? Can we have multiple rapier worlds at the same time?

*/

class RapierModel extends Model {

    static types() {
        return {
            "RAPIER.World": {
                cls: RAPIER.World,
                write: world => world.takeSnapshot(),
                read: snapshot => {
                    const world = RAPIER.World.restoreSnapshot(snapshot);
                    // HACK to give object serializers below access to world
                    world.forEachRigidBody(body => body._world = world);
                    world.forEachCollider(collider => collider._world = world);
                    return world;
                },
            },
            "RAPIER.RigidBody": {
                cls: RAPIER.RigidBody,
                write: body => [body._world, body.handle],
                read: ([world, handle]) => world.bodies.get(handle),
            },
            "RAPIER.Collider": {
                cls: RAPIER.Collider,
                write: collider => [collider._world, collider.handle],
                read: ([world, handle]) => world.colliders.get(handle),
            },
        }
    }

    init() {
        this.reset();

        this.subscribe(this.id, "reset", this.reset);

        this.future(100, this.step);
    }

    reset() {
        // there appears to be no way to move objects, so we just recreate the world for now
        const gravity = { x: 0.0, y: -9.81 };
        this.world = new RAPIER.World(gravity);

        // Create the ground
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(10.0, 0.1);
        const ground = this.world.createCollider(groundColliderDesc);
        ground._world = this.world; // HACK to give serializer access to world

        // Create a dynamic rigid-body.
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(0.0, 10.0);
        this.rigidBody = this.world.createRigidBody(rigidBodyDesc);
        this.rigidBody._world = this.world; // HACK to give serializer access to world

        // Create a cuboid collider attached to the dynamic rigidBody.
        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5);
        this.collider = this.world.createCollider(colliderDesc, this.rigidBody);
        this.collider._world = this.world; // HACK to give serializer access to world

        this.publish(this.id, "bodies-changed");
    }

    step() {
        this.world.step();
        this.publish(this.id, "bodies-changed");
        this.future(50, this.step);
    }
}
RapierModel.register("RapierModel");

class RapierView extends View {
    constructor(model) {
        super(model);
        this.model = model;
        this.subscribe(model.id, "bodies-changed", this.bodiesChanged);
        this.ctx = TestCanvas.getContext('2d');
        TestCanvas.onclick = () => this.publish(model.id, "reset");
        this.bodiesChanged();
    }

    bodiesChanged() {
        const ctx = this.ctx;
        ctx.resetTransform();
        ctx.clearRect(0, 0, 500, 500);
        ctx.translate(250, 500);
        ctx.scale(20, -20);
        const pos = this.model.rigidBody.translation();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 1, 0, 2 * Math.PI, false);
        ctx.fillStyle = 'red';
        ctx.fill();
    }
}

async function go() {
    App.messages = true;
    App.makeWidgetDock();
    const session = await Session.join({
        apiKey: "2DT9VCoCKtvXMKkBGZXNLrUEoZMn48ojXPC8XFAuuO",
        appId: "io.croquet.rapier-test",
        name: App.autoSession(),
        password: App.autoPassword(),
        model: RapierModel,
        view: RapierView,
    });
    console.log(session.model.world);
}

go();
