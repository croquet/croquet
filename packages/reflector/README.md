# Croquet Reflector

**The Croquet Reflector is the server component that keeps Croquet clients synchronized.** It maintains perfect state consistency across all connected clients by managing timing beacons and message distribution.

## 🔄 How It Works

The reflector ensures synchronization through a simple but powerful mechanism:

1. **Timing Beacons ("ticks")**: Regular timing signals sent to all clients
2. **Timestamped Messages**: User input events with precise timing information  
3. **Deterministic Replay**: All clients execute the same events in identical order

Since every client starts from the same initial state and processes identical event sequences deterministically, all clients maintain perfect synchronization without complex consensus algorithms.

## 📸 Snapshot & Join Process

**New Client Join Flow:**
1. **Snapshot Discovery**: Reflector identifies the latest available snapshot
2. **SYNC Message**: Sends snapshot URL and subsequent message list to new client
3. **Fast-Forward**: Client loads snapshot and replays all messages since that point
4. **Synchronization**: Client catches up to current state and joins real-time operation

## 🚀 Local Development

### Prerequisites
```bash
npm ci
```

### Running the Reflector
```bash
npm start
```

This starts a WebSocket server on `ws://localhost:9090/` with enhanced logging via `.pino-prettyrc`.

### Testing with Applications

To route a client application to your local reflector, modify the URL parameters:

**Example:** Convert a production URL:
```
https://croquet.io/2d/index.html
```

**To local development:**
```
https://croquet.io/2d/index.html?debug=session,snapshots&reflector=ws://localhost:9090
```

## 🌐 Production Deployment

### Recommended: Croquet-in-a-Box
The easiest way to deploy a complete Croquet environment is [Croquet-in-a-Box](../../server/croquet-in-a-box/), which provides:
- ✅ Reflector server
- ✅ Web server (nginx)  
- ✅ File server (nginx)
- ✅ Single Docker Compose package

This is the recommended approach for most production deployments.

## 📊 Logging & Monitoring

### Log Levels
The reflector uses structured logging with multiple severity levels:

| Function | Level | Usage |
|----------|-------|-------|
| `DEBUG()` | Debug | Development information |
| `LOG()` | Info | General operational info |
| `NOTICE()` | Notice | Significant events |
| `WARN()` | Warning | Potential issues |
| `ERROR()` | Error | Error conditions |

*Levels follow [Google Cloud LogSeverity](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity) standards.*

### Key Metrics Tracked

The reflector logs crucial data for monitoring, billing, and developer dashboards:

#### Connection Metrics
- **`sessionId`**: Unique session identifier
- **`connection`**: Client IP address and port  
- **`userIp`**: User's IP address
- **`stats`**: Traffic statistics object containing:
  - `bi` (number): Bytes in
  - `bo` (number): Bytes out  
  - `mi` (number): Messages in
  - `mo` (number): Messages out

#### Application Metadata
- **`developerId`**: Developer/organization identifier
- **`appId`**: Application identifier
- **`apiKey`**: Developer's API key
- **`persistentId`**: Persistent session identifier
- **`dispatcher`**: Routing dispatcher information

### Structured Event Logging

For significant events, use the `NOTICE()` function with scope and event parameters:

```javascript
// Session lifecycle events
NOTICE("session", "start", {sessionId: id}, "receiving JOIN");
NOTICE("session", "end", {sessionId: id}, "session terminated");

// Process events  
NOTICE("process", "start", {}, "reflector starting");
NOTICE("process", "stop", {}, "reflector shutting down");

// Connection events
NOTICE("connection", "open", {userIp: ip}, "client connected");
NOTICE("connection", "close", {userIp: ip}, "client disconnected");
```

**Scope Categories:**
- **`"process"`**: Reflector process lifecycle
- **`"session"`**: Session management events
- **`"connection"`**: Client connection events

## 🏗️ Architecture Notes

### Sessions vs Islands
In logging and internal operations:
- **`ALL_SESSIONS`**: All sessions (superset, includes inactive)
- **`ALL_ISLANDS`**: Only sessions with active connections (subset)

Both are logged as `sessionId` but represent different operational states.

### Performance Considerations
- **Memory Usage**: Reflector maintains message history for catchup
- **CPU Usage**: Message routing scales with connected client count
- **Network**: Bandwidth scales with message frequency and client count
- **Storage**: Snapshot storage requirements depend on session complexity

## 🔧 Troubleshooting

### M1 Macbook Issues

**Problem:**
```bash
> node reflector.js
dyld[17909]: missing symbol called
[1]    17909 abort      node reflector.js
```

**Cause:** The `fast-crc32c` dependency has M1 chip compatibility issues.

**Solution 1 - Remove dependency (temporary):**
```bash
npm uninstall fast-crc32c
```
*Note: Don't commit this change as it's used in production.*

**Solution 2 - Modify implementation:**
Edit `node_modules/fast-crc32c/loader.js`:
```javascript
const impls = [
  // './impls/sse4_crc32c',  // Comment out this line
  './impls/js_crc32c',
];
```

### Common Issues
- **Port conflicts**: Ensure port 9090 is available
- **WebSocket errors**: Check firewall and proxy settings
- **Memory leaks**: Monitor for growing message histories
- **Performance degradation**: Watch for excessive message rates