# Building Croquet Docs

The doc generator and theme are in the `croquet-docs` repo: https://github.com/croquet/croquet-docs/

It expects `croquet` to be checked out next to `croquet-docs`.

    ├── croquet
    │   └── docs        (this directory)
    │
    └── croquet-docs
        └── croquet

If that's in place, you can build the croquet docs using `npm run build` or `npm run watch` in the `croquet-docs/croquet` directory.

The doc generator uses [JSDoc](https://jsdoc.app) to build the class documentation from structured comments in the source code (see `packages/croquet/teatime/src`, in particular `index.js`, `model.js`, `view.js`, `session.js`), as well as tutorials from markdown files in this directory.

The docs are deployed at https://croquet.io/docs/croquet and https://multisynq.io/docs/croquet.
