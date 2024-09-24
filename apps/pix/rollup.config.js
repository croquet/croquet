import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import license from 'rollup-plugin-license';
import sourcemaps from 'rollup-plugin-sourcemaps';
import styles from "rollup-plugin-styles";
import { terser } from 'rollup-plugin-terser';

const is_dev_build = process.env.BUILD !== 'production';

export default {
    input: 'pix.js',
    output: {
        file: 'dist/pix-bundled.js',
        format: 'iife', // immediately-invoked function expression — suitable for <script> tags
        globals: {
            "@croquet/croquet": "Croquet", // use Croquet from global variable
        },
        sourcemap: is_dev_build
    },
    external: ['@croquet/croquet'], // do not bundle Croquet
    plugins: [
        resolve({browser:true}), // tells Rollup how to resolve stuff in node_modules
        commonjs(), // converts all modules to ES modules
        styles(),
        sourcemaps(), // use sourcemaps from source files
        !is_dev_build && terser({
            mangle: {module: true},
        }),
        license({
            banner: `Copyright Croquet Corporation <%= (new Date).getFullYear() %>`
        })
    ],
};
