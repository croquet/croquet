/* eslint-disable linebreak-style */
/* global Croquet */

class YouTubePlayerModel extends Croquet.Model {
    init(_options, persisted) {
        super.init();

        this.video = null;
        this.subscribe(this.id, 'set-video', this.setVideo);

        this.duration = null;
        this.subscribe(this.id, 'set-duration', this.setDuration);

        this.isPaused = false;
        this.subscribe(this.id, 'set-paused', this.setPaused);

        this.currentTime = null;
        this.subscribe(this.id, 'seek', this.seek);

        this.timestamp = this.now();

        if (persisted) this.setVideo(persisted);
    }

    setVideo({video, currentTime}) {
        this.video = video;
        this.isPaused = false;

        this.currentTime = currentTime || 0;
        this.duration = null;

        this.timestamp = this.now();
        this.publish(this.id, 'did-set-video');

        this.persistSession(() => { video, currentTime });
    }

    setDuration(duration) {
        this.duration = duration;
        this.publish(this.id, 'did-set-duration');
    }

    setPaused({isPaused, currentTime}) {
        this.timestamp = this.now();
        this.isPaused = isPaused;
        this.currentTime = currentTime;
        this.publish(this.id, 'did-set-paused');
    }

    seek(currentTime) {
        this.currentTime = currentTime;
        this.timestamp = this.now();
        this.publish(this.id, 'did-seek');
    }
}
YouTubePlayerModel.register('YouTubePlayer');

class UserModel extends Croquet.Model {
    init({viewId}) {
        super.init();

        this.viewId = viewId;
    }
}
UserModel.register('User');

class Model extends Croquet.Model {
    init() {
        super.init();

        this.youTubePlayer = YouTubePlayerModel.create();

        this.users = [];

        this.subscribe(this.sessionId, 'view-join', this.onViewJoin);
        this.subscribe(this.sessionId, 'view-exit', this.onViewExit);
    }

    getUserByViewId(viewId) {return this.users.find(user => user.viewId === viewId);}
    onViewJoin(viewId) {
        let user = this.getUserByViewId(viewId);
        if (!user) {
            user = UserModel.create({viewId});

            this.users.push(user);

            this.publish(this.sessionId, 'user-join', viewId);
            this.publish(viewId, 'user-join');
        }
    }
    onViewExit(viewId) {
        const user = this.getUserByViewId(viewId);
        if (user) {
            user.destroy();

            this.users.splice(this.users.indexOf(user), 1);

            this.publish(this.sessionId, 'user-exit', viewId);
        }
    }
}
Model.register('Model');
