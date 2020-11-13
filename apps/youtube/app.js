/* eslint-disable linebreak-style */
// eslint-disable-next-line linebreak-style

/* global Croquet */
/* global YT */

// https://developers.google.com/youtube/iframe_api_reference

class YouTubePlayerView extends Croquet.View {
    constructor(youTubePlayerModel) {
        super(youTubePlayerModel);
        this.youTubePlayerModel = youTubePlayerModel;

        this.model = this.wellKnownModel('modelRoot');

        this.elements = {
            ui: document.getElementById('ui'),

            copy: document.getElementById('copy'),

            currentTime: document.getElementById('currentTime'),
            duration: document.getElementById('duration'),

            timeline: document.getElementById('timeline'),

            play: document.getElementById('play'),
            togglePlayback: document.getElementById('togglePlayback'),
            toggleMuted: document.getElementById('toggleMuted'),
            volume: document.getElementById('volume'),

            toggleSettings: document.getElementById('toggleSettings'),
            toggleFullscreen: document.getElementById('toggleFullscreen'),
            watchOnYouTube: document.getElementById('watchOnYouTube'),

            settings: document.getElementById('settings'),
            videoQuality: document.getElementById('videoQuality'),
            videoQualityTemplate: document.querySelector('template.videoQuality'),
            setVideo: document.getElementById('setVideo'),

            video: document.getElementById('video'),

            videoOverlay: document.getElementById('videoOverlay'),
            controlsOverlay: document.getElementById('controlsOverlay'),
        };

        this.elements.video.innerHTML = '';

        this.elements.timeline.addEventListener('input', this.onTimelineInput.bind(this));

        this.elements.play.addEventListener('click', this.onPlayClick.bind(this));
        this.elements.togglePlayback.addEventListener('click', this.togglePlayback.bind(this));
        this.elements.toggleMuted.addEventListener('click', this.toggleMuted.bind(this));
        this.elements.volume.addEventListener('input', this.onVolumeInput.bind(this));

        this.elements.toggleFullscreen.addEventListener('click', this.toggleFullscreen.bind(this));

        this.elements.watchOnYouTube.addEventListener('click', this.watchOnYouTube.bind(this));

        this.elements.settings.querySelector('.setVideo').addEventListener('click', this.promptUserForVideoUrl.bind(this));
        this.elements.settings.querySelector('.getUrl').addEventListener('click', this.copyUrl.bind(this));

        this.elements.videoOverlay.addEventListener('click', this.onVideoOverlayClick.bind(this));

        if (this.isMobile()) {
            this.elements.ui.classList.add('mobile');
        }

        if (this.youTubePlayerModel.video) {
            this.initPlayer();
        }

        this.subscribe(this.youTubePlayerModel.id, 'did-set-video', this.didSetVideo);
        this.subscribe(this.youTubePlayerModel.id, 'did-set-paused', this.didSetPaused);
        this.subscribe(this.youTubePlayerModel.id, 'did-seek', this.didSeek);
    }

    isMobile() {return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);}
    initPlayer() {
        this.player = new YT.Player('video', {
            width: '100%',
            height: '100%',
            videoId: this.youTubePlayerModel.video,
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
            this.publish(this.youTubePlayerModel.id, 'seek', currentTime);
        }
    }
    onPlayClick() {
        console.log("PLAY");
        this.publish(this.youTubePlayerModel.id, 'set-paused', {isPaused: false, currentTime: this.getCurrentTime()});
    }
    togglePlayback() {
        console.log("toggled playback");
        this.publish(this.youTubePlayerModel.id, 'set-paused', {isPaused: !this.isPaused(), currentTime: this.getCurrentTime()});
    }
    toggleMuted() {
        if (this.isMuted()) {
            this.unMute();
            this.elements.volume.value = this.getVolume();
            this.elements.ui.classList.remove('isMuted');
        }
        else {
            this.mute();
            this.elements.volume.value = 0;
            this.elements.ui.classList.add('isMuted');
        }

        this.elements.volume.dispatchEvent(new Event('input'));
    }
    onVolumeInput(event) {
        if (event.isTrusted) {
            const volume = Number(event.target.value);
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
        if (this._window) {
            this._window.close();
            delete this._window;
        }

        this._window = window.open(this.getUrl());
    }

    secondsToHMS(seconds) {return new Date(seconds * 1000).toISOString().substr(11, 8);}

    onVideoOverlayClick(event) {
        this.togglePlayback();
    }

    // URL
    getUrl() {return `https://youtu.be/${this.youTubePlayerModel.video}?t=${Math.floor(this.getCurrentTime())}s`;}
    copyUrl() {
        if (!this.copying) {
            this.copying = true;

            const url = this.getUrl();

            this.elements.copy.value = url;

            this.elements.copy.select();
            this.elements.copy.setSelectionRange(0, 100);

            document.execCommand('copy');

            this.elements.copy.value = '';
        }
        else {
            delete this.copying;
        }
    }
    uploadUrl(string) {
        try {
            if (!string.startsWith(`http`)) {
                string = `https://${string}`;
            }

            const url = new URL(string);

            if (url.host.includes('youtube.com') && url.searchParams.has('v')) {
                const video = url.searchParams.get('v');
                const currentTime = url.searchParams.get('t') || 0;

                if (video) {
                    console.log(video);
                    this.publish(this.youTubePlayerModel.id, 'set-video', {video, currentTime});
                }
            }
        }
        catch (error) {
            console.error(error);
        }
    }
    promptUserForVideoUrl() {
        const string = window.prompt("submit valid YouTube video url:");
        this.uploadUrl(string);
        this.elements.ui.classList.remove("settings");
    }
    populateVideoQualities() {
        this.elements.videoQuality.querySelectorAll('.videoQuality:not(template)').forEach(videoQualityElement => videoQualityElement.remove());
        // FILL
    }
    populateVideoPlaybackRates() {

    }
    updateDuration() {
        const duration = this.getDuration();

        this.elements.timeline.max = Math.ceil(Number(duration));
        this.elements.duration.innerText = this.secondsToHMS(duration);

        if (!isNaN(this.youTubePlayerModel.duration)) {
            this.publish(this.youTubePlayerModel.id, 'set-duration', duration);
        }
    }
    updateCurrentTime() {
        const currentTime = this.getCurrentTime();
        const duration = this.getDuration();

        this.elements.timeline.value = currentTime;
        this.elements.currentTime.innerText = this.secondsToHMS(currentTime);
    }
    updateTimelineStyle(override) {
        const currentTime = this.getCurrentTime();
        const duration = this.getDuration();
        const percent = 100 * (currentTime/duration);
        const buffered = 100 * this.getVideoLoadedFraction();
        if (override || isNaN(this.buffered) || buffered > this.buffered) {
            this.buffered = buffered;
            this.elements.timeline.style.background = `linear-gradient(to right, red 0%, red ${percent}%, white ${percent}%, white ${buffered}%, grey ${buffered}%, grey 100%)`;
        }
    }
    updatePaused() {
        this.didSetPaused();
    }

    // LOADING
    cueVideoById(videoId, startSeconds) {return this.player.cueVideoById(...arguments);}
    loadVideoById(viewId, startSeconds) {return this.player.loadVideoById(...arguments);}
    cueVideoByUrl(mediaContentUrl, startSeconds) {return this.player.cueVideoByUrl(...arguments);}
    loadVideoByUrl(mediaContentUrl, startSeconds) {return this.player.loadVideoByUrl(...arguments);}

    // PLAYBACK
    playVideo() {return this.player.playVideo();}
    pauseVideo() {return this.player.pauseVideo();}
    stopVideo() {return this.player.stopVideo();}
    seekTo(seconds, allowSeekAhead) {return this.player.seekTo(...arguments);}


    // VOLUME
    mute() {return this.player.mute();}
    unMute() {return this.player.unMute();}
    isMuted() {return this.player.isMuted();}
    setVolume(volume) {return this.player.setVolume(...arguments);}
    getVolume() {return this.player.getVolume();}

    // PLAYER SIZE
    setSize(width, height) {return this.player.setSize(...arguments);}

    // PLAYBACK RATE
    getPlaybackRate() {return this.player.getPlaybackRate();}
    setPlaybackRate(suggestedRate) {return this.player.setPlaybackRate(...arguments);}
    getAvailablePlaybackRates() {return this.getAvailablePlaybackRates();}

    // PLAYBACK STATUS
    getVideoLoadedFraction() {return this.player.getVideoLoadedFraction();}
    getPlayerState() {return this.player.getPlayerState();}
    isPlaying() {return this.getPlayerState() === YT.PlayerState.PLAYING;}
    isPaused() {return this.getPlayerState() === YT.PlayerState.PAUSED;}
    getCurrentTime() {return this.player.getCurrentTime();}

    // VIDEO INFORMATION
    getDuration() {return this.player.getDuration();}
    getVideoUrl() {return this.player.getVideoUrl();}
    getVideoEmbedCode() {return this.getVideoEmbedCode();}

    // EVENTS
    onReady(event) {
        console.log("READY", event);

        this.elements.ui.classList.add('initPlayer');
        this.elements.ui.classList.add('ready');
        this.didInitPlayer = true;

        this._updateDuration = true;
        this._populateVideoQualities = true;
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
                break;
            case YT.PlayerState.PLAYING:
                console.log('playing');

                this.elements.ui.classList.remove('isPaused');
                this.elements.ui.classList.remove('seeking');
                delete this.isSeeking;

                if (this._populateVideoQualities) {
                    this.populateVideoQualities();
                    delete this._populateVideoQualities;
                }
                if (this._updateDuration) {
                    this.updateDuration();
                    delete this._updateDuration;
                }
                if (this._updatePaused) {
                    this.updatePaused();
                    delete this._updatePaused;
                }
                if (this._updateCurrentTime) {
                    setTimeout(() => this.updateCurrentTime(), 800);
                    delete this._updateCurrentTime;
                }

                if (!this._playedOnce) {
                    this._playedOnce = true;
                    this.elements.ui.classList.add('playedOnce');
                }
                break;
            case YT.PlayerState.PAUSED:
                console.log('paused');
                this.elements.ui.classList.add('isPaused');
                this.updateCurrentTime();
                break;
            case YT.PlayerState.BUFFERING:
                console.log('buffering');
                break;
            case YT.PlayerState.CUED:
                console.log('cued');
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
        if (this.player) {
            this.cueVideoById(this.youTubePlayerModel.video, this.youTubePlayerModel.currentTime);
        }
        else {
            this.initPlayer();
        }
    }
    didSetPaused() {
        if (!this.player) return;
        if (!this._playedOnce) return;

        this._didSetPaused = true;
        if (this.youTubePlayerModel.isPaused) {
            this.pauseVideo();
        }
        else {
            this.didSeek();
            this.playVideo();
        }
        delete this._didSetPaused;
    }
    didSeek() {
        if (!this.player) return;

        this.buffered = 0;
        this.elements.ui.classList.add('seeking');
        this.isSeeking = true;
        this.seekTo(this.getModelCurrentTime());
    }

    update(timestamp) {
        if (!this.player || !this.didInitPlayer) return;

        if (!this.isPaused()) {
            const flooredCurrentTime = Math.floor(this.getCurrentTime());
            if (flooredCurrentTime !== this.flooredCurrentTime) {
                this.flooredCurrentTime = flooredCurrentTime;
                this.updateCurrentTime();
                this.updateTimelineStyle(true);
            }
        }

        this.timestamp = this.timestamp || timestamp;
        if (this._playedOnce && timestamp - this.timestamp > 100) {
            if (!this._didSetPaused && this.youTubePlayerModel.isPaused !== this.isPaused()) {
                this.didSetPaused();
            }

            if (!this.isPaused()) {
                if (!this.isSeeking && this.getTimeOffset() > 1) {
                    console.log('fixing time');
                    this.didSeek();
                }
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

    getTimeSinceModelTimestamp() {return (this.now() - this.youTubePlayerModel.timestamp)/1000;}
    getModelCurrentTime() {return this.isPaused()? this.youTubePlayerModel.currentTime : Math.min(this.youTubePlayerModel.currentTime + this.getTimeSinceModelTimestamp(), this.youTubePlayerModel.duration);}
    getTimeOffset() {return Math.abs(this.getCurrentTime() - this.getModelCurrentTime());}
}

class UserView extends Croquet.View {
    constructor(userModel) {
        super(userModel);
        this.userModel = userModel;

        this.model = this.wellKnownModel('modelRoot');
    }
}

class View extends Croquet.View {
    constructor(model) {
        super(model);
        this.model = model;

        this.youTubePlayer = new YouTubePlayerView(this.model.youTubePlayer);

        this.subscribe(this.viewId, 'user-join', this.onJoin);
    }

    onJoin() {
        this.users = [];

        this.subscribe(this.sessionId, 'user-join', this.onUserJoin);
        this.subscribe(this.sessionId, 'user-exit', this.onUserExit);

        this.model.users.forEach(user => this.onUserJoin(user.viewId));
    }

    getUserByViewId(viewId) {return this.users.find(user => user.userModel.viewId === viewId);}
    onUserJoin(viewId) {
        console.log(`viewId ${viewId}${(viewId === this.viewId)? ' (YOU)':''} joined`);

        const userModel = this.model.getUserByViewId(viewId);
        if (userModel) {
            const user = new UserView(userModel);

            this.users.push(user);
        }
    }
    onUserExit(viewId) {
        console.log(`viewId ${viewId} exited`);

        const user = this.getUserByViewId(viewId);
        if (user) {
            user.detach();

            this.users.splice(this.users.indexOf(user), 1);
        }
    }

    update(timestamp) {
        this.youTubePlayer.update(timestamp);
    }
}

let joined = false;
function join() {
    if (!joined) {
        joined = true;
        Croquet.Session.join(`youtube-player-${Croquet.App.autoSession("room")}`, Model, View, {autoSleep: false}).then(session => {
            window.session = session;
        });
    }
}

function onYouTubeIframeAPIReady() {
    join();
}

if (window.YT) {
    join();
}
