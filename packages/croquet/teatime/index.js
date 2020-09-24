// official exports
export { default as Model } from "./src/model";
export { default as View } from "./src/view";
export { default as Data } from "./src/data";
export { Session, Constants, deprecatedStartSession as startSession } from "./src/session";
export { App } from "@croquet/util/html";

// unofficial exports
export { default as Controller } from "./src/controller";
export { currentRealm } from "./src/realms";
export { QFunc, gatherInternalClassTypes } from "./src/island";
export { Messenger }  from "./src/messenger";

// putting event documentation here because JSDoc errors when parsing controller.js at the moment

/**
 * **Published when a new user enters the session, or re-enters after being temporarily disconnected.**
 *
 * This is a model-only event, meaning views can not handle it directly (as of **0.3.1**).
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
 *     addUser(viewId) {
 *         this.userData[viewId] = { start: this.now() };
 *         this.publish(this.sessionId, "user-added", viewId);
 *     }
 *     deleteUser(viewId) {
 *         const time = this.now() - this.userData[viewId].start;
 *         delete this.userData[viewId];
 *         this.publish(this.sessionId, "user-deleted", {viewId, time});
 *     }
 * }
 * MyModel.register("MyModel");
 * class MyView extends Croquet.View {
 *     constructor(model) {
 *         super(model);
 *         for (const viewId of Object.keys(model.userData)) this.userAdded(viewId);
 *         this.subscribe(this.sessionId, "user-added", this.userAdded);
 *         this.subscribe(this.sessionId, "user-deleted", this.userDeleted);
 *     }
 *     userAdded(viewId) {
 *         console.log(`${ this.viewId === viewId ? "local" : "remote"} user ${viewId} came in`);
 *     }
 *     userDeleted({viewId, time}) {
 *         console.log(`${ this.viewId === viewId ? "local" : "remote"} user ${viewId} left after ${time / 1000} seconds`);
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
 * This is a model-only event, meaning views can not handle it directly (as of **0.3.1**).
 *
 * This event will be published when a view tab is closed, or is disconnected due
 * to network interruption or inactivity.  A view is deemed to be inactive if
 * 10 seconds pass without an execution of the Croquet [main loop]{@link Session.join};
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
