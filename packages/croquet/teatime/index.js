import { displaySessionMoniker, displayQRCode } from "@croquet/util/html";
import Stats from "@croquet/util/stats";

import Model from "./src/model";
import View from "./src/view";
import Controller from "./src/controller";

export { Model, View, Controller };
export { currentRealm } from "./src/realms";

const moduleVersion = module.bundle.v ? (module.bundle.v[module.id] || 0) + 1 : 0;
if (module.bundle.v) { console.log(`Hot reload ${module.id}#${moduleVersion}`); module.bundle.v[module.id] = moduleVersion; }


export async function startSession(name, ModelRoot=Model, ViewRoot=View, options={}) {
    const controller = new Controller();
    const session = { controller };
    session.step = frameTime => stepSession(frameTime, controller);
    await bootModelView();
    return session;

    async function bootModelView(snapshot) {
        clear();
        session.model = (await controller.establishSession(name, {snapshot, init: spawnModel, destroyerFn: bootModelView, ...options})).modelRoot;
        displaySessionMoniker(controller.id);
        displayQRCode();
        controller.inViewRealm(() => {
            session.view = new ViewRoot(session.model);
        });
    }

    function clear() {
        if (session.view) {
            session.view.detach();
            session.view = null;
        }
        displaySessionMoniker('');
    }

    function spawnModel(opts) {
        const modelRoot = ModelRoot.create(opts);
        return { modelRoot };
    }
}

/** maximum amount of time in milliseconds the model get to spend running its simulation */
const MAX_SIMULATION_MS = 200;

/** time spent simulating the last few frames */
const simLoad = [];
/** number of frames to spread load */
const loadBalance = 4;
/** time in ms we allow sim to lag behind before increasing sim budget */
const balanceMS = loadBalance * (1000 / 60);

function stepSession(frameTime, controller) {
    const {backlog, latency, starvation, activity} = controller;
    Stats.animationFrame(frameTime, {backlog, starvation, latency, activity, users: controller.users});

    if (controller.island) {
        const simStart = Date.now();
        const simBudget = simLoad.reduce((a,b) => a + b, 0) / simLoad.length;
        controller.simulate(simStart + Math.min(simBudget, MAX_SIMULATION_MS));
        if (controller.backlog > balanceMS) controller.simulate(simStart + MAX_SIMULATION_MS - simBudget);
        simLoad.push(Date.now() - simStart);
        if (simLoad.length > loadBalance) simLoad.shift();

        Stats.begin("update");
        controller.processModelViewEvents();
        Stats.end("update");
    }
}
