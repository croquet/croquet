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

    init() {
        this.world = new RAPIER.World(0.0, -9.81, 0.0);
        console.log(this.world);
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
