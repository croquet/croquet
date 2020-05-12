import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import sourcemaps from 'rollup-plugin-sourcemaps';


export default {
    input: 'data-test.js',
    output: {
        file: 'dist/data-test-bundled.js',
        format: 'iife', // immediately-invoked function expression — suitable for <script> tags
        globals: {
            "crypto": "null", // because the seedrandom module uses require('crypto') - FIXME
        },
        sourcemap: true
    },
    plugins: [
        resolve(), // tells Rollup how to resolve stuff in node_modules
        commonjs(), // converts all modules (including @croquet/croquet) to ES modules
        sourcemaps(), // use sourcemaps from source files
    ]
};
