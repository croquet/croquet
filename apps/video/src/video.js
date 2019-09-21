/*
   Copyright 2019 Croquet Studios

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
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


// a throttle that also ensures that the last value is delivered
function throttle(fn, delay) {
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
        element.addEventListener('pointermove', throttle(evt => this.onPointerMove(evt), SCRUB_THROTTLE));
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

// Video2DView is an interface over an HTML video element.
// its readyPromise resolves once the video is available to play.
export class Video2DView {
    constructor(url) {
        this.url = url;
        this.video = document.createElement("video");
        this.video.autoplay = false;
        this.video.loop = true;
        this.isPlaying = false;
        this.isBlocked = false; // unless we find out to the contrary, on trying to play

        this.readyPromise = new Promise(resolved => {
            this._ready = () => resolved(this);
        });

        this.video.oncanplay = () => {
            this.duration = this.video.duration; // ondurationchange is (apparently) always ahead of oncanplay
            this._ready();
        };

        this.video.onerror = () => {
            let err;
            const errCode = this.video.error.code;
            switch (errCode) {
                case 1: err = "video loading aborted"; break;
                case 2: err = "network loading error"; break;
                case 3: err = "video decoding failed / corrupted data or unsupported codec"; break;
                case 4: err = "video not supported"; break;
                default: err = "unknown video error";
            }
            console.log(`Error: ${err} (errorcode=${errCode})`);
        };

        /* other events, that can help with debugging
        [ "pause", "play", "seeking", "seeked", "stalled", "waiting" ].forEach(k => { this.video[`on${k}`] = () => console.log(k); });
        */

        this.video.crossOrigin = "anonymous";

        if (!this.video.canPlayType("video/mp4").match(/maybe|probably/i)) {
            console.log("apparently can't play video");
        }

        this.video.src = this.url;
        this.video.load();
    }

    width() { return this.video.videoWidth; }
    height() { return this.video.videoHeight; }

    wrappedTime(videoTime, guarded) {
        if (this.duration) {
            while (videoTime > this.duration) videoTime -= this.duration; // assume it's looping, with no gap between plays
            if (guarded) videoTime = Math.min(this.duration - 0.1, videoTime); // the video element freaks out on being told to seek very close to the end
        }
        return videoTime;
    }

    async play(videoTime) {
        // return true if video play started successfully
        this.video.currentTime = this.wrappedTime(videoTime, true);
        this.isPlaying = true; // even if it turns out to be blocked by the browser
        // following guidelines from https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/play
        try {
            await this.video.play(); // will throw exception if blocked
            this.isBlocked = false;
        } catch (err) {
            console.warn("video play blocked");
            this.isBlocked = this.isPlaying; // just in case isPlaying was set false while we were trying
        }
        return !this.isBlocked;
    }

    pause(videoTime) {
        this.isPlaying = this.isBlocked = false; // might not be blocked next time.
        this.setStatic(videoTime);
    }

    setStatic(videoTime) {
        if (videoTime !== undefined) this.video.currentTime = this.wrappedTime(videoTime, true); // true => guarded from values too near the end
        this.video.pause(); // no return value; synchronous, instantaneous?
    }

    dispose() {
        try {
            URL.revokeObjectURL(this.url);
            if (this.texture) {
                this.texture.dispose();
                delete this.texture;
            }
            delete this.video;
        } catch (e) { console.warn(`error in Video2DView cleanup: ${e}`); }
    }
}

// a shared model for handling video loads and interactions
class SyncedVideoModel extends Model {
    init(options) {
        super.init(options);

        this.subscribe(this.id, 'addAsset', this.addAsset);
        this.subscribe(this.id, 'setPlayState', this.setPlayState);
    }

    // the assetManager sends an 'addAsset' event when an asset (in this app, a video) is loaded and ready for display
    addAsset(data) {
        this.isPlaying = false;
        this.startOffset = null; // only valid if playing
        this.pausedTime = 0; // only valid if paused
        this.assetDescriptor = data.assetDescriptor;

        this.publish(this.id, 'loadVideo'); // no event argument needed; the view will consult the model directly
    }

    // the SyncedVideoView sends 'setPlayState' events when the user plays, pauses or scrubs the video.  the interface location of the user action responsible for this change of state is specified in actionSpec.
    setPlayState(data) {
        const { isPlaying, startOffset, pausedTime, actionSpec } = data;
        this.isPlaying = isPlaying;
        this.startOffset = startOffset;
        this.pausedTime = pausedTime;
        this.publish(this.id, 'playStateChanged', { isPlaying, startOffset, pausedTime, actionSpec });
    }
}
SyncedVideoModel.register();


class SyncedVideoView extends View {
    constructor(model) {
        super(model);
        this.model = model;
        dragDropHandler.setView(this);
        timebarView.setView(this);

        this.enableSoundIcon = document.getElementById('soundon');
        this.playIcon = document.getElementById('play');
        this.remoteHandIcon = document.getElementById('remotehand');
        this.container = document.getElementById('container');

        this.subscribe(this.model.id, { event: 'loadVideo', handling: 'oncePerFrameWhileSynced' }, this.loadVideo);
        this.subscribe(this.model.id, { event: 'playStateChanged', handling: 'oncePerFrame' }, this.playStateChanged);
        this.subscribe(this.viewId, 'synced', this.handleSyncState);

        this.videoView = null;
        this.lastStatusCheck = this.now() + 500; // make the update loop wait a bit before checking the first time
    }

    loadVideo() {
        this.disposeOfVideo(); // discard any loaded or loading video

        this.waitingForSync = !this.realm.isSynced; // this can flip back and forth

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

                document.getElementById('prompt').style.opacity = 0;

                this.videoView = videoView;
                const videoElem = this.videoElem = videoView.video;
                this.playbackBoost = 0;
                this.container.appendChild(videoElem);

                this.applyPlayState();
                this.lastTimingCheck = this.now() + 500; // let it settle before we try to adjust
            }).catch(err => console.error(err));
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

        this.latestPlayState = data;
        this.applyPlayState(); // will be ignored if we're still initialising
    }

    applyPlayState() {
        if (!this.videoView || this.waitingForSync) return;

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
        const wasWaiting = this.waitingForSync;
        this.waitingForSync = !isSynced;
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

    iconVisible(iconName, bool) {
        this[`${iconName}Icon`].style.opacity = bool ? 1 : 0;
    }
}

async function go() {

    startSession("video", SyncedVideoModel, SyncedVideoView, { step: 'auto', autoSession: true });

}

go();
