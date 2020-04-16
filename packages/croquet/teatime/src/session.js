import { App } from "@croquet/util/html";
import { Stats } from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";
import { addConstantsHash } from "@croquet/util/modules";

import Model from "./model";
import View from "./view";
import Controller from "./controller";

export const Session = {
    join: joinSession,
};

export function deprecatedStartSession(...args) {
    App.showMessage("Croquet.startSession() is deprecated, please use Croquet.Session.join()", { level: "warning" });
    return Session.join(...args);
}

//@typedef { import('./src/model').default } Model

/**
 * **Join a Croquet session.**
 *
 * Joins a session (instantiating `ModelRoot` for the very first user, otherwise resuming from snapshot), then attaches a `ViewRoot` instance.
 *
 * The session `name` identifies individual sessions.
 * You can use it for example to create different sessions for different users.
 * That is, a user in session `"MyApp/A"` will not see a user in `"MyApp/B"`.
 * (If you use a constant, then all users will end up in the same session.
 * This is what we do in the tutorials for simplicity, but actual apps should manage sessions).
 *
 * A [session id]{@link Model#sessionId} is created from the given session `name`,
 * and a hash of all the [registered]{@link Model.register} Model classes and {@link Constants}.
 * This ensures that only users running the exact same source code end up in the same session,
 * which is a prerequisite for perfectly replicated computation.
 *
 * The session id is used to connect to a reflector. If there is no ongoing session and no persistent snapshot,
 * an instance of `ModelRoot` is [created]{@link Model.create} (which in turn typically creates a number of models).
 * Otherwise, the previously stored [modelRoot]{@link Model#beWellKnownAs} is deserialized from the snapshot,
 * along with all additional models.
 *
 * That root model instance is passed to the [constructor]{@link View} of your ViewRoot class.
 * The view root should set up the input and output operations of your application,
 * and create any additional views as to match the application state as found in the models.
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
 * | --------------|----------------|------------
 * | `step`        | **`"auto"`**   | automatic stepping via [requestAnimationFrame()]{@link https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame} (default)
 * |               | `"manual"`     | application-defined main loop is responsible for calling the session's `step()` function
 * | `tps`         | `1`...`60`     | heartbeat _ticks per second_ generated by reflector when no messages are sent by any user (default `20`)
 * | `options`     | JSON object    | passed into the root model's [init()]{@link Model#init} function (no default)
 *
 * @async
 * @param {String} name - a name for this session (typically consists of an app name and a session selector, e.g. `"MyApp/123abc"`)
 * @param {Model} ModelRoot - the root Model class for your app
 * @param {View} ViewRoot - the root View class for your app
 * @param {Object} options
 * @param {String} options.step - `"auto" | "manual"`
 * @param {String} options.tps - ticks per second (`1` to `60`)
 * @param {Object} options.options - `ModelRoot`.create(`{opt1: val1, opt2: val2}`)
 * @returns {Promise} Promise that resolves to an object describing the session:
 * ```
 * {
 *     id,           // the session id
 *     view,         // the ViewRoot instance
 *     step(time),   // function for "manual" stepping
 *     leave(),      // force leaving the session
 * }
 * ```
 *
 *   where
 *  - `view` is an instance of the `ViewRoot` class
 *  - `step(time)` is a function you need to call in each frame if you disabled automatic stepping.
 *     The `time` argument is expected to be in milliseconds, monotonically increasing - for example, the time received by a function that you passed to `window.requestAnimationFrame`.
 * @example <caption>auto main loop</caption>
 * Croquet.Session.join("MyApp/1", MyRootModel, MyRootView);
 * @example <caption>manual main loop</caption>
 * Croquet.Session.join("MyApp/2", MyRootModel, MyRootView, {step: "manual"}).then(session => {
 *     function myFrame(time) {
 *         session.step(time);
 *         window.requestAnimationFrame(myFrame);
 *     }
 *     window.requestAnimationFrame(myFrame);
 * });
 * @public
 */
async function joinSession(name, ModelRoot=Model, ViewRoot=View, options) {
    function inherits(A, B) { return A === B || A.prototype instanceof B; }
    // sanitize name
    if (typeof name !== "string") name = JSON.stringify(name) || "undefined";
    else if (!name) name = "unnamed";
    // must pass a model
    if (!inherits(ModelRoot, Model)) throw Error("ModelRoot must inherit from Croquet.Model");
    // forgive beginners errors
    /* ModelRoot.registerIfNeeded(); */ // breaks w3 in model.js:allClasses()
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
        else console.warn(`Not a valid websocket url, ignoring reflector "${reflector}"`);
    }
    // also add debug options
    if (options.debug) {
        function asArray(a) {
            if (typeof a === "string") a = a.split(',');
            return a ? (Array.isArray(a) ? a : [a]) : [];
        }
        urlOptions.debug = [...asArray(options.debug), ...asArray(urlOptions.debug)].join(',');
    }
    // time when we first noticed that the tab is hidden
    let hiddenSince = null;
    if ("autoSleep" in options) urlOptions.autoSleep = options.autoSleep;
    startSleepChecker(); // now runs even if autoSleep is false
    // now start
    const ISLAND_OPTIONS = ['tps'];
    const SESSION_OPTIONS = ['optionsFromUrl', 'login', 'autoSession'];
    freezeAndHashConstants();
    const controller = new Controller();
    const islandOptions = {};
    if (options.options) {
        // make sure options are a JSON object
        Object.assign(islandOptions, JSON.parse(JSON.stringify(options.options)));
    }
    for (const [option, value] of Object.entries(options)) {
        if (ISLAND_OPTIONS.includes(option)) islandOptions[option] = value;
    }
    const session = {
        id: '',
        model: null,
        view: null,
        step(frameTime) {
            if (document.visibilityState === "hidden") return; // some browsers - e.g., Firefox - will run occasional animation frames even when hidden

            hiddenSince = null; // evidently not hidden
            stepSession(frameTime, controller, session.view);
        },
        leave() {
            console.warn("Session leave not implemented yet!");
        },
        get latency() { return controller.latency; },
        get latencies() { return controller.latencies; },
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
        App.makeSessionWidgets(session.id);
        controller.inViewRealm(() => {
            if (urlOptions.has("debug", "session", false)) console.log(session.id, 'Creating root view');
            session.view = new ViewRoot(session.model);
        });
    }

    function clear() {
        session.model = null;
        if (session.view) {
            if (urlOptions.has("debug", "session", false)) console.log(session.id, 'Detaching root view');
            session.view.detach();
            if (session.view.id !== "") console.warn(`${session.view} did not call super.detach()`);
            session.view = null;
        }
        App.clearSessionMoniker();
    }

    function islandInit(islandOpts) {
        const modelRoot = ModelRoot.create(islandOpts, "modelRoot");
        return { modelRoot };
    }

    function startSleepChecker() {
        const DORMANT_THRESHOLD = 10000;
        setInterval(() => {
            if (document.visibilityState === "hidden") {
                // if autoSleep is set to false, don't go dormant even if the tab becomes
                // hidden.  also, run the simulation loop once per second to handle any events
                // that have arrived from the reflector.
                if (urlOptions.autoSleep === false) stepSession(performance.now(), controller, session.view);
                else {
                    const now = Date.now();
                    if (hiddenSince) {
                        // Controller doesn't mind being asked repeatedly to disconnect
                        if (now - hiddenSince > DORMANT_THRESHOLD) controller.dormantDisconnect();
                    } else hiddenSince = now;
                }
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
    controller.checkForConnection(true);

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
    controller.inViewRealm(() => view.update(frameTime));
    Stats.end("render");
}

/**
 * **User-defined Constants**
 *
 * To ensure that all users in a session execute the exact same Model code, the [session id]{@link joinSession}
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
