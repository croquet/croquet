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
 * New in 0.4: `Session.join` takes a single argument object instead of multiple unnamed arguments
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
     * Joins a session by instantiating the root model (for a new session) or resuming from a snapshot, then constructs the view root instance.
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
     * The session id is used to connect to a reflector. If there is no ongoing session,
     * an instance of the `model` class is [created]{@link Model.create} (which in turn typically creates a number of submodels).
     * Otherwise, the previously stored [modelRoot]{@link Model#beWellKnownAs} is deserialized from the snapshot,
     * along with all additional models.
     *
     * That root model instance is passed to the [constructor]{@link View} of your root `view` class.
     * The root view should set up the input and output operations of your application,
     * and create any additional views as to match the application state as found in the models.
     *
     * Then the Croquet **main loop** is started (unless you pass in a `step: "manual"` parameter).
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
     * #### Parameters
     * | parameter     | values         | Description
     * | --------------|----------------|------------
     * | `appId`       | string         | unique application identifier as dot-separated words (e.g. `"com.example.myapp"`)
     * | `name`        | string         | a name for this session (e.g. `"123abc"`)
     * | `password`    | string         | a password for this session (used for end-to-end encryption of messages and snapshots)
     * | `model`       | class          | the root Model class for your app
     * | `view`        | class          | the root View class for your app
     * | `options`     | JSON object    | passed into the root model's [init()]{@link Model#init} function (no default)
     * | `step`        | **`"auto"`**   | automatic stepping via [requestAnimationFrame()]{@link https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame} (default)
     * |               | `"manual"`     | application-defined main loop is responsible for calling the session's `step()` function
     * | `tps`         | `0`...`60`     | heartbeat _ticks per second_ generated by reflector when no messages are sent by any user (default `20`)
     * | `debug`       | `"session"`    | logs session id and connections
     * |               | `"messages"`   | received from reflector, after decryption, raw messages are in the WebSocket debugger
     * |               | `"sends"`      | sent to reflector, before encryption, raw messages are in the WebSocket debugger
     * |               | `"snapshot"`   | snapshot stats
     * |               | `"data"`       | data API stats
     * |               | `"hashing"`    | code hashing to derive sessionId / islandId
     * |               | `"subscribe"`  | adding/removing subscriptions
     * |               | `"classes"`    | registering classes
     * |               | `"ticks"`      | each tick received
     *
     * @async
     * @param {Object} parameters
     * @param {String} parameters.appId - application identifier
     * @param {String} parameters.name - session name
     * @param {String} parameters.password - session password
     * @param {Model}  parameters.model - root Model class
     * @param {View}   parameters.view - root View class
     * @param {Object?} parameters.options - options passed to root Model's init
     * @param {String?} parameters.step - `"auto" | "manual"`
     * @param {String?} parameters.tps - ticks per second (`0` to `60`)
     * @param {String?|Array<String>?} parameters.debug - `"session"` | `"messages"` | `"sends"` | `"snapshot"` | `"data"` | `"hashing"` | `"subscribe"` | `"classes"` | `"ticks"`
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
     * @example <caption>auto name, password, and main loop</caption>
     * Croquet.Session.join({
     *     appId: "com.example.myapp",             // namespace for session names
     *     name: Croquet.App.autoSession(),        // session via URL arg
     *     password: Croquet.App.autoPassword(),   // password via URL arg
     *     model: MyRootModel,
     *     view: MyRootView,
     *     debug: ["session"],
     * });
     * @example <caption>manual name, password, and main loop</caption>
     * Croquet.Session.join({ name: "MyApp/2", password: "password", model: MyRootModel, view: MyRootView, step: "manual"}).then(session => {
     *     function myFrame(time) {
     *         session.step(time);
     *         window.requestAnimationFrame(myFrame);
     *     }
     *     window.requestAnimationFrame(myFrame);
     * });
     * @public
     */
    static async join(parameters, ...oldargs) {
        // old API: join(name, ModelRoot=Model, ViewRoot=View, parameters) {
        if (typeof parameters[0] === "string" || oldargs.length > 0) {
            console.warn(`Croquet: please use new Session.join( {name, ...} ) API`)
            const [n, m, v, p] = [parameters, ...oldargs];
            parameters = p || {};
            if (v && Object.getPrototypeOf(v) === Object.prototype && p === undefined) {
                parameters = v;
            } else {
                parameters.view = v;
            }
            parameters.model = m;
            parameters.name = n;
        }
        // resolve promises
        for (const [k,v] of Object.entries(parameters)) {
            if (v instanceof Promise) parameters[k] = await v;
        }
        function inherits(A, B) { return A === B || A.prototype instanceof B; }
        // sanitize name
        if (!parameters.name) throw Error("Croquet: no session name provided in Session.join()!");
        // must pass a model
        const ModelRoot = parameters.model;
        if (!inherits(ModelRoot, Model)) throw Error("ModelRoot must inherit from Croquet.Model");
        // view defaults to View
        const ViewRoot = parameters.view;
        if (!inherits(ViewRoot, View)) throw Error("ViewRoot must inherit from Croquet.View");
        // check appId
        if (!parameters.appId) {
            console.warn("Croquet: no appId provided in Session.join()");
        } else if (!parameters.appId.match(/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/i)) {
            throw Error(`Croquet: malformed appId "${parameters.appId}"`)
        }
        // check password
        if (!parameters.password) {
            console.warn("Croquet: no session password provided in Session.join()");
            // if the default shows up in logs we have a problem
            parameters.password = "THIS SHOULDN'T BE IN LOGS";
        }
        // put reflector param into urlOptions because that's where controller.js looks
        const reflector = urlOptions.reflector || parameters.reflector;
        if (reflector) {
            if (reflector.includes("://") || reflector.match(/^[-a-z0-9]+$/i)) urlOptions.reflector = reflector;
            else console.warn(`Croquet: Not a valid websocket url, ignoring reflector "${reflector}"`);
        }
        // also add debug parameters
        if (parameters.debug) {
            function asArray(a) {
                if (typeof a === "string") a = a.split(',');
                return a ? (Array.isArray(a) ? a : [a]) : [];
            }
            urlOptions.debug = [...asArray(parameters.debug), ...asArray(urlOptions.debug)].join(',');
        }
        if ("autoSleep" in parameters) urlOptions.autoSleep = parameters.autoSleep;
        // now start
        if ("expectedSimFPS" in parameters) expectedSimFPS = Math.min(parameters.expectedSimFPS, MAX_BALANCE_FPS);
        const SESSION_PARAMS = ['name', 'password', 'appId', 'tps', 'optionsFromUrl', 'viewIdDebugSuffix'];
        freezeAndHashConstants();
        const controller = new Controller();
        // make sure options are JSONable
        const options = JSON.parse(JSON.stringify({...parameters.options}));
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
        const FRAME_AVERAGE_THRESHOLD = 20000;
        /** tab hidden or no anim frames recently */
        const isHidden = () => {
            // report whether to consider this tab hidden - returning true if
            //   - the visibilityState is "hidden", or
            //   - the time gap since the last animationFrame is above threshold, or
            //   - the responsive but decaying average of gaps between animation frames
            //     is above threshold.
            // i.e., a big frame gap can cause an immediate isHidden report, but
            // if rapid frames resume, they will soon lead to !isHidden.
            // sept 2020: Safari 13 (but not 14) drastically slows animation frames to
            // a browser tab that is fully in view but is not focussed; inter-frame
            // gaps of 10-15 seconds seem common.  to prevent these gaps from causing
            // isHidden reports, the threshold time was raised from 1s to 20s, and the
            // ceiling of the average calculation from 10s to 30s.
            // a corollary is that frames that are off-screen on Q in Safari, which
            // appears to send animation frames every 10s, will never go dormant.
            return document.visibilityState === "hidden"
                || Date.now() - lastFrame > FRAME_AVERAGE_THRESHOLD
                || recentFramesAverage > FRAME_AVERAGE_THRESHOLD;
            };
        /** time that we were hidden */
        let hiddenSince = 0;
        /** timestamp of frame when we were hidden */
        let frameTimeWhenHidden = 0;
        /** hidden check and auto stepping */
        const onAnimationFrame = frameTime => {
            if (!Controllers[session.id]) return; // stop loop
            // jump to larger v immediately, cool off slowly, limit to max
            const coolOff = (v0, v1, t, max) => Math.min(max, Math.max(v1, v0 * (1 - t) + v1 * t)) | 0;
            recentFramesAverage = coolOff(recentFramesAverage, frameTime - lastFrameTime, 0.1, 30000);
            lastFrameTime = frameTime;
            lastFrame = Date.now();
            // having just recorded a lastFrame, isHidden will only be
            // true if the recentFramesAverage is above threshold (or
            // if visibilityState is explicitly "hidden", of course)
            if (!isHidden()) {
                controller.checkForConnection(true); // reconnect if disconnected and not blocked
                if (parameters.step !== "manual") session.step(frameTime);
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
                options,
                /** executed inside the island to initialize session */
                initFn: (opts, persistentData) => ModelRoot.create(opts, persistentData, "modelRoot"),
                /** called by controller when leaving the session */
                destroyerFn: rebootModelView,
            };
            for (const [param, value] of Object.entries(parameters)) {
                if (SESSION_PARAMS.includes(param)) sessionSpec[param] = value;
            }
            await controller.establishSession(sessionSpec);
            session.model = controller.island.get("modelRoot");
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
                if (session.view.id !== "") console.warn(`Croquet: ${session.view} did not call super.detach()`);
                session.view = null;
            }
            App.clearSessionMoniker();
            if (Messenger.ready) {Messenger.detach();}
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
                        if (parameters.step !== "manual") session.step(frameTimeWhenHidden + hiddenFor);
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
// expectedSimFPS can be set using session param expectedSimFPS; the higher
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
