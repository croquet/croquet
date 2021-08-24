import { App } from "@croquet/util/html";
import urlOptions from "@croquet/util/urlOptions";
import { addConstantsHash } from "@croquet/util/hashing";

import Model from "./model";
import View from "./view";
import Controller, { sessionController } from "./controller";
import Island from "./island";
import { Messenger } from "./messenger";

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
     *
     * #### Parameters
     * | parameter     | values         | Description
     * | --------------|----------------|------------
     * | `apiKey`      | string         | API key from croquet.io/keys
     * | `appId`       | string         | unique application identifier as [dot-separated words](https://developer.android.com/studio/build/application-id) (e.g. `"com.example.myapp"`)
     * | `name`        | string         | a name for this session (e.g. `"123abc"`)
     * | `password`    | string         | a password for this session (used for end-to-end encryption of messages and snapshots)
     * | `model`       | class          | the root Model class for your app
     * | `view`        | class          | the root View class for your app
     * | `options`     | JSON object    | passed into the root model's [init()]{@link Model#init} function (no default)
     * | `step`        | **`"auto"`**   | automatic stepping via [requestAnimationFrame()](https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame) (default)
     * |               | `"manual"`     | application-defined main loop is responsible for calling the session's `step()` function
     * | `tps`         | `0`...`60`     | heartbeat _ticks per second_ generated by reflector when no messages are sent by any user (default `20`)
     * | `rejoinLimit` | `0`...`60000`  | time in ms until view is destroyed while disconnected because immediate rejoin failed (default `1000`)
     * | `eventRateLimit` | `1`...`60`  | maximum number of (possibly bundled) events sent to reflector per second (default `20`)
     * | `debug`       | array or string| pass array of strings to enable multiple debug logs
     * |               | `"session"`    | logs session id and connections
     * |               | `"messages"`   | received from reflector, after decryption, raw messages are in the WebSocket debugger
     * |               | `"sends"`      | sent to reflector, before encryption, raw messages are in the WebSocket debugger
     * |               | `"snapshot"`   | snapshot stats
     * |               | `"data"`       | data API stats
     * |               | `"hashing"`    | code hashing to derive sessionId / persistentId
     * |               | `"subscribe"`  | adding/removing subscriptions
     * |               | `"classes"`    | registering classes
     * |               | `"ticks"`      | each tick received
     *
     * @async
     * @param {Object} parameters
     * @param {String} parameters.apiKey - API key (from croquet.io/keys)
     * @param {String} parameters.appId - [application identifier](https://developer.android.com/studio/build/application-id)
     * @param {String} parameters.name - session name
     * @param {String} parameters.password - session password
     * @param {Model}  parameters.model - root Model class
     * @param {View}   parameters.view - root View class
     * @param {Object?} parameters.options - options passed to root Model's init
     * @param {String?} parameters.step - `"auto" | "manual"`
     * @param {Number?} parameters.tps - ticks per second (`0` to `60`)
     * @param {Number?} parameters.rejoinLimit - ms until view is destroyed while disconnected
     * @param {Number?} parameters.eventRateLimit - max reflector sends per second (`1` to `60`)
     * @param {String?} parameters.debug - enable debug logs
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
        // old API: join(name, ModelRoot=Model, ViewRoot=View, parameters)
        if (typeof parameters !== "object") {
            throw Error(`Croquet: please use new Session.join( {apiKey, ...} ) API. See https://croquet.io/sdk/docs/Session.html#.join`);
        }
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
        if (reflector) {
            if (reflector.includes("://") || reflector.match(/^[-a-z0-9]+$/i)) urlOptions.reflector = reflector;
            else console.warn(`Croquet: Not a valid websocket url, ignoring reflector "${reflector}"`);
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
        // now start
        if ("expectedSimFPS" in parameters) expectedSimFPS = Math.min(parameters.expectedSimFPS, MAX_BALANCE_FPS);
        // parameters to be included in the session spec, if specified by app (or defaulted)
        const SESSION_PARAMS = ['name', 'password', 'apiKey', 'appId', 'tps', 'autoSleep', 'heraldUrl', 'rejoinLimit', 'eventRateLimit', 'optionsFromUrl', 'viewIdDebugSuffix', 'hashOverride'];
        freezeAndHashConstants();
        const controller = new Controller();
        // make sure options are JSONable
        const options = JSON.parse(JSON.stringify({...parameters.options}));
        /** our return value */
        const session = {
            id: '',
            persistentId: '',
            versionId: '',
            model: null,
            view: null,
            // called from our own onAnimationFrame, or application if stepping manually
            step(frameTime) {
                controller.stepSession("animation", { frameTime, view: session.view, expectedSimFPS });
            },
            leave() {
                return Session.leave(session.id);
            },
            get latency() { return controller.latency; },
            get latencies() { return controller.latencies; },
        };

        const sessionSpec = {
            options,
            /** executed inside the island to initialize session */
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

            session.model = controller.island.get("modelRoot");
            session.id = controller.id;
            session.persistentId = controller.persistentId;
            session.versionId = controller.versionId;
            controller.session = session;

            App.makeSessionWidgets(session.id);
            controller.inViewRealm(() => {
                if (urlOptions.has("debug", "session", false)) console.log(session.id, 'creating root view');
                session.view = new ViewRoot(session.model);
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
        const island = Island.current();
        return island ? island.id : "";
    }
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
