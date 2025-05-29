# Croquet Documentation

This directory contains the source files for Croquet's comprehensive documentation.

## 📖 Live Documentation

The documentation is deployed and accessible at:
- **Primary**: [multisynq.io/docs/croquet](https://multisynq.io/docs/croquet)
- **Alternative**: [croquet.io/docs/croquet](https://croquet.io/docs/croquet)

## 🏗️ Building Documentation Locally

### Prerequisites

The documentation generator and theme are maintained in a separate repository: [croquet-docs](https://github.com/croquet/croquet-docs/).

### Setup

You need both repositories checked out as siblings:

```
your-workspace/
├── croquet/                # This repository
│   └── docs/              # This directory
└── croquet-docs/          # Documentation generator repo
    └── croquet/
```

### Building

Once the directory structure is in place:

```bash
cd croquet-docs/croquet
npm run build        # One-time build
npm run watch        # Continuous build with file watching
```

## 📝 Documentation Structure

The documentation system combines multiple sources:

### API Documentation
Generated from **JSDoc comments** in the source code:
- `packages/croquet/teatime/src/index.js`
- `packages/croquet/teatime/src/model.js`
- `packages/croquet/teatime/src/view.js`
- `packages/croquet/teatime/src/session.js`

### Tutorials
Written as **Markdown files** in this directory (`docs/`), covering:
- Getting started guides
- Step-by-step tutorials
- Advanced concepts
- Best practices

### Technology

The documentation is built using:
- **[JSDoc](https://jsdoc.app)** - API documentation generator
- **Custom theme** - Optimized for Croquet's needs
- **Markdown processing** - For tutorials and guides

## 🤝 Contributing to Documentation

When contributing to documentation:

1. **API docs**: Update JSDoc comments in the source code
2. **Tutorials**: Edit or add Markdown files in this directory
3. **Build and test**: Use the build process above to verify changes

---

For questions about documentation, please reach out through our [community channels](https://discord.gg/croquet).

