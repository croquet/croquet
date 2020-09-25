import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import license from 'rollup-plugin-license';
import { terser } from 'rollup-plugin-terser';
import moment from 'moment';
require('dotenv-flow').config({
    default_node_env: 'development'
});

const is_dev_build = process.env.NODE_ENV !== "production";

const config = {
    input: 'sdk.js',
    output: {
        file: 'dist/croquet-dev-bundled.js',
        format: 'iife',
        name: 'Croquet',
        globals: { 'crypto' : 'crypto' },
        sourcemap: true,
    },
    external: ['crypto'],
    plugins: [
        resolve(),
        commonjs(),
        replace({
            "require.main": "undefined",     // patch FastPriorityQueue sillyness
        }),
        !is_dev_build && babel({
            babelHelpers: 'runtime',
            presets: [['@babel/env', { "targets": "> 0.25%" }]],
            plugins: ['@babel/transform-runtime']
        }),
        !is_dev_build && terser({
            mangle: {module: true},
        }),
        license({
            banner: `Copyright Croquet Corporation ${moment().format('YYYY')}
Generated: ${moment().format('YYYY-MM-DD')}
Version: ${process.env.CROQUET_VERSION}`,
        })
    ]
};

export default config;
