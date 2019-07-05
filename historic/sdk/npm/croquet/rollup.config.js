import resolve from 'rollup-plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import license from 'rollup-plugin-license';

export default {
    input: 'src.js',
    output: {
        file: 'dist/croquet.min.js',
        format: 'cjs'
    },
    external: ['seedrandom/seedrandom', 'toastify-js', 'seedrandom', 'fast-json-stable-stringify', 'fastpriorityqueue'],
    plugins: [
        resolve({only: [/^@croquet/]}),
        terser({
            output: {max_line_len: 600},
            compress: {conditionals: false} // otherwise this messes up ENV dependent require magic
        }),
        license({
            banner: `Copyright Croquet Studio <%= moment().format('YYYY') %>
Bundle of <%= pkg.name %>
Generated: <%= moment().format('YYYY-MM-DD') %>
Version: <%= pkg.version %>`,
        })
    ]
};
