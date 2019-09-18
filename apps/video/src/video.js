//import { Model, View, startSession, theAssetManager } from "@croquet/croquet";
//import { Model, View, startSession } from "../../sdk/dist/croquet.min.js";  // eslint-disable-line import/extensions
import { Model, View, startSession } from "../../teatime";
import { theAssetManager } from "../../kit/src/userAssets";

//const { GUI } = require('../thirdparty/dat.gui.min');  not used yet.  could be useful.

const SCRUB_THROTTLE = 1000 / 10; // min time between scrub events
const TOUCH = 'ontouchstart' in document.documentElement;

// handler for sharing and playing dropped-in video files
class DragDropHandler {
    constructor(options) {
        this.assetManager = options.assetManager;
        this.rootView = null;

        // NB: per https://developer.mozilla.org/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations, one must cancel (e.g., preventDefault()) on dragenter and dragover events to indicate willingness to receive drop.
        window.addEventListener("dragenter", event => {
            //console.log("ENTER");
            event.preventDefault();
        });

        window.addEventListener("dragover", event => {
            //console.log("OVER");
            event.preventDefault();
        });

        window.addEventListener("dragleave", event => {
            //console.log("LEAVE");
            event.preventDefault();
        });

        window.addEventListener("drop", event => {
            event.preventDefault();
            this.onDrop(event);
        });
    }

    setView(view) { this.rootView = view; }

    isFileDrop(evt) {
        const dt = evt.dataTransfer;
        for (let i = 0; i < dt.types.length; i++) {
            if (dt.types[i] === "Files") {
                return true;
            }
        }
        return false;
    }

    onDrop(evt) {
        if (!this.rootView) return;

        if (this.isFileDrop(evt)) this.assetManager.handleFileDrop(evt.dataTransfer.items, this.rootView.model, this.rootView);
        else console.log("unknown drop type");
    }

}
const dragDropHandler = new DragDropHandler({ assetManager: theAssetManager });


function simpleDebounce(fn, delay) {
    let lastTime = 0;
    let timeoutForFinal = null;
    const clearFinal = () => {
        if (timeoutForFinal) {
            clearTimeout(timeoutForFinal);
            timeoutForFinal = null;
        }
    };
    const runFn = arg => {
        clearFinal(); // shouldn't be one, but...
        lastTime = Date.now();
        fn(arg);
    };
    return arg => {
        clearFinal();
        const toWait = delay - (Date.now() - lastTime);
        if (toWait < 0) runFn(arg);
        else timeoutForFinal = setTimeout(() => runFn(arg), toWait);
    };
}

class TimeBarView {
    constructor() {
        const element = this.element = document.getElementById('timebar');
        element.addEventListener('pointerdown', evt => this.onPointerDown(evt));
        element.addEventListener('pointermove', simpleDebounce(evt => this.onPointerMove(evt), SCRUB_THROTTLE));
        element.addEventListener('pointerup', evt => this.onPointerUp(evt));

        window.addEventListener('resize', () => this.onWindowResize(), false);
        this.onWindowResize();

        this.rootView = null;
        this.lastDragProportion = null;
        this.lastDrawnProportion = null;
    }

    setView(view) {
        this.rootView = view;
        this.drawPlaybar(0);
    }

    onPointerDown(evt) {
        if (!this.rootView) return;

        this.dragging = true;
        this.dragAtOffset(evt.offsetX);
        evt.preventDefault();
    }

    onPointerUp(evt) {
        if (!this.rootView) return;

        this.dragging = false;
        evt.preventDefault();
    }

    // already throttled
    onPointerMove(evt) {
        if (!this.rootView) return;
        if (!this.dragging) return;

        this.dragAtOffset(evt.offsetX);
        evt.preventDefault();
    }

    dragAtOffset(offsetX) {
        const barWidth = this.element.width;
        const timeProportion = Math.max(0, Math.min(1, offsetX / barWidth));
        if (this.lastDragProportion === timeProportion) return;

        this.lastDragProportion = timeProportion;
        this.rootView.handleTimebar(timeProportion);
    }

    onWindowResize() {
        const canvas = this.element;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        // clear saved portion to force redraw
        const portion = this.lastDrawnProportion;
        this.lastDrawnProportion = null;
        this.drawPlaybar(portion);
    }

    drawPlaybar(portion) {
        if (this.lastDrawnProportion === portion) return;

        this.lastDrawnProportion = portion;

        const canvas = this.element;
        const ctx = canvas.getContext("2d");
        canvas.width = canvas.width;
        ctx.fillStyle = "#ff4444";
        ctx.fillRect(0, 0, canvas.width * portion, canvas.height);
    }
}

const timebarView = new TimeBarView();

// a video
class VideoModel extends Model {
    init(options) {
        super.init(options);
        //console.warn(options);

        this.subscribe(this.id, "addAsset", this.addAsset);
        this.subscribe(this.id, "setPlayState", this.setPlayState);
    }

    addAsset(data) {
        this.isPlaying = false;
        this.startOffset = null; // only valid if playing
        this.pausedTime = 0; // only valid if paused
        this.assetDescriptor = data.assetDescriptor;

        this.publish(this.id, "loadVideo", data);
    }

    setPlayState(data) {
        const { isPlaying, startOffset, pausedTime, actionSpec } = data;
        this.isPlaying = isPlaying;
        this.startOffset = startOffset;
        this.pausedTime = pausedTime;
        this.publish(this.id, "playStateChanged", { isPlaying, startOffset, pausedTime, actionSpec });
    }
}
VideoModel.register();

const VIEW_HEIGHT = 2;
const HAND_HEIGHT = 0.4;
const HAND_TILT = Math.PI * 0.1;
const TIMEBAR_HEIGHT_PROP = 0.1;
const TIMEBAR_MARGIN_PROP = TOUCH ? 0 : 0.04;

class SyncedVideoView extends View {
    constructor(model) {
        super(model);
        this.model = model;
        dragDropHandler.setView(this);
        timebarView.setView(this);
        //console.warn(this);

        this.subscribe(this.model.id, { event: "loadVideo", handling: "oncePerFrameWhileSynced" }, this.loadVideo);

        this.videoView = null;
        this.lastStatusCheck = this.now() + 500;
//        this.future(500).checkPlayStatus(); // and it will re-schedule after 100ms each time
    }

    detach() {
        super.detach();
        this.disposeOfVideo();
        dragDropHandler.setView(null);
        timebarView.setView(null);
    }

    disposeOfVideo() {
        // abandon any in-progress load
        if (this.abandonLoad) {
            this.abandonLoad();
            delete this.abandonLoad;
        }

        // and dispose of any already-loaded element
        if (this.videoView) {
            this.videoView.pause();
            const elem = this.videoView.video;
            elem.parentNode.removeChild(elem);
            this.videoView.dispose();
            this.videoView = null;
        }
    }

    loadVideo(data) {
        this.disposeOfVideo(); // discard any loaded or loading video

        this.waitingForIslandSync = !this.realm.isSynced; // this can flip back and forth

        const { assetDescriptor, isPlaying, startOffset, pausedTime } = this.model;
        this.playStateChanged({ isPlaying, startOffset, pausedTime }); // will be stored for now, and may be overridden by messages in a backlog by the time the video is ready
        const assetManager = theAssetManager;

        let okToGo = true; // unless cancelled by another load, or a shutdown
        this.abandonLoad = () => { console.log("abandon"); okToGo = false; };

        assetManager.ensureAssetsAvailable(assetDescriptor)
            .then(() => assetManager.importVideo(assetDescriptor, false)) // false => not 3D
            .then(videoView => {
                if (!okToGo) return; // been cancelled
                delete this.abandonLoad;

                this.videoView = videoView;
                this.playbackBoost = 0;
                this.flip = false; // true means rendered picture acts like a mirror (suitable for local webcam)
                document.getElementById('container').appendChild(videoView.video);
                videoView.video.addEventListener('click', evt => this.handleUserClick(evt));
                //const videoH = videoView.height(), videoW = videoView.width(); // pixels

/* lots of stuff for 3d display
const rectH = this.rectHeight = VIEW_HEIGHT, rectW = this.rectWidth = rectH * videoW / videoH; // @@ stick to a default height of 2 units, for now

const videoRect = new THREE.Mesh(
    new THREE.PlaneBufferGeometry(rectW, rectH),
    new THREE.MeshBasicMaterial({ map: videoView.texture })
);
videoRect.name = "videoView";
if (this.flip) {
    videoRect.material.side = THREE.BackSide;
    videoRect.rotation.y = Math.PI;
}
this.threeObj.add(videoRect);

const enableIcon = new SVGIcon(soundOn, new THREE.MeshBasicMaterial({ color: "#888888" }));
ignorePointer(enableIcon);
enableIcon.rotateX(Math.PI / 2);
let iconHolder = this.enableSoundIcon = new THREE.Group();
iconHolder.add(enableIcon);
iconHolder.visible = false;
let iconScale = 0.7;
iconHolder.scale.set(iconScale, iconScale, iconScale);
iconHolder.position.set(0, 0, 0.01);
this.threeObj.add(iconHolder);

// in this case it matters that SVG and THREE have opposite expectations for sense of +ve y
const outerHand = new SVGIcon(remoteHand, new THREE.MeshBasicMaterial({ color: "#ffffff" }), undefined, undefined, false); // a y-flipped hand (looks like the back of a left hand)
ignorePointer(outerHand);
outerHand.rotateX(Math.PI); // flip over (now looks like a right hand again, pointing up)
outerHand.rotateZ(Math.PI - HAND_TILT); // remembering that icon's Z is now into picture
const innerHand = new SVGIcon(remoteHand, new THREE.MeshBasicMaterial({ color: "#444444" }), undefined, 0.95, false);
ignorePointer(innerHand);
innerHand.rotateX(Math.PI); // flip over (now looks like a right hand again, pointing up)
innerHand.rotateZ(Math.PI - HAND_TILT); // remembering that icon's Z is now into picture
iconHolder = this.remoteHandIcon = new THREE.Group();
iconHolder.add(outerHand);
innerHand.position.set(0, 0, 0.005);
iconHolder.add(innerHand);
iconHolder.visible = false;
iconScale = HAND_HEIGHT;
iconHolder.scale.set(iconScale, iconScale, iconScale);
iconHolder.position.set(0, 0, 0.02);
this.threeObj.add(iconHolder);

const playIcon = new SVGIcon(playButton, new THREE.MeshBasicMaterial({ color: "#888888" }));
ignorePointer(playIcon);
playIcon.rotateX(Math.PI / 2);
iconHolder = this.playIcon = new THREE.Group();
iconHolder.add(playIcon);
iconScale = 0.7;
iconHolder.scale.set(iconScale, iconScale, iconScale);
iconHolder.position.set(0, 0, 0.01);
this.threeObj.add(iconHolder);

// @@ seems hacky
this.realm.island.controller.inViewRealm(() => { // needs to run in realm so it can create a new View
    const timebarW = rectW - 2 * rectH * TIMEBAR_MARGIN_PROP, timebarH = rectH * TIMEBAR_HEIGHT_PROP, timebarY = -rectH * (0.5 - TIMEBAR_MARGIN_PROP - TIMEBAR_HEIGHT_PROP / 2);
    const timebar = this.timebar = new TimebarView({ videoView: this, width: timebarW, height: timebarH }); // margins of 0.04 * h
    timebar.threeObj.position.set(0, timebarY, 0.02);
    this.threeObj.add(timebar.threeObj);
});

this.publish(this.id, ViewEvents.changedDimensions, {});
*/

                this.applyPlayState();
                this.lastTimingCheck = this.now() + 500; // let it settle before we try to adjust
            }).catch(err => console.error(err));

        this.subscribe(this.model.id, "playStateChanged", this.playStateChanged);
        this.subscribe(this.viewId, { event: "synced", handling: "immediate" }, this.handleSyncState);
    }

    adjustPlaybar() {
        const time = this.videoView.isPlaying ? this.videoView.video.currentTime : (this.latestPlayState.pausedTime || 0);
        timebarView.drawPlaybar(time / this.videoView.duration);
    }

    playStateChanged(rawData) {
        const data = { ...rawData }; // take a copy that we can play with
        this.latestActionSpec = data.actionSpec; // if any
        delete data.actionSpec;

        const latest = this.latestPlayState;
        // ignore if we've heard this one before (probably because we set it locally)
        if (latest && Object.keys(data).every(key => data[key] === latest[key])) return;

        this.latestPlayState = Object.assign({}, data);
        this.applyPlayState(); // will be ignored if we're still initialising
    }

    applyPlayState() {
        if (!this.videoView || this.waitingForIslandSync) return;

        //console.log("apply playState", {...this.latestPlayState});
        if (!this.latestPlayState.isPlaying) {
            // @@ this.playIcon.visible = true;
            // @@ this.enableSoundIcon.visible = false;
            this.videoView.pause(this.latestPlayState.pausedTime);
        } else {
            // @@ this.playIcon.visible = false;
            this.videoView.video.playbackRate = 1 + this.playbackBoost * 0.01;
            this.lastRateAdjust = this.now(); // make sure we don't adjust rate before playback has settled in, and any emergency jump we decide to do
            this.jumpIfNeeded = false;
            // if the video is blocked from playing, enter a stepping mode in which we move the video forward with successive pause() calls
            this.videoView.play(this.calculateVideoTime() + 0.1).then(playStarted => {
                // @@ this.enableSoundIcon.visible = !playStarted;
                if (playStarted) this.future(250).triggerJumpCheck(); // leave it a little time to stabilise
                else {
                    //console.log(`stepping video`);
                    this.isStepping = true;
                    this.stepWhileBlocked();
                }
            });
        }

        // @@ if (this.latestActionSpec) this.revealAction(this.latestActionSpec);
    }

    revealAction(spec) {
        if (spec.viewId !== this.viewId) {
            const type = spec.type;
            if (type === "body") {
                this.useHandToPoint(spec.x, spec.y);
            } else if (type === "timebar") {
                const xOnTimebar = this.timebar.timebarLength * (spec.proportion - 0.5);
                const yOnTimebar = -this.rectHeight * (0.5 - TIMEBAR_MARGIN_PROP - TIMEBAR_HEIGHT_PROP * 0.75);
                this.useHandToPoint(xOnTimebar, yOnTimebar);
            }
        }
    }

    useHandToPoint(targetX, targetY) {
        if (!this.remoteHandIcon) return;

        if (this.remoteHandTimeout) clearTimeout(this.remoteHandTimeout);

        // end of finger is around (-0.1, 0.5) relative to centre
        const xOffset = -0.1 * HAND_HEIGHT, yOffset = (0.5 + 0.05) * HAND_HEIGHT; // a bit off the finger
        const sinTilt = Math.sin(HAND_TILT), cosTilt = Math.cos(HAND_TILT);
        const x = xOffset * cosTilt - yOffset * sinTilt, y = xOffset * sinTilt + yOffset * cosTilt;
        const pos = this.remoteHandIcon.position;
        pos.x = targetX + x;
        pos.y = targetY + y;
        this.remoteHandIcon.visible = true;
        this.remoteHandTimeout = setTimeout(() => this.remoteHandIcon.visible = false, 1000);
    }

    calculateVideoTime() {
        const { isPlaying, startOffset } = this.latestPlayState;
        if (!isPlaying) debugger;

        const sessionNow = this.now(); // or is this.externalNow() going to be more consistent??
        return (sessionNow - startOffset) / 1000;
    }

    stepWhileBlocked() {
        if (!this.isStepping) return; // we've left stepping mode
        if (!this.videoView.isBlocked) {
            this.isStepping = false;
            return;
        }
        this.videoView.setStatic(this.calculateVideoTime());
        this.future(50).stepWhileBlocked();
    }

    handleSyncState(isSynced) {
        //console.warn(`synced: ${isSynced}`);
        const wasWaiting = this.waitingForIslandSync;
        this.waitingForIslandSync = !isSynced;
        if (wasWaiting && isSynced) this.applyPlayState();
    }

    handleUserClick(clickPt) {
        if (!this.videoView) return;

        // if the video is playing but blocked, this click will in theory be able to start it.
        if (this.isStepping) {
            console.log(`stop video stepping`);
            this.isStepping = false;
            this.applyPlayState();
            return;
        }

        const wantsToPlay = !this.latestPlayState.isPlaying; // toggle
        if (!wantsToPlay) this.videoView.pause(); // immediately!
        const videoTime = this.videoView.video.currentTime;
        const sessionTime = this.now(); // the session time corresponding to the video time
        const startOffset = wantsToPlay ? sessionTime - 1000 * videoTime : null;
        const pausedTime = wantsToPlay ? 0 : videoTime;
        this.playStateChanged({ isPlaying: wantsToPlay, startOffset, pausedTime }); // directly from the handler, in case the browser blocks indirect play() invocations
        const actionSpec = { viewId: this.viewId, type: "body", x: clickPt.x, y: clickPt.y };
        this.publish(this.model.id, "setPlayState", { isPlaying: wantsToPlay, startOffset, pausedTime, actionSpec }); // subscribed to by the shared model
    }

    handleTimebar(proportion) {
        if (!this.videoView) return;

        const wantsToPlay = false;
        const videoTime = this.videoView.duration * proportion;
        const startOffset = null;
        const pausedTime = videoTime;
        this.playStateChanged({ isPlaying: wantsToPlay, startOffset, pausedTime });
        const actionSpec = { viewId: this.viewId, type: "timebar", proportion };
        this.publish(this.model.id, "setPlayState", { isPlaying: wantsToPlay, startOffset, pausedTime, actionSpec }); // subscribed to by the shared model
    }

    triggerJumpCheck() { this.jumpIfNeeded = true; } // on next checkPlayStatus() that does a timing check

    checkPlayStatus() {
        if (this.videoView) {
            this.adjustPlaybar();

            const lastTimingCheck = this.lastTimingCheck || 0;
            const now = this.now();
            // check video timing every 0.5s
            if (this.videoView.isPlaying && !this.videoView.isBlocked && (now - lastTimingCheck >= 500)) {
                this.lastTimingCheck = now;
                const expectedTime = this.videoView.wrappedTime(this.calculateVideoTime());
                const videoTime = this.videoView.video.currentTime;
                const videoDiff = videoTime - expectedTime;
                const videoDiffMS = videoDiff * 1000; // +ve means *ahead* of where it should be
                if (videoDiff < this.videoView.duration / 2) { // otherwise presumably measured across a loop restart; just ignore.
                    if (this.jumpIfNeeded) {
                        this.jumpIfNeeded = false;
                        // if there's a difference greater than 500ms, try to jump the video to the right place
                        if (Math.abs(videoDiffMS) > 500) {
                            console.log(`jumping video by ${-Math.round(videoDiffMS)}ms`);
                            this.videoView.video.currentTime = this.videoView.wrappedTime(videoTime - videoDiff + 0.1, true); // 0.1 to counteract the delay that the jump itself tends to introduce; true to ensure we're not jumping beyond the last video frame
                        }
                    } else {
                        // every 3s, check video lag/advance, and set the playback rate accordingly.
                        // current adjustment settings:
                        //   > 150ms off: set playback 3% faster/slower than normal
                        //   > 50ms: 1% faster/slower
                        //   < 25ms: normal (i.e., hysteresis between 50ms and 25ms in the same sense)
                        const lastRateAdjust = this.lastRateAdjust || 0;
                        if (now - lastRateAdjust >= 3000) {
    //console.log(`${Math.round(videoDiff*1000)}ms`);
                            const oldBoostPercent = this.playbackBoost;
                            const diffAbs = Math.abs(videoDiffMS), diffSign = Math.sign(videoDiffMS);
                            const desiredBoostPercent = -diffSign * (diffAbs > 150 ? 3 : (diffAbs > 50 ? 1 : 0));
                            if (desiredBoostPercent !== oldBoostPercent) {
                                // apply hysteresis on the switch to boost=0.
                                // for example, if old boost was +ve (because video was lagging),
                                // and videoDiff is -ve (i.e., it's still lagging),
                                // and the magnitude (of the lag) is greater than 25ms,
                                // don't remove the boost yet.
                                const hysteresisBlock = desiredBoostPercent === 0 && Math.sign(oldBoostPercent) === -diffSign && diffAbs >= 25;
                                if (!hysteresisBlock) {
                                    this.playbackBoost = desiredBoostPercent;
                                    const playbackRate = 1 + this.playbackBoost * 0.01;
                                    console.log(`video playback rate: ${playbackRate}`);
                                    this.videoView.video.playbackRate = playbackRate;
                                }
                            }
                            this.lastRateAdjust = now;
                        }
                    }
                }
            }
        }
//        this.future(100).checkPlayStatus();
    }

    // @@ need to think through whether this leads to more or less erratic timing than
    // using future() messages.
    // presumably depends on the relative progress of frames and ticks.
    update() {
        const now = this.now();
        if (now - this.lastStatusCheck > 100) {
            this.lastStatusCheck = now;
            this.checkPlayStatus();
        }
    }
}

async function go() {

    const session = await startSession("video", VideoModel, SyncedVideoView, { step: 'auto', autoSession: true });

//    const controller = session.view.realm.island.controller;
/*
    window.requestAnimationFrame(frame);
    function frame(timestamp) {
        session.step(timestamp);

        if (session.view) sceneSpec.render();

        window.requestAnimationFrame(frame);

    }
*/
}

go();
