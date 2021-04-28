/* global Croquet YT Swal tippy */

class YouTubePlayerModel extends Croquet.Model {
    init(options, persisted) {
        super.init(options, persisted);

        this.users = {};

        this.video = null;
        this.subscribe(this.id, 'set-video', this.setVideo);

        this.duration = null;
        this.subscribe(this.id, 'set-duration', this.setDuration);

        this.isPaused = false;
        this.subscribe(this.id, 'set-paused', this.setPaused);

        this.currentTime = null;
        this.subscribe(this.id, 'seek', this.seek);

        this.isEnded = false;
        this.subscribe(this.id, 'set-ended', this.setEnded);

        this.timestamp = this.now();

        this.users = [];

        this.subscribe(this.sessionId, 'view-join', this.onViewJoin);
        this.subscribe(this.sessionId, 'view-exit', this.onViewExit);

        if (persisted) this.setVideo(persisted, true);
    }

    setVideo({video, currentTime}, resuming) {
        this.video = video;
        this.isPaused = false;
        this.isEnded = false;

        this.currentTime = currentTime || 0;
        this.duration = null;

        this.timestamp = this.now();
        this.publish(this.id, 'did-set-video');

        if (!resuming) {
            this.wellKnownModel("modelRoot").persistSession(() => ({ video, currentTime }));
        }
    }

    setDuration(duration) {
        this.duration = duration;
        this.publish(this.id, 'did-set-duration');
    }

    setPaused({isPaused, currentTime}) {
        this.timestamp = this.now();
        this.isPaused = isPaused;
        this.isEnded = false;
        if (currentTime !== undefined) {
            this.currentTime = currentTime;
            this.publish(this.id, 'did-set-paused');
        }
    }

    setEnded(flag) {
        this.isEnded = flag;
    }

    seek(currentTime) {
        this.currentTime = currentTime;
        this.isEnded = false;
        this.timestamp = this.now();
        this.publish(this.id, 'did-seek');
    }

    onViewJoin(viewId) {
        if (Object.keys(this.users).length === 0) {
            this.setPaused({isPaused: false});
        }

        if (!this.users[viewId]) {
            this.users[viewId] = true;
            this.publish(this.id, 'user-join', viewId);
        }
    }

    onViewExit(viewId) {
        delete this.users[viewId];
        this.publish(this.sessionId, 'user-exit', viewId);
    }
}

YouTubePlayerModel.register('YouTubePlayer');


// https://developers.google.com/youtube/iframe_api_reference

class YouTubePlayerView extends Croquet.View {
    constructor(model) {
        super(model);
        this.model = model;
        this.elements = {
            ui: document.getElementById('ui'),

            copy: document.getElementById('copy'),

            currentTime: document.getElementById('currentTime'),
            duration: document.getElementById('duration'),

            timeline: document.getElementById('timeline'),
            scrubTimeline: document.getElementById('scrubTimeline'),

            play: document.getElementById('play'),
            togglePlayback: document.getElementById('togglePlayback'),
            toggleMuted: document.getElementById('toggleMuted'),
            volume: document.getElementById('volume'),

            //toggleSettings: document.getElementById('toggleSettings'),
            toggleFullscreen: document.getElementById('toggleFullscreen'),
            watchOnYouTube: document.getElementById('watchOnYouTube'),

            //settings: document.getElementById('settings'),
            //videoQuality: document.getElementById('videoQuality'),
            //videoQualityTemplate: document.querySelector('template.videoQuality'),
            //setVideo: document.getElementById('setVideo'),

            tellUserToSetVideo: document.getElementById('tellUserToSetVideo'),
            video: document.getElementById('video'),

            videoOverlay: document.getElementById('videoOverlay'),
            controlsOverlay: document.getElementById('controlsOverlay'),
        };

        this.elements.video.innerHTML = '';

        this.addEventListener(this.elements.timeline, 'input', this.onTimelineInput.bind(this));
        this.addEventListener(this.elements.timeline, 'pointermove', this.onTimelineOver.bind(this));
        this.addEventListener(this.elements.timeline, 'pointerleave', this.onTimelineLeave.bind(this));

        this.addEventListener(this.elements.play, 'click', this.onPlayClick.bind(this));
        this.addEventListener(this.elements.togglePlayback, 'click', this.togglePlayback.bind(this));
        this.addEventListener(this.elements.toggleMuted, 'click', this.toggleMuted.bind(this));
        this.addEventListener(this.elements.volume, 'input', this.onVolumeInput.bind(this));
        this.addEventListener(this.elements.toggleFullscreen, 'click', this.toggleFullscreen.bind(this));

        this.addEventListener(this.elements.watchOnYouTube, 'click', this.watchOnYouTube.bind(this));

        this.addEventListener(this.elements.tellUserToSetVideo, 'click', this.promptUserForVideoUrl.bind(this));
        //this.addEventListener(this.elements.settings.querySelector('.getUrl'), 'click', this.copyUrl.bind(this));

        this.addEventListener(this.elements.videoOverlay, 'click', this.onVideoOverlayClick.bind(this));

        //this.addEventListener(document, 'paste', this.onPaste.bind(this));
        //this.addEventListener(document, 'copy', this.onCopy.bind(this));
        this.addEventListener(document, 'keydown', this.onKeyDown.bind(this));

        // MEDIA UPLOADING
        this.addEventListener(document, 'dragenter', this.onDragEnter.bind(this));
        this.addEventListener(document, 'dragover', this.onDragOver.bind(this));
        this.addEventListener(document, 'dragleave', this.onDragLeave.bind(this));
        this.addEventListener(document, 'drop', this.onDrop.bind(this));

        this.addEventListener(document, "wheel", this.onWheel.bind(this), { passive: false, capture: false });

        if (this.isMobile()) {
            this.elements.ui.classList.add('mobile');
        }

        if (window.top !== window) {
            this.elements.ui.classList.add("greenlight");
        }

        this.ready = false;
        this.playerResolve = null;
        this.playerPromise = null;

        if (this.model.video) {
            setTimeout(() => {
                this.initPlayer();
            }, 1500);
        }

        this.setupTippyTooltip();

        this.subscribe(this.model.id, 'did-set-video', this.didSetVideo);
        this.subscribe(this.model.id, 'did-set-paused', this.didSetPaused);
        this.subscribe(this.model.id, 'did-seek', this.didSeek);

        this.subscribe(this.model.id, 'user-join', this.onUserJoin);
        this.subscribe(this.model.id, 'user-exit', this.onUserExit);
    }

    ensurePlayer() {
        if (this.ready) {
            return Promise.resolve(true);
        }

        if (!this.playerPromise) {
            this.playerPromise = new Promise((resolve, _reject) => {
                this.playerResolve = val => {
                    this.ready = true;
                    this.playerResolve = null;
                    this.playerPromise = null;
                    resolve(val);
                };
            });
        }

        return this.playerPromise;
    }

    // EVENT LISTENERS
    addEventListener(element, type, _eventListener, options) {
        this._eventListeners = this._eventListeners || [];

        const eventListener = _eventListener.bind(this);
        element.addEventListener(type, eventListener, options);
        this._eventListeners.push({element, type, eventListener, _eventListener});
    }

    removeEventListener(element, type, eventListener) {
        const record = this._eventListeners.find(rec => rec.element === element && rec.type === type && rec._eventListener === eventListener);
        if (record) element.removeEventListener(type, record.eventListener);
    }

    removeEventListeners() {
        this._eventListeners.forEach(({element, type, eventListener}) => {
            element.removeEventListener(type, eventListener);
        });
    }

    detach() {
        super.detach();
        this.removeEventListeners();
    }

    onWheel(evt) {
        evt.preventDefault();
    }

    isMobile() {return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);}

    setupTippyTooltip() {
        tippy(this.elements.watchOnYouTube, {
            content: "URL copied to clipboard",
            hideOnClick: false,
            trigger: "click",

            onShow(instance) {
                setTimeout(() => {
                    instance.hide();
                }, 2000);
            }
        });
    }

    initPlayer() {
        this.player = new YT.Player('video', {
            width: '100%',
            height: '100%',
            videoId: this.model.video,
            events: {
                'onReady': this.onReady.bind(this),
                'onStateChange': this.onStateChange.bind(this),
                'onPlaybackQualityChange': this.onPlaybackQualityChange.bind(this),
                'onPlaybackRateChange': this.onPlaybackRateChange.bind(this),
                'onError': this.onError.bind(this),
            },
            playerVars: {
                autoplay: 0,
                controls: 0,
                autohid: 1,
                wmode: 'opaque',
                enablejsapi: 10,
                fs: 1,
                playsinline: 1,
                rel: 0,
                showinfo: 0,
            },
        });
    }

    // EVENTLISTENERS
    onTimelineInput(event) {
        if (event.isTrusted) {
            const currentTime = Number(event.target.value);
            this.publish(this.model.id, 'seek', currentTime);

            if (this.isPaused) {
                this.updateCurrentTime(currentTime);
            }
        }
    }

    onTimelineOver(event) {
        if (!this.ready) {return;}
        this.getDuration().then(duration => {
            const offsetX = event.offsetX;
            const width = event.target.getBoundingClientRect().width;

            const sWidth = this.elements.scrubTimeline.getBoundingClientRect().width;
            const proposedTime = (Math.max(event.offsetX - 1, 0) / width) * duration;
            this.updateScrubTimeline(proposedTime, offsetX - (sWidth / 2));
        });
    }

    onTimelineLeave(event) {
        this.elements.scrubTimeline.style.display = "none";
    }

    onPlayClick() {
        console.log("PLAY");
        this.getCurrentTime().then(currentTime => {
            this.publish(this.model.id, 'set-paused', {isPaused: false, currentTime});
        });
    }

    replay() {
        console.log("REPLAY");
        this.getCurrentTime().then(() => {
            this.publish(this.model.id, 'set-paused', {isPaused: false, currentTime: 0});
        });
    }

    togglePlayback() {
        if (this.isEnded()) {
            this.replay();
            return;
        }
        console.log("toggled playback");
        this.getCurrentTime().then(currentTime => {
            this.publish(this.model.id, 'set-paused', {isPaused: !this.isPaused(), currentTime});
        });
    }

    toggleMuted() {
        this.isMuted().then(isMuted => {
            if (isMuted) {
                this.unMute();
                this.getVolume().then(vol => {
                    this.elements.volume.value = vol;
                });
                this.elements.ui.classList.remove('isMuted');
            }
            else {
                this.mute();
                this.elements.volume.value = 0;
                this.elements.ui.classList.add('isMuted');
            }
        });

        this.elements.volume.dispatchEvent(new Event('input'));
    }

    onVolumeInput(event) {
        if (event.isTrusted) {
            const volume = parseFloat(event.target.value);
            this.setVolume(volume);
            if (volume > 0) {
                this.unMute();
                this.elements.ui.classList.remove('isMuted');
            }
            else {
                this.mute();
                this.elements.ui.classList.add('isMuted');
            }
        }
    }
    toggleFullscreen() {
        if (document.fullscreenEnabled) {
            if (document.fullscreenElement) {
                document.exitFullscreen().then(() => {
                    this.elements.ui.classList.add('fullscreen');
                });
            }
            else {
                this.elements.ui.requestFullscreen().then(() => {
                    this.elements.ui.classList.add('fullscreen');
                });
            }
        }
    }

    watchOnYouTube() {
        this.copyUrl();
    }

    secondsToHMS(seconds) {
        let rem = seconds;
        let h = Math.floor(rem / 3600);
        rem -= h * 3600;
        h = `${h}`.padStart(2, "0");
        let m = Math.floor(rem / 60);
        rem -= m * 60;
        m = `${m}`.padStart(2, "0");
        let s = Math.floor(rem);
        s = `${s}`.padStart(2, "0");
        return `${h}:${m}:${s}`;
    }

    onVideoOverlayClick(_event) {
        this.togglePlayback();
    }

    // URL
    getUrl() {
        return this.getCurrentTime().then(currentTime => {
            return `https://youtu.be/${this.model.video}?t=${Math.floor(currentTime)}s`;
        });
    }

    copyUrl() {
        if (!this.copying) {
            this.copying = true;

            this.getUrl().then(url => {
                this.elements.copy.value = url;
                this.elements.copy.select();
                this.elements.copy.setSelectionRange(0, 100);
                document.execCommand('copy');
                this.elements.copy.value = '';
            });
        }
        else {
            delete this.copying;
        }
    }

    uploadUrl(string) {
        try {
            let video, currentTime;
            let url;
            if (string.indexOf("/") < 0 && string.indexOf(".") < 0) {
                video = string;
            } else {
                if (!string.startsWith(`http`)) {
                    string = `https://${string}`;
                }

                url = new URL(string);
                if (url.host.includes('youtube.com') && url.searchParams.has('v')) {
                    video = url.searchParams.get('v');
                }
                else if (url.host.includes('youtu.be') && url.pathname.length > 1) {
                    video = url.pathname.slice(1);
                }
            }

            if (video) {
                currentTime = (url && parseFloat(url.searchParams.get('t'))) || 0;
                console.log(video, currentTime);
                this.publish(this.model.id, 'set-video', {video, currentTime});
            }
        }
        catch (error) {
            console.error(error);
        }
    }

    promptUserForVideoUrl() {
        Swal.fire({
            input: 'text',
            inputLabel: 'A YouTube link',
            inputPlaceholder: 'Enter a link to a YouTube video',
            showCancelButton: true,
        }).then(result => {
            if (result.value && result.value.length > 0) {
                this.uploadUrl(result.value);
            }
        });
    }

    populateVideoQualities() {
    }

    populateVideoPlaybackRates() {
    }

    updateDuration() {
        this.getDuration().then(duration => {
            this.elements.timeline.max = Math.ceil(parseFloat(duration));
            this.elements.duration.innerText = this.secondsToHMS(duration);

            this.publish(this.model.id, 'set-duration', duration);
        });
    }

    updateCurrentTime(provisional) {
        if (provisional !== undefined) {
            this.provisional = provisional;
            this.elements.timeline.value = provisional;
            this.elements.currentTime.innerText = this.secondsToHMS(provisional);
            return;
        }

        this.getCurrentTime().then(currentTime => {
            currentTime = currentTime || 0;

            this.elements.timeline.value = currentTime;
            this.elements.currentTime.innerText = this.secondsToHMS(currentTime);
        });
    }

    updateTimelineStyle(override) {
        Promise.all([
            this.getCurrentTime(),
            this.getDuration(),
            this.getVideoLoadedFraction()
        ]).then(([currentTime, duration, fraction]) => {
            const percent = 100 * (currentTime/duration);
            const buffered = 100 * fraction;
            if (override || Number.isNaN(this.buffered) || buffered > this.buffered) {
                this.buffered = buffered;
                this.elements.timeline.style.background = `linear-gradient(to right, red 0%, red ${percent}%, white ${percent}%, white ${buffered}%, grey ${buffered}%, grey 100%)`;
            }
        });
    }

    updatePaused() {
        this.didSetPaused();
        this.didSeek();
    }

    updateScrubTimeline(proposedTime, offsetX) {
        const now = Date.now();
        if (this.lastScrubAttempt && now - this.lastScrubAttempt < 16) {
            return;
        }

        this.lastScrubAttempt = now;

        this.elements.scrubTimeline.style.left = offsetX;
        this.elements.scrubTimeline.style.display = "inherit";
        this.elements.scrubTimeline.innerHTML = this.secondsToHMS(proposedTime);
    }

    // LOADING
    cueVideoById(videoId, startSeconds) {
        return this.ensurePlayer().then(() => {
            return this.player.cueVideoById(videoId, startSeconds);
        });
    }

    loadVideoById(videoId, startSeconds) {
        return this.ensurePlayer().then(() => {
            return this.player.loadVideoById(videoId, startSeconds);
        });
    }

    // PLAYBACK
    playVideo() {
        return this.ensurePlayer().then(() => {
            return this.player.playVideo();
        });
    }

    pauseVideo() {
        return this.ensurePlayer().then(() => {
            return this.player.pauseVideo();
        });
    }

    stopVideo() {
        return this.ensurePlayer().then(() => {
            return this.player.stopVideo();
        });
    }

    seekTo(seconds, allowSeekAhead) {
        return this.ensurePlayer().then(() => {
            return this.player.seekTo(seconds, allowSeekAhead);
        });
    }

    // VOLUME
    mute() {
        return this.ensurePlayer().then(() => {
            return this.player.mute();
        });
    }

    unMute() {
        return this.ensurePlayer().then(() => {
            return this.player.unMute();
        });
    }

    isMuted() {
        return this.ensurePlayer().then(() => {
            return this.player.isMuted();
        });
    }

    setVolume(volume) {
        return this.ensurePlayer().then(() => {
            return this.player.setVolume(volume);
        });
    }

    getVolume() {
        return this.ensurePlayer().then(() => {
            return this.player.getVolume();
        });
    }

    // PLAYER SIZE
    setSize(width, height) {
        return this.ensurePlayer().then(() => {
            return this.player.setSize(width, height);
        });
    }

    // PLAYBACK RATE
    getPlaybackRate() {
        return this.ensurePlayer().then(() => {
            return this.player.getPlaybackRate();
        });
    }

    setPlaybackRate(suggestedRate) {
        return this.ensurePlayer().then(() => {
            return this.player.setPlaybackRate(suggestedRate);
        });
    }

    getAvailablePlaybackRates() {
        return this.ensurePlayer().then(() => {
            return this.getAvailablePlaybackRates();
        });
    }

    // PLAYBACK STATUS
    getVideoLoadedFraction() {
        return this.ensurePlayer().then(() => {
            return this.player.getVideoLoadedFraction();
        });
    }

    getPlayerState() {
        if (!this.ready) {
            return null;
        }
        return this.player.getPlayerState();
    }

    isPlaying() {
        return this.getPlayerState() === YT.PlayerState.PLAYING;
    }

    isPaused() {
        return this.getPlayerState() === YT.PlayerState.PAUSED ||
            (this._playedOnce && this.getPlayerState() === YT.PlayerState.CUED);
    }

    isEnded() {
        return this.getPlayerState() === YT.PlayerState.ENDED;
    }

    getCurrentTime() {
        return this.ensurePlayer().then(() => {
            return this.player.getCurrentTime();
        });
    }

    // VIDEO INFORMATION
    getDuration() {
        return this.ensurePlayer().then(() => {
            return this.player.getDuration();
        });
    }

    getVideoUrl() {
        return this.ensurePlayer().then(() => {
            return this.player.getVideoUrl();
        });
    }

    getVideoEmbedCode() {
        return this.getVideoEmbedCode();
    }

    // EVENTS
    onReady(event) {
        console.log("READY", event);

        this.ready = true;

        this.elements.ui.classList.add('initPlayer');
        this.elements.ui.classList.add('ready');

        this._updateDuration = true;
        this._updatePaused = true;
        this._updateCurrentTime = true;
        this._playedOnce = false;
    }

    onStateChange(event) {
        console.log(event);
        const {data} = event;
        switch (data) {
            case YT.PlayerState.UNSTARTED:
                console.log('unstarted');
                break;
            case YT.PlayerState.ENDED:
                console.log('ended');
                this.publish(this.model.id, "set-ended", true);
                break;
            case YT.PlayerState.PLAYING:
                this.elements.ui.classList.remove('isPaused');
                this.elements.ui.classList.remove('seeking');
                delete this.isSeeking;

                if (this._updateDuration) {
                    this.updateDuration();
                    delete this._updateDuration;
                }
                if (this._updatePaused) {
                    this._initialPause = true;
                    this.updatePaused();
                    delete this._updatePaused;
                }
                if (this._updateCurrentTime) {
                    setTimeout(() => {
                        this.updateCurrentTime();
                    }, 800);
                    delete this._updateCurrentTime;
                }

                if (!this._playedOnce) {
                    this._playedOnce = true;
                    this.didSeek();
                    this.elements.ui.classList.add('playedOnce');
                }
                break;
            case YT.PlayerState.PAUSED:
                console.log('paused');
                this.elements.ui.classList.add('isPaused');
                this.elements.ui.classList.remove('seeking');
                if (this._initialPause === undefined) {
                    this.didSeek();
                }
                delete this._initialPause;
                break;
            case YT.PlayerState.BUFFERING:
                console.log('buffering');
                break;
            case YT.PlayerState.CUED:
                console.log('cued');
                this._updateDuration = true;
                this._updateCurrentTime = true;
                break;
            default:
                break;
        }
    }

    onPlaybackQualityChange(event) {
        console.log(event);
    }

    onPlaybackRateChange(event) {
        console.log(event);
    }

    onError(event) {
        console.log(event);
        const {data} = event;
        switch (data) {
            case 2:
                console.log("The request contains an invalid parameter value. For example, this error occurs if you specify a video ID that does not have 11 characters, or if the video ID contains invalid characters, such as exclamation points or asterisks.");
                break;
            case 5:
                console.log("The requested content cannot be played in an HTML5 player or another error related to the HTML5 player has occurred");
                break;
            case 100:
                console.log("The video requested was not found. This error occurs when a video has been removed (for any reason) or has been marked as private.");
                break;
            case 101:
                console.log("The owner of the requested video does not allow it to be played in embedded players.");
                break;
            case 150:
                console.log("The owner of the requested video does not allow it to be played in embedded players.");
                break;
            default:
                break;
        }
    }

    onApiChange(event) {
        console.log(event);
    }

    // DID
    didSetVideo() {
        console.log("did set video");
        if (this.player) {
            console.log(this.model.currentTime);
            this.cueVideoById(this.model.video, this.model.currentTime);
        }
        else {
            this.initPlayer();
        }
    }

    didSetPaused() {
        console.log("did set paused");
        if (!this.player) return;
        if (!this._playedOnce) return;

        this._didSetPaused = true;
        if (this.model.isPaused) {
            this.pauseVideo();
        }
        else {
            this.didSeek();
            this.playVideo();
        }
        delete this._didSetPaused;
    }

    didEnd() {
        // it would get multiple messages
    }

    didSeek() {
        console.log("did seeek");
        this.ensurePlayer().then(() => {
            this.buffered = 0;
            this.elements.ui.classList.add('seeking');
            this.isSeeking = true;
            this.seekTo(this.getModelCurrentTime());
            if (this.isPaused()) {
                this.updateCurrentTime(this.getModelCurrentTime());
            }
        });
    }

    update(timestamp) {
        if (!this.ready) return;
        if (this.model.isEnded) {return;}

        if (!this.isPaused()) {
            this.getCurrentTime().then(currentTime => {
                const flooredCurrentTime = Math.floor(currentTime);
                if (flooredCurrentTime !== this.flooredCurrentTime) {
                    this.flooredCurrentTime = flooredCurrentTime;
                    this.updateCurrentTime();
                    this.updateTimelineStyle(true);
                }
            });
        }

        this.timestamp = this.timestamp || timestamp;
        if (this._playedOnce && timestamp - this.timestamp > 100) {
            if (!this._didSetPaused && this.model.isPaused !== this.isPaused()) {
                this.didSetPaused();
            }

            if (!this.isPaused()) {
                this.getTimeOffset().then(timeOffset => {
                    if (!this.isSeeking && timeOffset > 1) {
                        console.log('fixing time');
                        this.didSeek();
                    }
                });
            }

            this.timestamp = timestamp;
        }

        this.updateTimelineStyleTimestamp = this.updateTimelineStyleTimestamp || Date.now();
        if (this._playedOnce && (timestamp - this.updateTimelineStyleTimestamp) > 100) {
            this.updateTimelineStyleTimestamp = timestamp;
            this.updateTimelineStyle();
        }

        this.updateTimelineStyle();
    }

    // COPY/PASTE
    onPaste(event) {
        if (event.clipboardData.types.find(type => type.includes('text/'))) {
            const text = event.clipboardData.getData('text');
            if (text) {
                this.uploadUrl(text);
            }
        }
    }

    onCopy(_event) {
        this.copyUrl();
    }

    onKeyDown(event) {
        if (!this.ready) {return;}
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            this.getCurrentTime().then(currentTime => {
                const newTime = currentTime + (event.key === 'ArrowRight' ? 5 : -5);
                this.publish(this.model.id, 'seek', newTime);
            });
            event.preventDefault();
            return;
        }
        if (event.key === ' ') {
            this.togglePlayback();
            event.preventDefault();
        }
    }

    getTimeSinceModelTimestamp() {
        return (this.now() - this.model.timestamp) / 1000;
    }

    getModelCurrentTime() {
        return this.isPaused()
            ? this.model.currentTime
            : Math.min(this.model.currentTime + this.getTimeSinceModelTimestamp(), this.model.duration);
    }

    getTimeOffset() {
        return this.getCurrentTime().then(currentTime => {
            return Math.abs(currentTime - this.getModelCurrentTime());
        });
    }

    // DRAG
    onDragEnter(event) {
        event.preventDefault();
    }
    onDragOver(event) {
        event.preventDefault();
    }
    onDragLeave(event) {
        event.preventDefault();
    }
    onDrop(event) {
        event.preventDefault();

        if (event.dataTransfer.types.find(type => type.includes('text/'))) {
            const text = event.dataTransfer.getData('text');
            this.uploadUrl(text);
        }
    }

    onUserJoin(viewId) {
        console.log(`viewId ${viewId}${(viewId === this.viewId)? ' (YOU)':''} joined`);
    }

    onUserExit(viewId) {
        console.log(`viewId ${viewId} exited`);
    }
}

function load() {
    let joined = false;
    function join() {
        if (!joined) {
            joined = true;
            Croquet.Session.join({
                appId: "io.croquet.youtube",
                name: Croquet.App.autoSession('q'),
                password: "secret",
                model: YouTubePlayerModel,
                view: YouTubePlayerView,
                autoSleep: false,
            }).then(session => {
                window.session = session;
                Croquet.Messenger.startPublishingPointerMove();
            });
        }
    }

    if (window.YT) {
        join();
    }
}

window.onload = load;
