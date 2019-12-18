import resolve from 'rollup-plugin-node-resolve';
import license from 'rollup-plugin-license';
import babel from 'rollup-plugin-babel';
import { terser } from 'rollup-plugin-terser';
import replace from 'rollup-plugin-replace';
require('dotenv-flow').config({
    default_node_env: 'development'
});

export default {
    input: 'src.js',
    output: {
        file: 'dist/croquet.min.js',
        format: 'umd',      // amd, cjs and iife all in one
        name: 'Croquet',    // global name
        sourcemap: true,    // not included in npm bundle by explicit "files" section in package.json
    },
    external: ['seedrandom/seedrandom', 'toastify-js', 'seedrandom', 'fast-json-stable-stringify', 'fastpriorityqueue'],
    plugins: [
        // TODO: we might need something more elaborate once simple string replacement doesn't cut it anymore,
        // see https://github.com/rollup/rollup/issues/487#issuecomment-486229172
        replace({
            'process.env.CROQUET_VERSION': JSON.stringify(process.env.CROQUET_VERSION)
        }),
        resolve({only: [/^@croquet/]}),
        babel({
            externalHelpers: false, runtimeHelpers: true,
            presets: [['@babel/env', { "targets": "> 0.25%" }]],
            plugins: ['@babel/transform-runtime']
        }),
        terser({
            mangle: {module: true},
        }),
        license({
            banner: `Copyright Croquet Studio <%= moment().format('YYYY') %>
Bundle of <%= pkg.name %>
Generated: <%= moment().format('YYYY-MM-DD') %>
Version: <%= process.env.CROQUET_VERSION %>`,
        })
    ]
};
