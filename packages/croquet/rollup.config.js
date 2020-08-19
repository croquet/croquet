import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import license from 'rollup-plugin-license';
import { terser } from 'rollup-plugin-terser';
import MagicString from 'magic-string';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
const pkg = require("./package.json");
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

const is_dev_build = process.env.NODE_ENV !== "production";

const deps = ["../../../teatime",  "../../../util", "../../../math"];
const git_branch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
const git_commit = execSync("git rev-parse HEAD").toString().trim();
const git_pushed = execSync("git branch -r --contains " + git_commit).toString().trim();
const git_dirty = !git_pushed || execSync("git status --porcelain -- " + deps.join(" ")).toString().trim();

const is_pre_release = is_dev_build || pkg.version.includes('-') || git_branch !== "main" || git_dirty;

process.env.CROQUET_VERSION = !is_pre_release ? pkg.version
    : !git_dirty ? `${pkg.version}:${git_branch}:${git_commit}`
    : `${pkg.version}:${git_branch}:${git_commit}:${os.userInfo().username}:${new Date().toISOString()}`;

const config = {
    input: 'croquet.js',
    output: {
        file: 'dist/croquet.min.js',
        format: 'cjs',
        sourcemap: is_dev_build,    // not included in npm bundle by explicit "files" section in package.json
    },
    external: ['seedrandom/seedrandom', 'toastify-js', 'seedrandom', 'fast-json-stable-stringify', 'fastpriorityqueue'],
    plugins: [
        inject_process(),
        resolve({resolveOnly: [/^@croquet/]}),
        !is_dev_build && babel({
            babelHelpers: 'runtime',
            presets: [['@babel/env', { "targets": "> 0.25%" }]],
            plugins: ['@babel/transform-runtime']
        }),
        !is_dev_build && terser({
            mangle: {module: true},
        }),
        license({
            banner: `Copyright Croquet Corporation <%= moment().format('YYYY') %>
Bundle of <%= pkg.name %>
Generated: <%= moment().format('YYYY-MM-DD') %>
Version: <%= process.env.CROQUET_VERSION %>`,
        })
    ]
};

// clean up source map from dev build, if any
if (!is_dev_build) fs.unlink(`${config.output.file}.map`, () => { /* ignore error */});

// generate .env
fs.writeFile('.env', `CROQUET_VERSION="${process.env.CROQUET_VERSION}"\n`, err => { if (err) throw err; });

export default config;
