import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import license from 'rollup-plugin-license';
import { terser } from 'rollup-plugin-terser';
import MagicString from 'magic-string';
import moment from 'moment';
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
            // Only inject in our own teatime modules
            // Tree-shaking will make sure the import is removed from most modules later.
            if (id.includes("/teatime/")) {
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
const git_commit = execSync("git rev-parse HEAD").toString().trim();                          // last commit hash
const git_message = execSync("git show --format='%s' -s " + git_commit).toString().trim();    // last commit message
const git_pushed = execSync("git branch -r --contains " + git_commit).toString().trim();      // last commit was pushed
const git_bumped = git_message.endsWith(pkg.version);                                         // last commit was bump
const git_clean = !execSync("git status --porcelain -- " + deps.join(" ")).toString().trim(); // all deps are committed

const public_build = !is_dev_build && !pkg.version.includes('-');
const prerelease = !is_dev_build && git_branch === "main" && git_bumped && git_clean;

if (public_build && (git_branch !== "main" || !git_clean)) throw Error(`Public build ${pkg.version} but ${git_clean ? "git is not clean" : "not on main branch"}`);

// semantic versioning x.y.z-pre.release+meta.data https://semver.org/
process.env.CROQUET_VERSION = public_build || prerelease ? pkg.version
    :  git_clean && (git_pushed || git_bumped) ? `${pkg.version}+${git_branch}.${git_commit}`
    : `${pkg.version}+${git_branch}.${git_commit}.${os.userInfo().username}.${moment().toISOString(true)}`;

console.log(`Building Croquet SDK ${process.env.CROQUET_VERSION}`);

const config = {
    input: 'croquet.js',
    output: {
        file: 'pub/croquet-croquet.js',
        format: 'cjs',
        sourcemap: is_dev_build,    // not included in npm bundle by explicit "files" section in package.json
    },
    external: [ 'crypto' ], // suppress warning for modules that require("crypto")
    plugins: [
        resolve(),
        commonjs(),
        inject_process(), // must be after commonjs, otherwise commonjs gets confused by the added "import" statement
        !is_dev_build && babel({
            babelHelpers: 'bundled',
            presets: [['@babel/env', { "targets": "> 0.25%" }]],
        }),
        !is_dev_build && terser({
            mangle: {module: true},
        }),
        license({
            banner: `@license UNLICENSED
Copyright Croquet Corporation <%= moment().format('YYYY') %>
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
