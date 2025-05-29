# Croquet Synchronized Video Demo

**A real-time collaborative video player built with Croquet** - allows multiple users to watch videos together in perfect synchronization across devices.

*Copyright (C) 2025 Croquet Labs*

## ✨ Features

- 🎬 **Synchronized playback** - All users see the exact same video frame
- 📁 **Drag & drop upload** - Simply drag an MP4 file into any browser tab
- ▶️ **Shared controls** - Play, pause, and scrubbing affects all connected users
- 📱 **Cross-device support** - QR code for easy mobile joining
- 🔄 **Auto-sync** - Tabs automatically re-sync when returning from being hidden
- 💾 **Session persistence** - Uploaded videos remain available throughout the session

## 🚀 Quick Start

### Installation

```bash
git clone <repository-url>
cd <repository-name>
npm install
```

### Running the App

```bash
npm start
```

Then open your browser to [localhost:9009](http://localhost:9009)

## 🎮 How to Use

### Getting Started
1. **Automatic session creation**: The URL is automatically extended with a randomized session name and password
2. **Join from multiple devices**: Any browser loading the same extended URL joins the same session

### Video Controls
- **Upload**: Drag and drop any `.mp4` file into the browser tab (max 100MB)
- **Play/Pause**: Click anywhere on the video or its surrounding area
- **Scrubbing**: Click and drag in the timeline strip at the top (automatically pauses during scrubbing)
- **Replace video**: Drag a different `.mp4` file to replace the current video across all tabs

### Multi-Device Features
- **QR Code**: Hover over the QR code (bottom left) to expand it to full size
- **Quick join**: Click the QR code to open a synchronized tab in the same browser
- **Mobile access**: Use a smartphone camera to scan the QR code and join on mobile

### Session Management
- **Dormant handling**: Hidden tabs become dormant after 10 seconds and re-sync when revealed (typically within 5 seconds)
- **Session persistence**: Videos and metadata persist throughout the session

## 🏗️ Architecture

### Core Classes

#### `Video2DView` (video.js)
A lightweight wrapper around HTML5 video elements that provides:
- Enhanced play/pause/seek functionality
- Wrapped time handling for seamless looping
- Cross-browser compatibility handling

#### `SyncedVideoModel` (video.js)
The Croquet Model that maintains synchronized state:
- **Asset metadata**: Video file information and properties
- **Playback state**: Current playing/paused status and position
- **Data persistence**: Retains uploaded file handles to prevent duplicate uploads
- **Automatic restoration**: Croquet's persistence ensures content is always restored

*Note: Playback state is intentionally not persisted across sessions since it only makes sense for active sessions.*

#### `SyncedVideoView` (video.js)
The main application logic handling synchronization:

##### Key Methods:
- **`checkPlayStatus()`**: Core synchronization logic against Croquet's global session time
- **`applyPlayState()`**: Manages browser playback restrictions and fallbacks:
  - Handles "muted autoplay" requirements
  - Implements "stepping mode" for restrictive browsers
  - Automatic unmuting after user interaction

##### Synchronization Features:
- **Join/Rejoin handling**: Processes all missed events when tabs rejoin sessions
- **Sync event subscription**: Responds to Croquet's `synced` event to know when catch-up is complete
- **Dormant recovery**: Automatically rebuilds view when tabs are re-awakened

### Data Handling

**File Sharing**: Uses Croquet's Data API for efficient video file distribution
- **ObjectURL creation**: Videos are provided as [ObjectURLs](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL) rather than streaming
- **Automatic deduplication**: Prevents re-uploading of identical files
- **Cross-session persistence**: Files remain available throughout session lifetime

## 🌐 Development Notes

### Cross-Device Testing
- **Localhost limitations**: localhost URLs only work on the same network
- **Global access**: Consider using tools like `ngrok` to create public URLs for remote device testing
- **USB debugging**: For mobile testing, ensure devices are properly connected via USB

### Browser Compatibility
- **Autoplay policies**: Different browsers have varying restrictions on video autoplay
- **Fallback strategies**: The app implements multiple fallback strategies for restrictive environments
- **User interaction**: Some features require initial user interaction to fully activate

## 📦 Dependencies

### Icons
All icons sourced from [The Noun Project](https://thenounproject.com/):
- **Sound icon**: by Markus
- **Play icon**: by Adrien Coquet  
- **Point icon**: by Ricardo Martins

### Libraries
- **Croquet**: Real-time synchronization framework
- **Standard web APIs**: HTML5 Video, Drag & Drop, ObjectURL

---

## 🤝 Contributing

This demo showcases Croquet's capabilities for real-time collaborative applications. Feel free to use it as a starting point for your own synchronized media experiences!

## 📄 License

Licensed under the same terms as the main Croquet project.
