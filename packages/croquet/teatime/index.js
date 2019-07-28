import { displaySessionMoniker, displayQRCode } from "@croquet/util/html";
import Stats from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";
import { addConstantsHash } from "@croquet/util/modules";

import Model from "./src/model";
import View from "./src/view";
import Controller from "./src/controller";

export { Model, View, Controller };
export { currentRealm } from "./src/realms";
export { QFunc, gatherInternalClassTypes } from "./src/island";

//@typedef { import('./src/model').default } Model

/**
 * **Start a new Croquet session.**
 *
 * Creates a new session executing `ModelRoot`, then attaches a `ViewRoot` instance.
 *
 * The session `name` creates individual sessions.
 * You can use it to for example to create different sessions for different users.
 * For example, a user in session `"MyApp/A"` will not see a user in `"MyApp/B"`.
 * If you want all users to end up in the same session, simply use a constant.
 * This is what we do in the tutorials for simplicity, but actual apps should manage sessions.
 *
 * A [session id]{@link Model#sessionId} is created from the given session `name`,
 * and a hash of all the [registered]{@link Model.register} Model classes and {@link Constants}.
 * This ensures that only users running the exact same source code end up in the same session,
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
 * This uses [requestAnimationFrame()]{@link https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame}
 * for continuous updating. Each step of the main loop executes in three phases:
 *
 * 1. _Simulation:_ the models execute the events received via the reflector,
 *    and the [future messages]{@link Model#future} up to the latest time stamp received from the reflector.
 *    The [events]{@link Model#publish} generated in this phase are put in a queue for the views to consume.
 * 2. _Event Processing:_ the queued events are processed by calling the view's [event handlers]{@link View#subscribe}.
 *    The views typically use these events to modify some view state, e.g. moving a DOM element or setting some
 *    attribute of a Three.js object.
 * 3. _Updating/Rendering:_ The view root's [update()]{@link View#update} method is called after all the queued events have been processed.
 *    In some applications, the update method will do nothing (e.g. DOM elements are rendered after returning control to the browser).
 *    When using other UI frameworks (e.g. Three.js), this is the place to perform the actual rendering.
 *    Also, polling input and other tasks that should happen in every frame should be placed here.
 *
 *
 * #### Options
 * | option        | values         | Description
 * | ------------- |-------------   | -----------
 * | `step`        | **`"auto"`**   | automatic stepping via [requestAnimationFrame()]{@link https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame} (default)
 * |               | `"manual"`     | application-defined main loop is responsible for calling the session's `step()` function
 * | `reflector`   | **`""`**       | use default reflector - currently US west coast (default)
 * |               | `"us"`         | use alternate US reflector - currently east coast
 * |               | `"eu"`         | use a reflector in Europe
 * |               | `"jp"`         | use a reflector in Japan
 * | `tps`         | `1`...`60`     | heartbeat _ticks per second_ generated by reflector when no messages are sent by any user (default `20`)
 *
 * @async
 * @param {String} name - a name for your app
 * @param {Model} ModelRoot - the root Model class for your app
 * @param {View} ViewRoot - the root View class for your app
 * @param {Object} options
 * @param {String} options.step - `"auto" | "manual"`
 * @param {String} options.reflector - `"us" | "eu" | "jp"`
 * @param {String} options.tps - ticks per second (`1` to `60`)
 * @returns {Promise} Promise that resolves to an object describing the session:
 * ```
 * {
 *     id,           // the session id
 *     view,         // the ViewRoot instance
 *     step(time),   // function for "manual" stepping
 * }
 * ```
 *
 *   where
 *  - `view` is an instance of the `ViewRoot` class
 *  - `step(time)` is a function you need to call in each frame if you disabled automatic stepping.
 *     The `time` argument is expected to be in milliseconds, monotonically increasing - for example, the time received by a function that you passed to `window.requestAnimationFrame`.
 * @example <caption>auto main loop</caption>
 * Croquet.startSession("MyApp", MyRootModel, MyRootView);
 * @example <caption>manual main loop</caption>
 * Croquet.startSession("MyApp", MyRootModel, MyRootView, {step: "manual"}).then(session => {
 *     function myFrame(time) {
 *         session.step(time);
 *         window.requestAnimationFrame(myFrame);
 *     }
 *     window.requestAnimationFrame(myFrame);
 * });
 * @public
 */
export async function startSession(name, ModelRoot=Model, ViewRoot=View, options) {
    function inherits(A, B) { return A === B || A.prototype instanceof B; }
    // sanitize name
    if (typeof name !== "string") name = JSON.stringify(name) || "undefined";
    else if (!name) name = "unnamed";
    // must pass a model
    if (!inherits(ModelRoot, Model)) throw Error("ModelRoot must inherit from Croquet.Model");
    // forgive beginners errors
    ModelRoot.registerIfNeeded();
    // view defaults to View
    if (!inherits(ViewRoot, View)) {
        // if not specifying a view, allow options as 3rd argument
        if (ViewRoot && Object.getPrototypeOf(ViewRoot) === Object.prototype && options === undefined) {
            options = ViewRoot;
            ViewRoot = View;
        }
        else throw Error("ViewRoot must inherit from Croquet.View");
    }
    // default options are empty
    if (!options) options = {};
    // put reflector option into urlOptions because that's where controller.js looks
    const reflector = urlOptions.reflector || options.reflector;
    if (reflector) {
        if (reflector.includes("://")) urlOptions.reflector = reflector;
        else {
            const host = `${reflector}.croquet.studio`;
            urlOptions.reflector = `wss://${host}/reflector-v1`;
            urlOptions.files = `https://${host}/files-v1`;
        }
    }
    // also add debug options
    if (options.debug) {
        function asArray(a) { return a ? (Array.isArray(a) ? a : [a]) : []; }
        urlOptions.debug = [...asArray(urlOptions.debug), ...asArray(options.debug)];
    }
    // time when we first noticed that the tab is hidden
    let hiddenSince = null;
    if ("autoSleep" in options) urlOptions.autoSleep = options.autoSleep;
    if (urlOptions.autoSleep !== false) startSleepChecker();
    // now start
    const ISLAND_OPTIONS = ['tps'];
    const SESSION_OPTIONS = ['optionsFromUrl'];
    freezeAndHashConstants();
    const controller = new Controller();
    const islandOptions = {};
    for (const [option, value] of Object.entries(options)) {
        if (ISLAND_OPTIONS.includes(option)) islandOptions[option] = value;
    }
    const session = {
        id: '',
        moniker: '',
        model: null,
        view: null,
        step(frameTime) {
            hiddenSince = null; // evidently not hidden
            stepSession(frameTime, controller, session.view);
        }
    };
    await bootModelView();
    if (options.step !== "manual") {
        // auto stepping
        const step = frameTime => {
            session.step(frameTime);
            window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }
    return session;

    async function bootModelView(snapshot) {
        clear();
        const sessionSpec = {
            snapshot,
            init: islandInit,
            destroyerFn: bootModelView,
            options: islandOptions,
        };
        for (const [option, value] of Object.entries(options)) {
            if (SESSION_OPTIONS.includes(option)) sessionSpec[option] = value;
        }
        session.model = (await controller.establishSession(name, sessionSpec)).modelRoot;
        session.id = controller.id;
        session.moniker = displaySessionMoniker(controller.id);
        displayQRCode();
        controller.inViewRealm(() => {
            session.view = new ViewRoot(session.model);
        });
    }

    function clear() {
        session.model = null;
        if (session.view) {
            session.view.detach();
            session.view = null;
        }
        session.moniker = displaySessionMoniker('');
    }

    function islandInit(islandOpts) {
        const modelRoot = ModelRoot.create(islandOpts);
        return { modelRoot };
    }

    function startSleepChecker() {
        const DORMANT_THRESHOLD = 10000;
        setInterval(() => {
            if (document.visibilityState === "hidden") {
                const now = Date.now();
                if (hiddenSince) {
                    // Controller doesn't mind being asked repeatedly to disconnect
                    if (now - hiddenSince > DORMANT_THRESHOLD) controller.dormantDisconnect();
                } else hiddenSince = now;
            } else hiddenSince = null; // not hidden
            }, 1000);
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

function stepSession(frameTime, controller, view) {
    controller.ensureConnection();

    const {backlog, latency, starvation, activity} = controller;
    Stats.animationFrame(frameTime, {backlog, starvation, latency, activity, users: controller.users});

    if (!controller.island) return;
    const simStart = Date.now();
    const simBudget = simLoad.reduce((a,b) => a + b, 0) / simLoad.length;
    controller.simulate(simStart + Math.min(simBudget, MAX_SIMULATION_MS));
    if (controller.backlog > balanceMS) controller.simulate(simStart + MAX_SIMULATION_MS - simBudget);
    simLoad.push(Date.now() - simStart);
    if (simLoad.length > loadBalance) simLoad.shift();

    Stats.begin("update");
    controller.processModelViewEvents();
    Stats.end("update");

    if (!view) return;
    Stats.begin("render");
    view.update(frameTime);
    Stats.end("render");
}

/**
 * **User-defined Constants**
 *
 * To ensure that all users in a session execute the exact same Model code, the [session id]{@link startSession}
 * is derived by [hashing]{@link Model.register} the source code of Model classes and value of constants.
 * To hash your own constants, put them into `Croquet.Constants` object.
 *
 * The constants can be used in both Model and View.
 *
 * **Note:** the Constants object is recursively
 * [frozen]{@link https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze}
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
 * **Published when a new user enters the session, or re-enters after being temporarily disconnected.**
 *
 * This is a replicated event, meaning both models and views can subscribe to it.
 *
 * **Note:** Each `"view-join"` event is guaranteed to be followed by a [`"view-exit"`]{@link event:view-exit}
 * event when that user leaves the session, or when the session is cold-started from a persistent snapshot.
 *
 * Hint: In the view, you can access the local viewId as [`this.viewId`]{@link View#viewId}, and compare
 * it to the argument in this event, e.g. to associate the view side with an avatar on the model side.
 *
 * @example
 * class MyModel extends Croquet.Model {
 *     init() {
 *         this.userData = {};
 *         this.subscribe(this.sessionId, "view-join", this.addUser);
 *         this.subscribe(this.sessionId, "view-exit", this.deleteUser);
 *     }
 *
 *     addUser(id) {
 *         this.userData[id] = { start: this.now() };
 *         console.log(`user ${id} came in`);
 *     }
 *
 *     deleteUser(id) {
 *         const time = this.now() - this.userData[id].start;
 *         console.log(`user ${id} left after ${time / 1000} seconds`);
 *         delete this.userData[id];
 *     }
 * }
 * @event view-join
 * @property {String} scope - [`this.sessionId`]{@link Model#sessionId}
 * @property {String} event - `"view-join"`
 * @property {String} viewId - the joining user's local viewId
 * @public
 */

/**
 * **Published when a user leaves the session, or is disconnected.**
 *
 * This is a replicated event, meaning both models and views can subscribe to it.
 *
 * This event will be published when the view is closed, or is disconnected due
 * to network interruption or inactivity.  A view is deemed to be inactive if
 * 10 seconds pass without an execution of the Croquet [main loop]{@link startSession};
 * this will happen if, for example, the browser tab is hidden.  As soon as the tab becomes
 * active again the main loop resumes, and the session will reconnect, causing
 * a [`"view-join"`]{@link event:view-join} event to be published.  The `viewId`
 * will be the same as before.
 *
 * **Note:** when starting a new session from a snapshot, `"view-exit"` events will be
 * generated for all of the previous users before the first [`"view-join"`]{@link event:view-join}
 * event of the new session.
 *
 * #### Example
 * See [`"view-join"`]{@link event:view-join} event
 * @event view-exit
 * @property {String} scope - [`this.sessionId`]{@link Model#sessionId}
 * @property {String} event - `"view-exit"`
 * @property {String} viewId - the user's id
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
 * this.subscribe(this.viewId, "synced", this.handleSynced);
 * ```
 * @event synced
 * @property {String} scope - [`this.viewId`]{@link View#viewId}
 * @property {String} event - `"synced"`
 * @property {Boolean} data - `true` if in sync, `false` if backlogged
 * @public
 */
