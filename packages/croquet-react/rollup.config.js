import resolve from 'rollup-plugin-node-resolve';
import license from 'rollup-plugin-license';
import babel from 'rollup-plugin-babel';

export default {
    input: 'index.js',
    output: {
        file: 'dist/croquet-react.min.js',
        format: 'cjs'
    },
    external: ['react', 'croquet', 'croquet-observable'],
    plugins: [
        resolve({only: [/^@croquet/]}),
        babel({
            presets: [['@babel/env', { "targets": "> 0.25%" }]],
        }),
        license({
            banner: `Copyright Croquet Studio <%= moment().format('YYYY') %>
Bundle of <%= pkg.name %>
Generated: <%= moment().format('YYYY-MM-DD') %>
Version: <%= pkg.version %>`,
        })
    ]
};
