import { Model, View, startSession } from "@croquet/croquet";
import { theAssetManager } from "./assetManager";

const SCRUB_THROTTLE = 1000 / 10; // min time between scrub events

// handler for sharing and playing dropped-in video files
class DragDropHandler {
    constructor(options) {
        this.assetManager = options.assetManager;
        this.rootView = null;

        // NB: per https://developer.mozilla.org/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations, one must cancel (e.g., preventDefault()) on dragenter and dragover events to indicate willingness to receive drop.
        window.addEventListener('dragenter', event => {
            event.preventDefault();
        });

        window.addEventListener('dragover', event => {
            event.preventDefault();
        });

        window.addEventListener('dragleave', event => {
            event.preventDefault();
        });

        window.addEventListener('drop', event => {
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

        const container = document.getElementById('container');
        container.addEventListener('pointerup', evt => this.onContainerClick(evt)); // pointerdown doesn't seem to satisfy the conditions for immediately activating a video, at least on Android

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
        evt.stopPropagation();
        if (!this.rootView) return;

        this.dragging = true;
        this.dragAtOffset(evt.offsetX);
        evt.preventDefault();
    }

    onPointerUp(evt) {
        evt.stopPropagation();
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

    onContainerClick(evt) {
        if (!this.rootView) return;

        this.rootView.handleUserClick(evt);
        evt.preventDefault();
    }

    drawPlaybar(portion) {
        if (this.lastDrawnProportion === portion) return;

        this.lastDrawnProportion = portion;

        const canvas = this.element;
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.width;
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(0, 0, canvas.width * portion, canvas.height);
    }
}
const timebarView = new TimeBarView();

// a video
class VideoModel extends Model {
    init(options) {
        super.init(options);
        //console.warn(options);

        this.subscribe(this.id, 'addAsset', this.addAsset);
        this.subscribe(this.id, 'setPlayState', this.setPlayState);
    }

    addAsset(data) {
        this.isPlaying = false;
        this.startOffset = null; // only valid if playing
        this.pausedTime = 0; // only valid if paused
        this.assetDescriptor = data.assetDescriptor;

        this.publish(this.id, 'loadVideo', data);
    }

    setPlayState(data) {
        const { isPlaying, startOffset, pausedTime, actionSpec } = data;
        this.isPlaying = isPlaying;
        this.startOffset = startOffset;
        this.pausedTime = pausedTime;
        this.publish(this.id, 'playStateChanged', { isPlaying, startOffset, pausedTime, actionSpec });
    }
}
VideoModel.register();


class SyncedVideoView extends View {
    constructor(model) {
        super(model);
        this.model = model;
        dragDropHandler.setView(this);
        timebarView.setView(this);
        //console.warn(this);

        this.enableSoundIcon = document.getElementById('soundon');
        this.playIcon = document.getElementById('play');
        this.remoteHandIcon = document.getElementById('remotehand');
        this.container = document.getElementById('container');

        this.subscribe(this.model.id, { event: 'loadVideo', handling: 'oncePerFrameWhileSynced' }, this.loadVideo);

        this.videoView = null;
        this.lastStatusCheck = this.now() + 500; // make the update loop wait a bit before checking the first time
    }

    iconVisible(iconName, bool) {
        this[`${iconName}Icon`].style.opacity = bool ? 1 : 0;
    }

    detach() {
        super.detach(); // will discard any outstanding future() messages
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

    loadVideo(_data) {
        this.disposeOfVideo(); // discard any loaded or loading video

        this.waitingForIslandSync = !this.realm.isSynced; // this can flip back and forth

        const { assetDescriptor, isPlaying, startOffset, pausedTime } = this.model;
        this.playStateChanged({ isPlaying, startOffset, pausedTime }); // will be stored for now, and may be overridden by messages in a backlog by the time the video is ready
        const assetManager = theAssetManager;

        let okToGo = true; // unless cancelled by another load, or a shutdown
        this.abandonLoad = () => okToGo = false;

        assetManager.ensureAssetsAvailable(assetDescriptor)
            .then(() => assetManager.importVideo(assetDescriptor, false)) // false => not 3D
            .then(videoView => {
                if (!okToGo) return; // been cancelled
                delete this.abandonLoad;

                this.videoView = videoView;
                const videoElem = this.videoElem = videoView.video;
                this.playbackBoost = 0;
                this.container.appendChild(videoElem);

                this.applyPlayState();
                this.lastTimingCheck = this.now() + 500; // let it settle before we try to adjust
            }).catch(err => console.error(err));

        this.subscribe(this.model.id, 'playStateChanged', this.playStateChanged);
        this.subscribe(this.viewId, { event: 'synced', handling: 'immediate' }, this.handleSyncState);
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

        const { videoView, videoElem } = this;

        //console.log("apply playState", {...this.latestPlayState});
        if (!this.latestPlayState.isPlaying) {
            this.iconVisible('play', true);
            this.iconVisible('enableSound', false);
            videoView.pause(this.latestPlayState.pausedTime);
        } else {
            this.iconVisible('play', false);
            videoElem.playbackRate = 1 + this.playbackBoost * 0.01;
            this.lastRateAdjust = this.now(); // make sure we don't adjust rate until playback has settled in, and after any emergency jump we decide to do
            this.jumpIfNeeded = false;
            // if the video is blocked from playing, enter a stepping mode in which we move the video forward with successive pause() calls
            videoView.play(this.calculateVideoTime() + 0.1).then(playStarted => {
                this.iconVisible('enableSound', !playStarted || videoElem.muted);
                if (playStarted) this.future(250).triggerJumpCheck(); // leave it a little time to stabilise
                else if (!videoElem.muted) {
                    console.log(`trying with mute`);
                    videoElem.muted = true;
                    this.applyPlayState();
                } else {
                    console.log(`reverting to stepped display`);
                    this.isStepping = true;
                    this.stepWhileBlocked();
                }
            });
        }

        if (this.latestActionSpec) this.revealAction(this.latestActionSpec);
    }

    revealAction(spec) {
        if (!this.videoView) return;

        if (spec.viewId !== this.viewId) {
            const type = spec.type;

            let element;
            if (type === 'video') element = this.videoElem;
            else if (type === 'timebar') element = timebarView.element;
            else throw new Error(`unknown action type`);

            const rect = element.getBoundingClientRect();
            this.useHandToPoint(spec.x * rect.width + rect.left, spec.y * rect.height + rect.top);
        }
    }

    useHandToPoint(targetX, targetY) {
        // targetX, Y are page coords.  we need to convert to coords within #container.
        const hand = this.remoteHandIcon;
        if (!hand) return;

        if (this.remoteHandTimeout) clearTimeout(this.remoteHandTimeout);

        const handRect = hand.getBoundingClientRect();
        const contRect = this.container.getBoundingClientRect();

        // end of finger is around (0.25, 0.15) relative to element size
        hand.style.left = `${targetX - handRect.width * 0.25 - contRect.left}px`;
        hand.style.top = `${targetY - handRect.height * 0.15 - contRect.top}px`;
        this.iconVisible('remoteHand', true);
        this.remoteHandTimeout = setTimeout(() => this.iconVisible('remoteHand', false), 1000);
    }

    calculateVideoTime() {
        const { isPlaying, startOffset } = this.latestPlayState;
        if (!isPlaying) debugger;

        const sessionNow = this.now();
        return (sessionNow - startOffset) / 1000;
    }

    stepWhileBlocked() {
        if (!this.isStepping) return; // we've left stepping mode
        if (!this.videoView.isBlocked) {
            this.isStepping = false;
            return;
        }

        this.videoView.setStatic(this.calculateVideoTime());
        this.future(250).stepWhileBlocked(); // jerky, but keeping up
    }

    handleSyncState(isSynced) {
        //console.warn(`synced: ${isSynced}`);
        const wasWaiting = this.waitingForIslandSync;
        this.waitingForIslandSync = !isSynced;
        if (wasWaiting && isSynced) this.applyPlayState();
    }

    handleUserClick(evt) {
        if (!this.videoView) return;

        const { videoView, videoElem } = this;

        // if the video is being stepped (i.e., wouldn't even play() when muted),
        // this click will in theory be able to start it playing.
        if (this.isStepping) {
            console.log(`exiting step mode`);
            videoElem.muted = false;
            this.isStepping = false;
            this.applyPlayState();
            return;
        }

        // if video was playing but is muted (which means we discovered it wouldn't
        // play unmuted), this click should be able to remove the mute.
        if (videoElem.muted) {
            console.log(`unmuting video`);
            videoElem.muted = false;
            this.iconVisible('enableSound', false);
            return;
        }

        const wantsToPlay = !this.latestPlayState.isPlaying; // toggle
        if (!wantsToPlay) videoView.pause(); // immediately!
        const videoTime = videoView.video.currentTime;
        const sessionTime = this.now(); // the session time corresponding to the video time
        const startOffset = wantsToPlay ? sessionTime - 1000 * videoTime : null;
        const pausedTime = wantsToPlay ? 0 : videoTime;
        this.playStateChanged({ isPlaying: wantsToPlay, startOffset, pausedTime }); // directly from the handler, in case the browser blocks indirect play() invocations
        // even though the click was on the container, find position relative to video
        const contRect = this.container.getBoundingClientRect();
        const rect = videoElem.getBoundingClientRect();
        const actionSpec = { viewId: this.viewId, type: 'video', x: (evt.offsetX + contRect.left - rect.left)/rect.width, y: (evt.offsetY + contRect.top - rect.top)/rect.height };
        this.publish(this.model.id, 'setPlayState', { isPlaying: wantsToPlay, startOffset, pausedTime, actionSpec }); // subscribed to by the shared model
    }

    handleTimebar(proportion) {
        if (!this.videoView) return;

        const wantsToPlay = false;
        const videoTime = this.videoView.duration * proportion;
        const startOffset = null;
        const pausedTime = videoTime;
        this.playStateChanged({ isPlaying: wantsToPlay, startOffset, pausedTime });
        const actionSpec = { viewId: this.viewId, type: 'timebar', x: proportion, y: 0.5 };
        this.publish(this.model.id, 'setPlayState', { isPlaying: wantsToPlay, startOffset, pausedTime, actionSpec }); // subscribed to by the shared model
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
    }

    // invoked on every animation frame
    update() {
        const now = this.now();
        if (now - this.lastStatusCheck > 100) {
            this.lastStatusCheck = now;
            this.checkPlayStatus();
        }
    }
}

async function go() {

    startSession("video", VideoModel, SyncedVideoView, { step: 'auto', autoSession: true });

}

go();
