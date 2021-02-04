
# Croquet synced video demo

Copyright (C) 2020 Croquet Corporation

This repository contains a demonstration of a Croquet-based app for shared playback of an mp4 video dragged into any user's browser tab.

# Installation

Clone this repository, then in the top directory run

    npm install

then, to start the app,

    npm start

and point a browser to `localhost:9009`

# Usage

* On first load, the URL is automatically extended with a randomised session name and password.  Browser tabs loading the same extended URL will be in the same session.
* Drag and drop a .mp4 file into the browser tab (size currently limited to 100MB) to cue it up
* Click on video or its surround to play/pause
* Click and drag in strip at top to scrub video (play is automatically paused)
* Hover on the QR code in bottom left to expand the code to full size.  Click the code to launch a synchronised tab in the same browser, or use a smartphone's camera to open a synchronised tab on the phone.

    The QR code just contains the extended URL of the page.  Bear in mind during development that of course a localhost URL will only work on a separate device if that device is connected, for example through USB.  Alternatively, you can use a proxy such as `ngrok` to generate a global URL for the port (by default, 9009) through which the app is being served.

* A tab that is hidden for 10 seconds will become dormant.  It will re-sync when revealed again, typically within 5 seconds.
* Drag and drop a different .mp4 into any running tab to replace video in all synced tabs

# Main classes

## Video2DView (video.js)

A thin layer on top of an HTML video element, supporting play/pause/seek, and dealing with wrapped time for looping replay.

## SyncedVideoModel (video.js)

A Croquet Model subclass whose property values and events are automatically replicated between instances (users) in the same session.  The model's properties are minimal: an asset object containing meta data for the video; and video playback state (playing/paused etc). The model also retains data handles for all uploaded files, to avoid having to upload them twice.

Croquet's persistence mechanism ensures the contents will always be restored. However, playback state is not retained, since that makes only sense for an ongoing session.

## SyncedVideoView (video.js)

The guts of the app.  Synchronisation (against the globally coordinated session time provided by Croquet) is handled in method `checkPlayStatus`.

Method `applyPlayState` attempts to impose the desired (shared) playback state on the local video element.  It takes into account that browsers impose restrictions on playback of videos before a user has first clicked on the page: typically, a video will refuse to play (raising an error) unless it is muted.  Therefore if an error occurs, we set `muted` to `true` and try again.  If that still causes an error (Chrome seems ok, but maybe some other browser is more conservative) we switch to "stepping" mode, handled in `stepWhileBlocked`, periodically showing still frames as video time moves on.  In that mode, a user click is then enough to make the video play properly (and unmuted).

When a tab joins (or rejoins) a session, it is fed - in sequence - all events that have taken place in the session while the tab was away.  The `SyncedVideoView` subscribes to the system-level [`synced` event](https://croquet.io/sdk/docs/global.html#event:synced), in order to be informed when the join is complete, meaning that this tab is now in sync.  Only then does the view act on the playback state communicated in the most recent `playStateChanged` event.

Note that if a tab goes dormant due to being hidden, its `SyncedVideoView` will be discarded.  A completely new one is built if and when the tab is re-awakened.

Croquet's Data API takes care of sharing the mp4 file contents.  Note that the existing app works by supplying the entire video content to the `Video2DView` as an [ObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL), _not_ by streaming.


# Dependencies

- icons, all from [the Noun Project](https://thenounproject.com/): Sound, by Markus; play, by Adrien Coquet; point, by Ricardo Martins
