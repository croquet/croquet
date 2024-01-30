/* global croquet_build_process */
import { App } from "./_HTML_MODULE_"; // eslint-disable-line import/no-unresolved
import urlOptions from "./_URLOPTIONS_MODULE_"; // eslint-disable-line import/no-unresolved
import { Messenger } from "./_MESSENGER_MODULE_"; // eslint-disable-line import/no-unresolved

import { addConstantsHash } from "./hashing";

import Model from "./model";
import View from "./view";
import Data from "./data";
import Controller, { sessionController } from "./controller";
import VirtualMachine from "./vm";

const NODE = croquet_build_process.env.CROQUET_PLATFORM === 'node';

export function deprecatedStartSession(...args) {
    App.showMessage("Croquet.startSession() is deprecated, please use Croquet.Session.join()", { level: "warning", only: "once"});
    return Session.join(...args);
}

const DEFAULT_BALANCE_FPS = 60;
const MAX_BALANCE_FPS = 120;
let expectedSimFPS = DEFAULT_BALANCE_FPS;

const DORMANCY_DEFAULT_SECONDS = 10;
const DEFAULT_EVENT_RATE_LIMIT = 20;

/**
 * @hideconstructor
 * @public
 */
export class Session {

    /**
     * **Join a Croquet session.**
     *
     * Joins a session by instantiating the root model (for a new session) or resuming from a snapshot, then constructs the view root instance.
     *
     * The `appId` identifies each Croquet app. It must be a globally unique identifier following
     * the [Android convention](https://developer.android.com/studio/build/application-id),
     * e.g. `"com.example.myapp"`. Each dot-separated segment must start
     * with a letter, and only letters, digits, and underscores are allowed.
     *
     * The session `name` identifies individual sessions within an app.
     * You can use it for example to create different sessions for different users.
     * That is, a user in session `"ABC"` will not see a user in `"DEF"`.
     * One simple way to create unique sessions is via `Croquet.App.autoSession()` which will
     * use or generate a random name in the query part (`?...`) of the current url.
     * (If you use a constant, then all users will end up in the same session.
     * This is what we do in some of our tutorials for simplicity, but actual apps should manage sessions.)
     *
     * The session `password` is used for end-to-end encryption of all data leaving the client.
     * If your app does not need to protect user data, you will still have to provide a constant dummy password.
     * One simple way to have individual passwords is via `Croquet.App.autoPassword()` which will
     * use or generate a random password in the hash part (`#...`) of the current url.
     *
     * A [session id]{@link Model#sessionId} is created from the given session `name` and `options`,
     * and a hash of all the [registered]{@link Model.register} Model classes and {@link Constants}.
     * This ensures that only users running the exact same source code end up in the same session,
     * which is a prerequisite for perfectly synchronized computation.
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
     * Then the Croquet **main loop** is started (unless you pass in a `step: "manual"` parameter, e.g. for WebXR, see example below).
     * This uses [requestAnimationFrame()](https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame)
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
     * @async
     * @param {Object} parameters
     * @param {String} parameters.apiKey - API key (from croquet.io/keys)
     * @param {String} parameters.appId - unique application identifier as [dot-separated words](https://developer.android.com/studio/build/application-id) (e.g. `"com.example.myapp"`)
     * @param {String} parameters.name - a name for this session (e.g. `"123abc"`)
     * @param {String} parameters.password - a password for this session (used for end-to-end encryption of messages and snapshots)
     * @param {Model}  parameters.model - the root Model class for your app
     * @param {View?}   parameters.view - the root View class for your app, if any
     * @param {Object?} parameters.options - options passed into the root model's [init()]{@link Model#init} function (no default)
     * @param {Object?} parameters.viewOptions - options passed into the root views's [constructor()]{@link View#constructor} (no default)
     * @param {String?} parameters.step - `"auto"` (default) for automatic stepping via [requestAnimationFrame()](https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame), or `"manual"` to leave it as the application's responsibility to call the session's `step()` function regularly (see WebXR example below)
     * @param {Number?} parameters.tps - ticks per second generated by reflector when no messages are sent by any user (a value of `1/30` or below will result in one tick every 30s; max `60` per second; default `20`)
     * @param {(Number|Boolean)?} parameters.autoSleep - number of seconds of app being hidden (e.g., in a tab that is behind others) before it should go dormant - disconnecting from the reflector, and staying that way until it is made visible again (`0` or `false` mean the app will never voluntarily go dormant; `true` means default value of `10`s; otherwise any non-negative number)
     * @param {Number?} parameters.rejoinLimit - time in milliseconds until view is destroyed after a disconnection, to allow for short network glitches to be smoothly passed over (default `1000`)
     * @param {Number?} parameters.eventRateLimit - maximum number of events (single or bundled) sent to reflector per second (`1` to `60`; default `20`)
     * @param {String|String[]} parameters.debug - array, or comma-separated string, containing one or more of the following values to enable console logging of the corresponding details
     * (note that you can also enable these temporarily for a deployed app via the `debug` URL parameter, e.g. `?debug=session,snapshot`):
     * | value         | description
     * |----------------|------------
     * | `"session"`    | session ID and connections/disconnections
     * | `"messages"`   | received from reflector, after decryption (cf. encrypted messages visible in a WebSocket debugger)
     * | `"sends"`      | sent to reflector, before encryption (cf. encrypted messages visible in a WebSocket debugger)
     * | `"snapshot"`   | snapshot stats
     * | `"data"`       | data API stats
     * | `"hashing"`    | code hashing to derive session ID/persistentId
     * | `"subscribe"`  | subscription additions/removals
     * | `"classes"`    | class registrations
     * | `"ticks"`      | each tick received
     * | `"write"`      | detect accidental writes from view code to model properties
     * | `"offline"`    | disable multiuser
     *
     * @returns {Promise} Promise that resolves to an object describing the session:
     * ```
     * {
     *     id,           // session id
     *     view,         // view instance
     *     step(time),   // function for "manual" stepping
     *     leave(),      // function for leaving the session
     * }
     * ```
     *
     *   where
     *  - `view` is an instance of the supplied view class, or of Croquet.View if no view class was given
     *  - `step(time)` should be invoked regularly if you selected `manual` stepping, to nudge it to process the latest events from the reflector or generated internally.
     *     The `time` argument is expected to be in milliseconds, monotonically increasing - for example, the time received by a function passed to `window.requestAnimationFrame`.
     *  - `leave()` is an async function for requesting immediate, permanent disconnection from the session.
     * @example <caption>auto name, password, and main loop</caption>
     * Croquet.Session.join({
     *     apiKey: "your_api_key",                 // paste from croquet.io/keys
     *     appId: "com.example.myapp",             // namespace for session names
     *     name: Croquet.App.autoSession(),        // session via URL arg
     *     password: Croquet.App.autoPassword(),   // password via URL arg
     *     model: MyRootModel,
     *     view: MyRootView,
     *     debug: ["session"],
     * });
     * @example <caption>manual name, password, and WebXR main loop</caption>
     * Croquet.Session.join({ apiKey: "your_api_key", appId: "com.example.myapp", name: "abc", password: "password", model: MyRootModel, view: MyRootView, step: "manual"}).then(session => {
     *     function xrAnimFrame(time, xrFrame) {
     *         session.step(time);
     *         ...
     *         xrSession.requestAnimationFrame(xrAnimFrame);
     *     }
     *     xrSession.requestAnimationFrame(xrAnimFrame);
     * });
     * @public
     */
    static async join(parameters) {
        try {
            return await this.join_impl(parameters);
        } catch (err) {
            App.showMessage(err.message || err, { level: "fatal" });
            throw err;
        }
    }

    static async join_impl(parameters) {
        // old API: join(name, ModelRoot=Model, ViewRoot=View, parameters)
        if (typeof parameters !== "object") {
            throw Error(`Croquet: please use new Session.join( {apiKey, ...} ) API. See https://croquet.io/docs/croquet/Session.html#.join`);
        }
        // defaults
        if (!parameters.appId) parameters.appId = 'no.appId'; // must match warning in VM.persist()
        if (!parameters.name) { // auto password only if no name given
            parameters.name = App.autoSession();
            if (!parameters.password) parameters.password = App.autoPassword();
        }
        if (!parameters.model) parameters.model = Model.lastRegistered;
        if (!parameters.view) parameters.view = View;
        // resolve promises
        for (const [k,v] of Object.entries(parameters)) {
            // rewriting this using Promise.all does not seem worth the trouble so ...
            // eslint-disable-next-line no-await-in-loop
            if (v instanceof Promise) parameters[k] = await v;
        }
        function inherits(A, B) { return A === B || A.prototype instanceof B; }
        // check apiKey
        if (typeof parameters.apiKey !== "string") throw Error("Croquet: no apiKey provided in Session.join()!");
        if (parameters.apiKey.length > 128) throw Error("Croquet: apiKey > 128 characters in Session.join()!");
        // sanitize name
        if (typeof parameters.name !== "string") throw Error("Croquet: no session name provided in Session.join()!");
        if (parameters.name.length > 128) throw Error("Croquet: session name > 128 characters in Session.join()!");
        // must pass a model
        const ModelRoot = parameters.model;
        if (typeof ModelRoot !== "function" || !inherits(ModelRoot, Model)) throw Error("Croquet: bad model class in Session.join()");
        // view defaults to View
        const ViewRoot = parameters.view || View;
        if (typeof ViewRoot !== "function" || !inherits(ViewRoot, View)) throw Error("Croquet: bad view class in Session.join()");
        // check appId
        if (typeof parameters.appId !== "string") throw Error("Croquet: no appId provided in Session.join()");
        if (!parameters.appId.length > 128) throw Error("Croquet: appId > 128 characters in Session.join()");
        if (!parameters.appId.match(/^[a-z](-?[a-z0-9_])*(\.[a-z0-9_](-?[a-z0-9_])*)+$/i)) throw Error("Croquet: malformed appId in Session.join()");
        // check password
        if (typeof parameters.password !== "string" || !parameters.password) throw Error("Croquet: no password provided in Session.join()");
        // put reflector param into urlOptions because that's where controller.js looks
        const reflector = urlOptions.reflector || parameters.reflector;
        if (reflector) urlOptions.reflector = reflector;
        // same for files
        const files = urlOptions.files || parameters.files;
        if (files) urlOptions.files = files;
        // and backend
        const backend = urlOptions.backend || parameters.backend;
        if (backend) urlOptions.backend = backend;
        // verify manual stepping for Node
        if (NODE && parameters.step !== "manual") {
            throw Error("stepping must be manual in a Node.js app");
        }
        // verify and default rejoinLimit
        if ("rejoinLimit" in parameters) {
            if (typeof parameters.rejoinLimit !== "number" || parameters.rejoinLimit < 0 || parameters.rejoinLimit > 60000) {
                throw Error("rejoinLimit range: 0-60000");
            }
        } else parameters.rejoinLimit = 1000;
        // verify and default eventRateLimit
        if ("eventRateLimit" in parameters) {
            if (typeof parameters.eventRateLimit !== "number" || parameters.eventRateLimit < 1 || parameters.eventRateLimit > 60) {
                throw Error("eventRateLimit range: 1-60");
            }
        } else parameters.eventRateLimit = DEFAULT_EVENT_RATE_LIMIT;
        // verify heraldUrl
        if (parameters.heraldUrl) {
            if (parameters.heraldUrl.length > 256) throw Error('heraldUrl can only be 256 characters');
            if (!parameters.heraldUrl.startsWith("https://")) throw Error('heraldUrl needs to be https');
        }
        // verify hashOverride
        if (parameters.hashOverride) {
            if (parameters.hashOverride.length !== 43) throw Error('hashOverride must be 43 characters');
            if (parameters.hashOverride.search(/[^-_a-zA-Z0-9]/) !== -1) throw Error('hashOverride must be base64url encoded');
        }
        // also add debug parameters
        if (parameters.debug) {
            function asArray(a) {
                if (typeof a === "string") a = a.split(',');
                return a ? (Array.isArray(a) ? a : [a]) : [];
            }
            urlOptions.debug = [...asArray(parameters.debug), ...asArray(urlOptions.debug)].join(',');
        }
        // verify and default autoSleep
        if ("autoSleep" in parameters) {
            const sleep = parameters.autoSleep;
            const sleepType = typeof sleep;
            if (sleepType === "number") {
                if (sleep < 0) throw Error("an autoSleep value must be >= 0");
            } else if (sleepType === "boolean") {
                parameters.autoSleep = sleep ? DORMANCY_DEFAULT_SECONDS : 0;
            } else throw Error("autoSleep must be numeric or boolean");
        } else parameters.autoSleep = DORMANCY_DEFAULT_SECONDS;
        // turn flags from a single string, a separated string or an array into an object
        if (parameters.flags) {
            let props = parameters.flags;
            if (typeof props === "string") props = props.split(',');
            props = props ? (Array.isArray(props) ? props : [props]) : []; // copied from debug above
            props = props.filter(prop => typeof prop !== "object");
            if (props.length) {
                parameters.flags = {};
                props.forEach(prop => parameters.flags[prop] = true);
            } else parameters.flags = null;
        }
        // now start
        if ("expectedSimFPS" in parameters) expectedSimFPS = Math.min(parameters.expectedSimFPS, MAX_BALANCE_FPS);
        // parameters to be included in the session spec, if specified by app (or defaulted)
        const SESSION_PARAMS = ['name', 'password', 'apiKey', 'appId', 'tps', 'autoSleep', 'heraldUrl', 'rejoinLimit', 'eventRateLimit', 'optionsFromUrl', 'viewOptions', 'viewIdDebugSuffix', 'hashOverride', 'location', 'flags', 'progressReporter'];
        freezeAndHashConstants();
        const controller = new Controller();
        // make sure options are JSONable
        const options = JSON.parse(JSON.stringify({...parameters.options}));
        /** our return value */
        const session = {
            id: '',
            persistentId: '',
            versionId: '',
            name: parameters.name,
            model: null,
            view: null,
            // called from our own onAnimationFrame, or application if stepping manually
            step(frameTime) {
                controller.stepSession("animation", { frameTime, view: session.view, expectedSimFPS });
            },
            leave() {
                return Session.leave(session.id);
            },
            data: {
                fetch: (...args) => Data.fetch(session.id, ...args),
                store: (...args) => Data.store(session.id, ...args),
            },
            get latency() { return controller.latency; },
            get latencies() { return controller.latencies; },
        };

        const sessionSpec = {
            options,
            /** executed inside the vm to initialize session */
            initFn: (opts, persistentData) => ModelRoot.create(opts, persistentData, "modelRoot"),
            /** called by controller when leaving the session */
            rebootModelView
        };
        for (const [param, value] of Object.entries(parameters)) {
            if (SESSION_PARAMS.includes(param)) sessionSpec[param] = value;
        }
        await controller.initFromSessionSpec(sessionSpec);

        let rebooting = false;
        await rebootModelView();

        if (parameters.step !== "manual") controller.startStepping(session.step);

        return session;

        async function rebootModelView() {
            // invoked from static Session.join() above and from controller.leave()

            clear(); // remove session.model, detach the view

            // controller.leaving is set only in the static Session.leave(), which
            // handles an explicit user request to leave the session.  in that case,
            // the only way back in is to invoke Session.join() again - or reload
            // the app.
            if (controller.leaving) { controller.leaving(true); return; }

            // repeated connections and disconnections along the way to a (re)join
            // can cause this function to be called multiple times.  if there is an
            // instance already in progress, let it finish its work.
            if (rebooting) return;

            rebooting = true;
            await controller.establishSession(sessionSpec);
            rebooting = false;

            session.model = controller.vm.get("modelRoot");
            session.id = controller.id;
            session.persistentId = controller.persistentId;
            session.versionId = controller.versionId;
            controller.session = session;

            App.makeSessionWidgets(session.id);
            controller.inViewRealm(() => {
                if (urlOptions.has("debug", "session", false)) console.log(session.id, 'creating root view');
                /* session.view = */ new ViewRoot(session.model, sessionSpec.viewOptions);
                // constructor stores the view into session.view
            });
        }

        function clear() {
            session.model = null;
            if (session.view) {
                if (urlOptions.has("debug", "session", false)) console.log(session.id, 'detaching root view');
                session.view.detach();
                if (session.view.id !== "") console.warn(`Croquet: ${session.view} did not call super.detach()`);
                session.view = null;
            }
            App.clearSessionMoniker();
            if (Messenger.ready) {Messenger.detach();}
        }
    }

    static async leave(sessionId) {
        const controller = sessionController(sessionId);
        if (!controller) return false;
        // make sure there is no lurking timeout that would cause the controller
        // to reconnect.
        if (controller.reconnectTimeout) {
            clearTimeout(controller.reconnectTimeout);
            delete controller.reconnectTimeout;
        }
        const leavePromise = new Promise(resolve => controller.leaving = resolve);
        const connection = controller.connection;
        if (!connection.connected) return false;
        connection.closeConnection(1000); // calls socketClosed, and hence eventually rebootModelView to shut down the view
        return leavePromise;
    }

    static thisSession() {
        const vm = VirtualMachine.current();
        return vm ? vm.id : "";
    }

    // below are "instance properties" and "methods" JUST FOR DOCUMENTATION PURPOSES
    // we are not actually creating a Session instance, but a Session object
    // (maybe we should?)

    /** Session ID, generated by [Session.join]{@link Session.join}.
     *
     * This is a unique identifier for the session, combining the session's
     * [persistentId]{@link Session.persistentId} and [versionId]{@link Session.versionId}.
     * It ensures that all users in a session execute the exact same Model code.
     *
     * @type {String}
     * @public
     * @readonly
     */
    get id() { return ""; }

    /** Persistent ID, generated by [Session.join]{@link Session.join}.
     *
     * This is a unique identifier for the session, which remains the same
     * even if a new code version is deployed.
     *
     * @type {String}
     * @public
     * @readonly
     */
    get persistentId() { return ""; }

    /** Version ID, generated by [Session.join]{@link Session.join}.
     *
     * This is a unique identifier for the app version independent of the session name.
     * It is a hash of the source code of registered Model classes and Constants.
     * Everything the Model depends on must be registered, or Constants, to ensure
     * that all users in a session have the exact same code. Otherwise, they might
     * diverge in their computations.
     *
    */
    get versionId() { return ""; }

    /** The session name, as given to [Session.join]{@link Session.join}.
     *
     * @type {String}
     * @public
     * @readonly
     */
    get name() { return ""; }

    /** interface to the bulk [Data API]{@link Data} for this session.
     * @type {Data}
     * @public
     * @readonly
     */
    get data() { return {}; }

    /** Invoke this function regularly if you selected `"manual"` stepping in [Session.join]{@link Session.join}.
     *
     * @param {Number} time - the time in milliseconds, monotonically increasing
     * @public
     */
    step(_time) {}

    /** Leave the session.
     *
     * The only way back in is to invoke [Session.join()]{@link Session.join} again - or reload
     * the app.
     * @async
     * @public
     * @returns {Promise} Promise that resolves when the session was left
     */
    leave() {}
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
