import { displaySessionMoniker, displayQRCode } from "@croquet/util/html";
import Stats from "@croquet/util/stats";
import { addConstantsHash } from "@croquet/util/modules";

import Model from "./src/model";
import View from "./src/view";
import Controller from "./src/controller";

export { Model, View, Controller };
export { currentRealm } from "./src/realms";

//@typedef { import('./src/model').default } Model

/**
 * **Start a new Croquet session.**
 *
 * A [session id]{@link Model#sessionId} is created from the given `name`, the url session slug,
 * and a hash of all the [registered]{@link Model.register} Model classes and {@link Constants}.
 * This ensures that only clients running the exact same source code end up in the same session,
 * which is a prerequisite for perfectly replicated computation.
 *
 * The session id is used to connect to a reflector. If there is no ongoing session and no persistent snapshot,
 * an instance of `ModelRoot` is [created]{@link Model.create}. Otherwise, the previously stored
 * [modelRoot]{@link Model#beWellKnownAs} is deserialized from a snapshot.
 *
 * That model instance is passed to the [constructor]{@link View} of your ViewRoot class.
 * The view root should set up the input and output operations of your application.
 *
 * Then the Croquet **main loop** is started (unless you pass in a `step: "manual"` option).
 * This uses [requestAnimationFrame()]{@link https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame}
 * for continuous updating. Each step of the main loop executes in three phases:
 *
 * 1. _Simulation:_ the models execute the events received via the reflector,
 *    and the [future messages]{@link Model#future} up to the latest time stamp received from the reflector.
 *    The [events]{@link Model#publish} generated in this phase are put in a queue for the views to consume.
 * 2. _Updating:_ the queued events are processed by calling the view's [event handlers]{@link View#subscribe}.
 *    The views typically use these events to modify some view state, e.g. moving a DOM element or setting some
 *    attribute of a ThreeJS object.
 * 3. _Rendering:_ The view root's [render()]{@link View#render} method is called after all the queued events have been processed.
 *    In some applications, the render method will do nothing (e.g. DOM elements are rendered after returning control to the browser).
 *    In other UI frameworks (e.g. ThreeJS), this is the place to perform the actual rendering.
 *
 * The return value is a Promise. Most applications do not need the returned values,
 * so there is no need to wait for the function's completion.
 *
 * #### Options
 * | option        | values        | Description
 * | ------------- |-------------  | -----------
 * | `step:`       | `"auto"`      | automatic stepping via [requestAnimationFrame()]{@link https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame} (this is the default)
 * |               | `"app"`       | application-defined main loop will call the session's `step()` function
 * | `render:`     | `"auto"`      | call `render()` only if there where events processed in the update phase (this is the default)
 * |               | `"always"`    | call `render()` in every step, independent of events
 * |               | `"never"`     | disable calling `render()` altogether
 *
 *
 * @async
 * @param {String} name - a name for your app
 * @param {Model} ModelRoot - the root Model class for your app
 * @param {View} ViewRoot - the root View class for your app
 * @param {Object=} options -
 *      `step:` `"auto"` or `"app"`,<br>
 *      `render:` `"auto"` or `"always"` or `"never"`,<br>
 * @returns {Promise} Promise that resolves to an object describing the session:
 * ```
 * {
 *     id,           // the session id
 *     view,         // the ViewRoot instance
 *     step(time),   // function for "app" stepping
 * }
 * ```
 *
 *   where
 *  - `view` is an instance of the `ViewRoot` class
 *  - `step(time)` is a function you need to call in each frame if you disabled automatic stepping.
 *     Pass in the time in milliseconds, e.g. from `window.requestAnimationFrame(time)`
 * @public
 */
export async function startSession(name, ModelRoot=Model, ViewRoot=View, options={}) {
    Controller.connectToReflectorIfNeeded();
    freezeAndHashConstants();
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
        session.id = controller.id;
        session.moniker = displaySessionMoniker(controller.id);
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
        session.moniker = displaySessionMoniker('');
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

/**
 * **User-defined Model Constants**
 *
 * To ensure that all users in a session execute the exact same Model code, the [session id]{@link startSession}
 * is derived by [hashing]{@link Model.register} the source code of Model classes and value of constants.
 * To hash your own constants, put them into `Croquet.Constants` object.
 *
 * **Note:** the Constants object is recursively
 * [frozen]{@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze}
 * once a session was started, to avoid accidental modification.
 * @example
 * const Q = Croquet.Constants;
 * Q.ANSWER = 42;
 * Q.POWERLEVEL = 9000;
 *
 * class MyModel extends Croquet.Model {
 *     init() {
 *          this.answer = Q.ANSWER;
 *          this.level = Q.POWERLEVEL;
 *     }
 * }
 * @public
 */
export const Constants = {};

function deepFreeze(object) {
    if (Object.isFrozen(object)) return;
    Object.freeze(object);
    for (const value of Object.values(object)) {
        if (value && (typeof value === "object" || typeof value === "function")) {
            deepFreeze(value);
        }
    }
}

function freezeAndHashConstants() {
    if (Object.isFrozen(Constants)) return;
    deepFreeze(Constants);
    addConstantsHash(Constants);
}

// putting event documentation here because JSDoc errors when parsing controller.js at the moment

 /**
 * **Published when users join or leave.**
 *
 * This is a replicated event, meaning it can be used in the model or the view.
 *
 * **Note:** If you are keeping track of the users in the model, you need to reset them
 * if the number of joining users equals the number of active users (see example below).
 * This is because a snapshot might still refer to users that were in the session when the
 * snapshot was taken (the reflector is stateless, it can only report users joining or leaving).
 *
 * Hint: In the view, you can access the local user as [`this.user`]{@link View#user}, and compare
 * its `id` to the `id` of a user in this event, to associate it with an avatar.
 *
 * @example <caption>Keeping track of users</caption>
 * class MyModel extends Croquet.Model {
 *     init() {
 *         this.users = new Map();
 *         this.subscribe(this.sessionId, "users", data => this.updateUsers(data));
 *     }
 *
 *     updateUsers(users) {
 *         if (users.joined.length === users.active) this.users.clear();
 *         else for (const user of users.left) this.users.delete(user.id);
 *         for (const user of users.joined) this.users.set(user.id, user.name);
 *         console.log(JSON.stringify([...this.users]));
 *     }
 * }
 * @event users
 * @property {String} scope - [`this.sessionId`]{@link Model#sessionId}
 * @property {String} event - `"users"`
 * @property {Object} data - `{ joined: [], left: [], active: n, total: n }`
 * @public
 */

 /**
 * **Published when the session backlog crosses a threshold.** (see {@link View#externalNow} for backlog)
 *
 * This is a non-replicated view-only event.
 *
 * If this is the main session, it also indicates that the scene was revealed (if data is `true`)
 * or hidden behind the overlay (if data is `false`).
 * ```
 * this.subscribe(this.clientId, "synced", data => this.handleSynced(data));
 * ```
 * @event synced
 * @property {String} scope - [`this.clientId`]{@link View#clientId}
 * @property {String} event - `"synced"`
 * @property {Boolean} data - `true` if in sync, `false` if backlogged
 * @public
 */
