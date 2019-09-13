import resolve from 'rollup-plugin-node-resolve';
import license from 'rollup-plugin-license';
import babel from 'rollup-plugin-babel';
import { terser } from 'rollup-plugin-terser';

export default {
    input: 'src.js',
    output: {
        file: 'dist/croquet.min.js',
        format: 'cjs',
        sourcemap: true,    // not included in npm bundle by explicit "files" section in package.json
    },
    external: ['seedrandom/seedrandom', 'toastify-js', 'seedrandom', 'fast-json-stable-stringify', 'fastpriorityqueue'],
    plugins: [
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
Version: <%= pkg.version %>`,
        })
    ]
};
