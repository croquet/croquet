# Croquet

**Croquet enables you to build real-time multiuser applications without writing server-side code.** Unlike traditional client/server architectures, the multiplayer logic executes on each client in a synchronized virtual machine, rather than on a centralized server.

*Croquet is available as a JavaScript library that synchronizes applications using Multisynq's global DePIN network.*

## ✨ Key Benefits

- 🚀 **Deploy as static websites** - No server infrastructure needed
- 🔧 **No server-side code** - Focus purely on your application logic  
- 🌐 **No networking code** - Automatic synchronization handled for you
- 🎯 **Framework independent** - Works with React, Vue, vanilla JS, and more

## 🚀 Getting Started

### 1. Get Your API Key
Get a free API key from [multisynq.io](https://multisynq.io/coder)  
*(You can also run your own server, but the global Multisynq network is used by default)*

### 2. Install Croquet

**Via npm:**
```bash
npm install @croquet/croquet
```

**Via CDN (pre-bundled):**
```html
<script src="https://cdn.jsdelivr.net/npm/@croquet/croquet@2.0.0/pub/croquet.min.js"></script>
```

**Via ES modules:**
```javascript
import * as Croquet from "https://cdn.jsdelivr.net/npm/@croquet/croquet@2.0.0/pub/croquet.esm.js";
```

### 3. Structure Your Application

Organize your app into two parts:
- **Synchronized part**: Subclass `Croquet.Model` - shared state and logic
- **Local part**: Subclass `Croquet.View` - user interface and local interactions

### 4. Join a Session

Use `Croquet.Session.join()` with your API key to connect users.

**That's it!** No server deployment needed - just HTML and JavaScript.

## 📚 Learn More

- **Documentation**: [multisynq.io/docs](https://multisynq.io/docs)
- **Examples**: [Croquet GitHub repo](http://github.com/croquet/croquet)

## 🎯 The Prime Directive

**Your Croquet Model must be completely self-contained.**

### Model Requirements

- ✅ **Deterministic**: Must produce identical results on all clients
- ✅ **Serializable**: Store state in object-oriented style (no functions)
- ✅ **Event-driven**: Interact with outside world only via view-published events
- ❌ **No global state**: Cannot read from global variables
- ❌ **No async code**: Cannot use Promises, async/await, setTimeout, etc.

### View Flexibility

The view layer has no restrictions - use any programming style, framework, or async patterns you prefer.

### Why These Rules?

These constraints ensure that all clients maintain identical state, enabling Croquet's unique architecture where the "server" logic runs identically on every client.

## 🌐 Infrastructure & Security

### Global Network
By default, Croquet runs on the [Multisynq DePIN network](https://multisynq.io), which automatically selects a server close to the first user in each session for optimal performance.

### Self-Hosting
You can [run your own reflector](https://github.com/croquet/croquet/tree/main/packages/reflector), though you won't benefit from global deployment.

### Privacy & Security
- **End-to-end encryption**: All communication encrypted by random session password
- **Zero server processing**: Application code and data only processed on clients  
- **Server-blind**: Servers never decrypt application data
- **Maximum privacy**: One of the most private real-time multiplayer solutions available

## 📋 Change Log

*Following [keep-a-changelog](https://keepachangelog.com/) format. For detailed internal changes see [CHANGELOG](./CHANGELOG.md).*

### [2.0] - 2025-04-08

**First Apache-2.0 licensed release**

#### ✨ Added
- Support for Multisynq DePIN network (API key at [multisynq.io](https://multisynq.io/coder))
- `Model.isExecuting()` static check
- `Model.createQFunc()` for serializable functions in snapshots
- Generic subscriptions (scope and/or event as `"*"`)
- `activeSubscription()` to access current event context (scope, event, source)
- Static property snapshotting support
- `App.randomSession()` and `App.randomPassword()` utilities
- `viewData` property support in `Session.join()` (passed to `view-join` event)

### [1.1] - 2024-03-20

#### ✨ Added
- `BigInt` snapshotting support
- `Model.cancelFuture()` to stop scheduled future messages
- `Model.evaluate()` for code evaluation with Model semantics
- `View.session` property providing access to session object
- `viewOptions` property support in `Session.join()`
- Optional `handler` argument for `Model.unsubscribe()` and `View.unsubscribe()`
- Debug flags: `"write"` (detects model state mutations), `"offline"` (single-user mode)
- Node.js client support

#### 🐛 Fixed
- Shared buffer snapshotting in Typed Arrays
- Circular reference deserialization in Set and Map

### [1.0] - 2021-08-23

**Initial public release**
