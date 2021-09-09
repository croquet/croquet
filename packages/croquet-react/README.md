# Croquet React Bindings

The `@croquet/react` package provides a simple framework for using Croquet together with React. The main principle of `@croquet/react` is that React components fully assume the role of the View side of Croquet. (Behind the scenes, a normal Croquet View is still created to act as a slim contact point between the Croquet Model and the React components, but all View side logic is implemented in the React components.)

React components interact with Croquet using **hooks** for accessing the features the Croquet Library offers, such as subscribing to model events or publishing events among models and other views. These tutorials assume that you are familiar with the "functional-component + hooks" style of writing React apps. If you aren't, [the official React tutorial on hooks](https://reactjs.org/docs/hooks-intro.html) is a good starting point.

You can start by taking the tutorials of simple application examples in the "TUTORIALS" section in the navigation bar. The [documentation](./global.html) contains minimal usage examples, which will also be displayed in IDE's such as VS Code with full TypeScript declarations.  The type annotations for `publish` and `subscribe` help to ensure the data sent and received conforms to the same type, for instance.

Please also refer to croquet.io/docs for more information.
