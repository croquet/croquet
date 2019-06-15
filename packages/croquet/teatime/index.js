import { displaySessionMoniker, displayQRCode } from "@croquet/util/html";
import Stats from "@croquet/util/stats";

import Model from "./src/model";
import View from "./src/view";
import Controller from "./src/controller";

export { Model, View, Controller };
export { currentRealm } from "./src/realms";

//@typedef { import('./src/model').default } Model

/**
 * Start a new Croquet session
 * @public
 * @param {String} name - a name for your app
 * @param {Model} ModelRoot - the root Model class for your app
 * @param {View} ViewRoot - the root View class for your app
 * @param { { step: "auto" | "manual", render: "auto" | "always" | "never"} } options? - (optional)
 *  `{`
 *  `step:` `"auto"` or `"manual"`,
 *  `render:` `"auto"` or `"always"` or `"never"`,
 *  `}`
 * @returns {Promise<Session>} Promise that resolves to an object describing the session:
 *
 *     {
 *         view,     // the ViewRoot instance,
 *         step(),   // the step() function to call each frame if not using { step: "auto" }
 *     }
 */
export async function startSession(name, ModelRoot=Model, ViewRoot=View, options={}) {
    Controller.connectToReflectorIfNeeded();
    const controller = new Controller();
    const session = {};
    if (options.step === "auto") {
        // auto stepping
        const step = frameTime => {
            stepSession(frameTime, controller, session.view, options.render);
            window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    } else {
        // app-controlled stepping
        session.step = frameTime => stepSession(frameTime, controller);
    }
    await bootModelView();
    return session;

    async function bootModelView(snapshot) {
        clear();
        const model = (await controller.establishSession(name, {snapshot, init: spawnModel, destroyerFn: bootModelView, ...options})).modelRoot;
        displaySessionMoniker(controller.id);
        displayQRCode();
        controller.inViewRealm(() => {
            session.view = new ViewRoot(model);
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

// maximum amount of time in milliseconds the model get to spend running its simulation
const MAX_SIMULATION_MS = 200;
// time spent simulating the last few frames
const simLoad = [0];
// number of frames to spread load
const loadBalance = 4;
// time in ms we allow sim to lag behind before increasing sim budget
const balanceMS = loadBalance * (1000 / 60);

function stepSession(frameTime, controller, view, render="auto") {
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
        const hadEvents = controller.processModelViewEvents();
        Stats.end("update");

        if ((hadEvents || render === "always") && render !== "never") {
            Stats.begin("render");
            view.render();
            Stats.end("render");
        }
    }
}
