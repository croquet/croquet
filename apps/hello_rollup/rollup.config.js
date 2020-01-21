import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';


export default {
    input: 'hello.js',
    output: {
        file: 'dist/hello_bundle.js',
        format: 'iife', // immediately-invoked function expression — suitable for <script> tags
        globals: {
            "crypto": "null", // because the seedrandom module uses require('crypto') - FIXME
        },
        sourcemap: true
    },
    plugins: [
        resolve(), // tells Rollup how to resolve stuff in node_modules
        commonjs(), // converts all modules (including @croquet/croquet) to ES modules
    ]
};
