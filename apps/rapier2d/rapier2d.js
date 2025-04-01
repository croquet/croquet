import { Model, View, Constants, App, Session } from "@croquet/croquet";

import RAPIER from "@dimforge/rapier2d-deterministic";

/*
 For Rapier docs see https://rapier.rs/docs/

 To be able to deserialize RAPIER objects individually, we need a reference
 to the world in each object. So we hack one into each object when it is created
 or deserialized.
*/

class CroquetRapierWorld extends RAPIER.World {
    createCollider(desc, parent) {
        const collider = super.createCollider(desc, parent);
        collider._world = this;
        return collider;
    }

    createRigidBody(desc) {
        const body = super.createRigidBody(desc);
        body._world = this;
        return body;
    }

    static restoreSnapshot(snapshot) {
        const world = super.restoreSnapshot(snapshot);
        Object.setPrototypeOf(world, CroquetRapierWorld.prototype);
        world.forEachRigidBody(body => body._world = world);
        world.forEachCollider(collider => collider._world = world);
        return world;
    }

    static SerializerDefs = {
        "CroquetRapierWorld": {
            cls: CroquetRapierWorld,
            write: world => world.takeSnapshot(),
            read: snapshot => CroquetRapierWorld.restoreSnapshot(snapshot),
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

// all Model code should be in Constants to get hashed into session ID
Constants.RapierVersion = RAPIER.version();
Constants.CroquetRapierWorld = CroquetRapierWorld;
Constants.BallRadius = 0.2;

class RapierModel extends Model {

    static types() { return CroquetRapierWorld.SerializerDefs; }

    init() {
        const gravity = { x: 0.0, y: -9.81 };
        this.world = new CroquetRapierWorld(gravity);

        this.ground = this.world.createCollider(RAPIER.ColliderDesc.cuboid(1000.0, 0.1));
        this.ground.setFriction(0.5);

        this.objects = [];

        this.subscribe(this.id, "click", this.click);

        this.spray();
        this.step();
    }

    shoot(color) {
        let body;

        // Remove the oldest body if we have too many
        if (this.objects.length > 50) {
            const obj = this.objects.shift();
            this.world.removeRigidBody(obj.body);
        }

        // Create a dynamic rigid-body
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();
        body = this.world.createRigidBody(rigidBodyDesc);
        body.setTranslation(new RAPIER.Vector2(0, 0.2), true);

        // Create a collider attached to the dynamic rigidBody
        const colliderDesc = RAPIER.ColliderDesc.ball(Constants.BallRadius);
        const collider = this.world.createCollider(colliderDesc, body);
        collider.setFriction(0.5);
        this.objects.push({ body, color });

        // Apply an upward impulse to the rigid-body
        const x = Math.random() * 0.1 - 0.05;
        const y = 1.5;
        body.applyImpulse(new RAPIER.Vector2(x, y), true);

        // let the view know
        this.publish(this.id, "bodies-changed");
    }

    click(color) {
        this.shoot(color);

        // resume spraying in 5 seconds
        this.cancelFuture(this.spray);
        this.future(5000, this.spray);
    }

    spray() {
        this.shoot("#ccc");
        this.future(500, this.spray);
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
        this.subscribe(model.id, { event: "bodies-changed", handling: "oncePerFrame" }, this.bodiesChanged);
        let hue = Math.random() * 360;
        const color = () => `hsl(${hue = (hue + 1) % 360|0}, 100%, 50%)`;
        canvas.onclick = () => this.publish(model.id, "click", color());
        this.ctx = canvas.getContext('2d');
        this.bodiesChanged();
    }

    bodiesChanged() {
        const ctx = this.ctx;
        ctx.resetTransform();
        ctx.clearRect(0, 0, 500, 500);
        ctx.translate(250, 500);
        ctx.scale(50, -50);
        for (const { body, color} of this.model.objects) {
            const pos = body.translation();
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, Constants.BallRadius, 0, 2 * Math.PI, false);
            ctx.fillStyle = color;
            ctx.fill();
        }
    }
}

App.makeWidgetDock();
Session.join({
    apiKey: "234567_Paste_Your_Own_API_Key_Here_7654321",
    appId: "io.croquet.rapier2d",
    model: RapierModel,
    view: RapierView,
});
