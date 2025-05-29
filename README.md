# Croquet 🦩

[![NPM Version](https://img.shields.io/npm/v/%40croquet%2Fcroquet)](http://npmjs.com/package/@croquet/croquet)
[![NPM Dev](https://img.shields.io/npm/v/%40croquet%2Fcroquet/dev?color=%23C33)](https://www.npmjs.com/package/@croquet/croquet?activeTab=versions)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE.txt)

**Croquet enables you to build real-time multiuser applications without writing server-side code.** Unlike traditional client/server architectures, the multiplayer logic executes on each client in a synchronized virtual machine, rather than on a centralized server.

Croquet is available as a JavaScript library that synchronizes applications using [Multisynq's global DePIN network](https://multisynq.io). Additionally, the reflector server that keeps virtual machines in sync is available as a Node.js package for self-hosting.

## Quick Start

Get started with Croquet in minutes:

1. **Get an API key**: Sign up at [multisynq.io/coder](https://multisynq.io/coder) for a free API key
2. **Install the library**: `npm install @croquet/croquet`
3. **Build your first app**: Follow our [quick start guide](https://multisynq.io/docs/croquet/)

## Key Features

- 🚀 **No server code required** - Deploy as static websites
- 🔄 **Real-time synchronization** - Automatic state sync across all clients
- 🌐 **Global infrastructure** - Powered by Multisynq's decentralized network
- 🎯 **Framework agnostic** - Works with any UI framework
- 🔒 **End-to-end encrypted** - Session data is never decrypted on servers
- 📦 **Self-hostable** - Run your own reflector servers if needed

## License

Croquet is licensed under [Apache-2.0](LICENSE.txt).

## Development & Testing

### Building the Library

Some examples in `apps/` require a local build of Croquet:

```bash
cd packages/croquet
./build.sh
```

### Building Everything

To build both the library and all examples:

```bash
./build.sh
```

This creates a `_site/` folder with all built applications and is used by our GitHub Actions for the GitHub Pages site.

### API Keys for Testing

The examples in `apps/` use a placeholder Multisynq API key that is only valid for testing on the local network and the Croquet GitHub Pages site. You can get your own key on the [Multisynq](https://multisynq.io/coder) website. Alternatively, check out Croquet-in-a-Box below.

## Repository Structure

```
croquet/
├── apps/                    # Various examples and tests
├── docs/                    # Documentation source files (JSDoc)
├── packages/
│   ├── croquet/            # Main client-side Croquet library
│   └── reflector/          # Node.js reflector server package
├── server/
    └── croquet-in-a-box/   # Docker-based local development server
```

### Key Directories

- **`apps/`** - Various Croquet applications including `hello/`, `chat/`, `video/`, `threejs/`, `youtube/`, and others
- **`docs/`** - JSDoc source files for generating documentation
- **`packages/croquet/`** - The main client-side JavaScript library
- **`packages/reflector/`** - Self-hostable reflector server implementation
- **`server/croquet-in-a-box/`** - All-in-one Docker setup containing:
  - Reflector server
  - Web server
  - File server

## Croquet-in-a-Box

For local development and testing, Croquet-in-a-Box provides a complete local environment:

```bash
cd server/croquet-in-a-box
./croquet-in-a-box.sh
```

Then visit [http://localhost:8888/](http://localhost:8888/) to try the examples locally.

## Resources

- 📚 **Documentation**: [multisynq.io/docs/croquet](https://multisynq.io/docs/croquet)
- 🎮 **Examples**: [croquet.io/examples](https://croquet.io/examples)
- 🌐 **Website**: [croquet.io](https://croquet.io)
- 💬 **Community**: [Discord](https://discord.gg/croquet)

## Contributing

We welcome contributions! Please see our [contribution guidelines](CONTRIBUTING.md) for more information.

---

Built with ❤️ by the Croquet team
