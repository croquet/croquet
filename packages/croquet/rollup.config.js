import resolve from 'rollup-plugin-node-resolve';
import license from 'rollup-plugin-license';
import babel from 'rollup-plugin-babel';
import { terser } from 'rollup-plugin-terser';
import MagicString from 'magic-string';
require('dotenv-flow').config({
    default_node_env: 'development'
});


// costum rollup plugin to resolve "process.env" references
// it fakes a "process" module that exports "env" and imports that module everywhere
// https://github.com/rollup/rollup/issues/487#issuecomment-486229172
const INJECT_PROCESS_MODULE_ID = '\0inject-process';    // prefix \0 hides us from other plugins
function inject_process() {
    return {
        name: 'inject-process-plugin',
        resolveId(id) {
            if (id === INJECT_PROCESS_MODULE_ID) {
                return INJECT_PROCESS_MODULE_ID;
            }
        },
        load(id) {
            if (id === INJECT_PROCESS_MODULE_ID) {
                return `export const env = ${JSON.stringify(process.env)};\n`;
            }
        },
        transform(code, id) {
            // Each module (except ours) gets the process mock injected.
            // Tree-shaking will make sure the import is removed from most modules later.
            if (id !== INJECT_PROCESS_MODULE_ID) {
                const magicString = new MagicString(code);
                magicString.prepend(`import * as process from '${INJECT_PROCESS_MODULE_ID}';\n`);
                return { code: magicString.toString(), map: magicString.generateMap({ hires: true }) };
            }
        }
    }
};


export default {
    input: 'src.js',
    output: {
        file: 'dist/croquet.min.js',
        format: 'cjs',
        sourcemap: true,    // not included in npm bundle by explicit "files" section in package.json
    },
    external: ['seedrandom/seedrandom', 'toastify-js', 'seedrandom', 'fast-json-stable-stringify', 'fastpriorityqueue'],
    plugins: [
        inject_process(),
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
