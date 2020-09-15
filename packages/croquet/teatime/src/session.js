import { App } from "@croquet/util/html";
import { Stats } from "@croquet/util/stats";
import urlOptions from "@croquet/util/urlOptions";
import { addConstantsHash } from "@croquet/util/modules";

import Model from "./model";
import View from "./view";
import Controller from "./controller";
import Island from "./island";
import { Messenger } from "./messenger";

export function deprecatedStartSession(...args) {
    App.showMessage("Croquet.startSession() is deprecated, please use Croquet.Session.join()", { level: "warning", only: "once"});
    return Session.join(...args);
}

const Controllers = {};

/**
 * _The Session API is under construction._
 *
 * New in 0.3: use `Session.join` instead of `startSession()`. The returned object has a new `leave()` method for leaving that session.
 *
 * @hideconstructor
 * @public
 */
export class Session {

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
     * | `tps`         | `0`...`60`     | heartbeat _ticks per second_ generated by reflector when no messages are sent by any user (default `20`)
     * | `options`     | JSON object    | passed into the root model's [init()]{@link Model#init} function (no default)
     *
     * @async
     * @param {String} name - a name for this session (typically consists of an app name and a session selector, e.g. `"MyApp/123abc"`)
     * @param {Model} ModelRoot - the root Model class for your app
     * @param {View} ViewRoot - the root View class for your app
     * @param {Object} options
     * @param {String} options.step - `"auto" | "manual"`
     * @param {String} options.tps - ticks per second (`0` to `60`)
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
     *  - `leave()` is an async function that forces this session to disconnect.
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
    static async join(name, ModelRoot=Model, ViewRoot=View, options) {
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
        if ("autoSleep" in options) urlOptions.autoSleep = options.autoSleep;
        // now start
        if ("expectedSimFPS" in options) expectedSimFPS = Math.min(options.expectedSimFPS, MAX_BALANCE_FPS);
        const ISLAND_OPTIONS = ['tps'];
        const SESSION_OPTIONS = ['optionsFromUrl', 'password', 'viewIdDebugSuffix'];
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
        /** our return value */
        const session = {
            id: '',
            model: null,
            view: null,
            // called from our own onAnimationFrame, or application if stepping manually
            step(frameTime) {
                stepSession(frameTime, controller, session.view);
            },
            leave() {
                return Session.leave(session.id);
            },
            get latency() { return controller.latency; },
            get latencies() { return controller.latencies; },
        };
        await rebootModelView();
        /** timestamp of last frame (in animationFrame timebase) */
        let lastFrameTime = 0;
        /** time of last frame in (in Date.now() timebase) */
        let lastFrame = Date.now();
        /** average duration of last step */
        let recentFramesAverage = 0;
        /** recentFramesAverage to be considered hidden */
        const FRAME_AVERAGE_THRESHOLD = 1000;
        /** tab hidden or no anim frames recently */
        const isHidden = () => document.visibilityState === "hidden"
            || Date.now() - lastFrame > FRAME_AVERAGE_THRESHOLD
            || recentFramesAverage > FRAME_AVERAGE_THRESHOLD;
        /** time that we were hidden */
        let hiddenSince = 0;
        /** timestamp of frame when we were hidden */
        let frameTimeWhenHidden = 0;
        /** hidden check and auto stepping */
        const onAnimationFrame = frameTime => {
            if (!Controllers[session.id]) return; // stop loop
            // jump to larger v immediately, cool off slowly, limit to max
            const coolOff = (v0, v1, t, max) => Math.min(max, Math.max(v1, v0 * (1 - t) + v1 * t)) | 0;
            recentFramesAverage = coolOff(recentFramesAverage, frameTime - lastFrameTime, 0.1, 10000);
            lastFrameTime = frameTime;
            lastFrame = Date.now();
            if (!isHidden()) {
                controller.checkForConnection(true);
                if (options.step !== "manual") session.step(frameTime);
            }
            window.requestAnimationFrame(onAnimationFrame);
        };
        window.requestAnimationFrame(onAnimationFrame);
        startHiddenChecker();
        return session;

        async function rebootModelView(snapshot) {
            clear();
            if (controller.leaving) { controller.leaving(true); return; }
            const sessionSpec = {
                snapshot,
                init: islandInit,
                destroyerFn: rebootModelView,
                options: islandOptions,
            };
            for (const [option, value] of Object.entries(options)) {
                if (SESSION_OPTIONS.includes(option)) sessionSpec[option] = value;
            }
            session.model = (await controller.establishSession(name, sessionSpec)).modelRoot;
            session.id = controller.id;
            Controllers[session.id] = controller;

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
            if (Messenger.ready) {Messenger.detach();}
        }

        function islandInit(islandOpts) {
            const modelRoot = ModelRoot.create(islandOpts, "modelRoot");
            return { modelRoot };
        }

        function startHiddenChecker() {
            const DORMANT_TIMEOUT_DEFAULT = 10000;
            const noSleep = "autoSleep" in urlOptions && !urlOptions.autoSleep;
            const dormantTimeout = typeof urlOptions.autoSleep === "number" ? 1000 * urlOptions.autoSleep : DORMANT_TIMEOUT_DEFAULT;
            const interval = setInterval(() => {
                if (!Controllers[session.id]) clearInterval(interval); // stop loop
                else if (isHidden()) {
                    if (!hiddenSince) {
                        hiddenSince = Date.now();
                        frameTimeWhenHidden = lastFrameTime + hiddenSince - lastFrame;
                        // console.log("hidden");
                    }
                    const hiddenFor = Date.now() - hiddenSince;
                    // if autoSleep is set to false or 0, don't go dormant even if the tab becomes
                    // hidden.  also, run the simulation loop once per second to handle any events
                    // that have arrived from the reflector.
                    if (noSleep) {
                        // make time appear as continuous as possible
                        if (options.step !== "manual") session.step(frameTimeWhenHidden + hiddenFor);
                    } else if (hiddenFor > dormantTimeout) {
                        // Controller doesn't mind being asked repeatedly to disconnect
                        controller.dormantDisconnect();
                    }
                } else if (hiddenSince) {
                    // reconnect happens in onAnimationFrame()
                    hiddenSince = 0;
                    // console.log("unhidden");
                }
            }, 1000);
        }
    }

    static async leave(sessionId) {
        const controller = Controllers[sessionId];
        if (!controller) return false;
        delete Controllers[sessionId];
        const leavePromise = new Promise(resolve => controller.leaving = resolve);
        const connection = controller.connection;
        if (!connection.connected) return false;
        connection.socket.close(1000); // triggers the onclose which eventually calls destroyerFn above
        return leavePromise;
    }

    static thisSession() {
        const island = Island.current();
        return island ? island.id : "";
    }
}

// maximum amount of time in milliseconds the model get to spend running its simulation
const MAX_SIMULATION_MS = 200;
// time spent simulating the last few frames
const simLoad = [0];
// number of frames to spread load
const LOAD_BALANCE_FRAMES = 4;
// when average load is low, the balancer spreads simulation across frames by
// simulating with a budget equal to the mean of the durations recorded from the
// last LOAD_BALANCE_FRAMES simulations.
// a session also has a value expectedSimFPS, from which we derive the maximum time
// slice that the simulation can use on each frame while still letting the app
// render on time.  whenever the controller is found to have a backlog greater than
// LOAD_BALANCE_FRAMES times that per-frame slice, the balancer immediately
// schedules a simulation boost with a budget of MAX_SIMULATION_MS.
// expectedSimFPS can be set using session option expectedSimFPS; the higher
// the value, the less of a backlog is needed to trigger a simulation boost.  but
// if expectedSimFPS is set to zero, the balancer will attempt to clear any backlog
// on every frame.
const DEFAULT_BALANCE_FPS = 60;
const MAX_BALANCE_FPS = 120;
let expectedSimFPS = DEFAULT_BALANCE_FPS;

function stepSession(frameTime, controller, view) {
    const {backlog, latency, starvation, activity} = controller;
    Stats.animationFrame(frameTime, {backlog, starvation, latency, activity, users: controller.users});

    if (!controller.island) return;
    const simStart = Date.now();
    const simBudget = simLoad.reduce((a,b) => a + b, 0) / simLoad.length;
    controller.simulate(simStart + Math.min(simBudget, MAX_SIMULATION_MS));
    const allowableLag = expectedSimFPS === 0 ? 0 : LOAD_BALANCE_FRAMES * (1000 / expectedSimFPS);
    if (controller.backlog > allowableLag) controller.simulate(simStart + MAX_SIMULATION_MS - simBudget);
    simLoad.push(Date.now() - simStart);
    if (simLoad.length > LOAD_BALANCE_FRAMES) simLoad.shift();

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
