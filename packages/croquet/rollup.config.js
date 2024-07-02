import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import license from 'rollup-plugin-license';
import { terser } from 'rollup-plugin-terser';
import worker_loader from 'rollup-plugin-web-worker-loader';
import MagicString from 'magic-string';
import moment from 'moment';
import os from 'os';
import { execSync } from 'child_process';
const pkg = require("./package.json");
require('dotenv-flow').config({
    default_node_env: 'development'
});

const is_dev_build = process.env.NODE_ENV !== "production";
const is_node = process.env.CROQUET_PLATFORM === "node";

// custom rollup plugin to resolve "process.env" references
// it fakes a "process" module that exports "env" and imports that module everywhere
// https://github.com/rollup/rollup/issues/487#issuecomment-486229172
const CUSTOM_MODULE_ID = '\0croquet-custom';    // prefix \0 hides us from other plugins
function inject_process() {
    return {
        name: 'croquet-custom-plugin',
        resolveId(id) {
            // do not resolve our custom module via file lookup, we "load" it below
            if (id === CUSTOM_MODULE_ID) {
                return CUSTOM_MODULE_ID;
            }
            // in the browser, also pretend we have a "crypto" module which some node packages try to load
            if (!is_node && id === "crypto") return "crypto";
        },
        load(id) {
            // create source code of our custom module
            if (id === CUSTOM_MODULE_ID) {
                const exportEnv =`
// CROQUET_* env vars from build process
export const env = ${JSON.stringify(Object.keys(process.env).filter(key => key.match(/^CROQUET_/)).sort()
    .reduce((obj, key) => ({...obj, [key]: process.env[key]}), {}), null, 4)};
`;
                if (is_dev_build) return exportEnv;
                // only include regenerator in production builds
                const importRegenerator = `import "regenerator-runtime/runtime.js";\n`;
                return importRegenerator + exportEnv;
            }
            // in the browser, also generate an empty "crypto" module which some node packages try to load
            if (!is_node && id === "crypto") return "";
        },
        // patch other modules
        transform(code, id) {
            // Only inject in our own teatime modules
            // Tree-shaking will make sure the import is removed from most modules later.
            if (id.includes("/teatime/src/")) {
                const magicString = new MagicString(code);
                magicString.prepend(`import * as croquet_build_process from '${CUSTOM_MODULE_ID}';`);
                return { code: magicString.toString(), map: magicString.generateMap({ hires: true }) };
            }
        }
    };
}

function magic_replace(code, fixes) {
    const magicString = new MagicString(code);
    let changed = false;
    for (const { bad, good } of fixes) {
        const start = code.indexOf(bad);
        if (start !== -1) {
            magicString.overwrite(start, start + bad.length, good);
            changed = true;
        }
    }
    if (changed) return { code: magicString.toString(), map: magicString.generateMap({ hires: true }) };
}

// custom plugin to fix up generated code
function fixups() {
    // for Node.js, we don't want to do some of the replacements
    const replaceBlocker = is_node ? '$$' : '';
    return {
        name: 'fixup-plugin',
        renderChunk(code, chunk) {
            return magic_replace(code, [
                // re-instate a removed escape sequence which otherwise throws off parcel
                { bad: '"//# sourceMappingURL="', good: '"\\/\\/# sourceMappingURL="' },
                // avoid runtime error when assigning in strict mode
                { bad: 'regeneratorRuntime=', good: 'globalThis.regeneratorRuntime=' },
                // work around stupid check in FastPriorityQueue
                { bad: 'require.main', good: 'undefined' },
                // remove unused global require call in seedrandom
                { bad: replaceBlocker + 'require("crypto")', good: 'undefined'},
                { bad: replaceBlocker + "require('crypto')", good: 'undefined'},
            ]);
        }
    };
}

const deps = ["../../../teatime", "../../../math"];
const git_branch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
const git_commit = execSync("git rev-parse HEAD").toString().trim();                          // last commit hash
const git_message = execSync("git show --format='%s' -s " + git_commit).toString().trim();    // last commit message
const git_date = execSync("git show --format='%as' -s " + git_commit).toString().trim();      // last commit date
const git_pushed = !!execSync("git branch -r --contains " + git_commit).toString().trim();    // last commit was pushed
const git_bumped = git_message.endsWith(pkg.version);                                         // last commit was bump
const git_clean = !execSync("git status --porcelain -- " + deps.join(" ")).toString().trim(); // all deps are committed

const public_build = !is_dev_build && !pkg.version.includes('-');
const prerelease = !is_dev_build && (git_branch === "main" || git_branch === "depin") && git_bumped && git_clean;
const bundle_date = public_build || prerelease ? git_date : moment().toISOString(true);

if (public_build && (git_branch !== "main" || !git_clean)) throw Error(`Public build ${pkg.version} but ${!git_clean ? "git is not clean" : `not on main branch)`}`);

// semantic versioning x.y.z-pre.release+meta.data https://semver.org/
process.env.CROQUET_VERSION = public_build || prerelease ? pkg.version
    :  git_clean && (git_pushed || git_bumped) ? `${pkg.version}+${git_branch}.${git_commit}`
    : `${pkg.version}+${git_branch}.${git_commit}.${os.userInfo().username}.${bundle_date}`;

console.log(`Building Croquet ${process.env.CROQUET_VERSION}`);
console.log(`  prod: ${!is_dev_build}, pushed: ${git_pushed}, bumped: ${git_bumped}, clean: ${git_clean}`);

const browserOutputs = [
    // commonjs build for bundlers
    {
        file: 'cjs/croquet-croquet.js',
        format: 'cjs',
        sourcemap: true,    // not included in npm bundle by explicit "files" section in package.json
    },
    // bundled build for direct inclusion in script tag, e.g. via jsdelivr
    {
        file: 'pub/croquet.min.js',
        format: 'iife',
        name: 'Croquet',
        sourcemap: true,    // not included in npm bundle by explicit "files" section in package.json
    }
    ];

const nodeOutputs = [
    {
        file: 'cjs/croquet-croquet-node.js',
        format: 'cjs',
        sourcemap: true,    // not included in npm bundle by explicit "files" section in package.json
    },
    ];

const node_webrtc_import = `
    if (!globalThis.loadingDataChannel) {
        globalThis.loadingDataChannel = new Promise(resolve => {
            import('node-datachannel/polyfill')
            .then(polyfill => {
                globalThis.RTCPeerConnection = polyfill.RTCPeerConnection;
                return import('node-datachannel');
            }).then(ndc => {
                ndc.initLogger('Warning'); // 'Verbose' | 'Debug' | 'Info' | 'Warning' | 'Error' | 'Fatal';
                ndc.preload();
                resolve();
            });
        });
    }
    await globalThis.loadingDataChannel;
`;

const config = () => ({
    inlineDynamicImports: true,
    input: 'croquet.js',
    output: is_node ? nodeOutputs : browserOutputs,
    external: is_node ? ['node:fs', 'node:http', 'node:https', 'node:path', 'node:stream', 'node:url', 'node:util', 'node:worker_threads', 'node:zlib', 'node-datachannel', 'node-datachannel/polyfill'] : [],
    plugins: [
        replace({
            preventAssignment: true,
            '_IS_NODE_': is_node.toString(),
            '_ENSURE_WEBSOCKET_': (is_node ? `\nimport * as _WS from 'ws';\nglobalThis.WebSocket = _WS.WebSocket;\n` : ''),
            '_ENSURE_FETCH_': (is_node ? `\nimport fetch from 'node-fetch';\n` : ''),
            '_ENSURE_RTCPEERCONNECTION_': (is_node ? node_webrtc_import : ''),
            '_HTML_MODULE_': (is_node ? 'node-html' : 'html'),
            '_URLOPTIONS_MODULE_': (is_node ? 'node-urlOptions' : 'urlOptions'),
            '_STATS_MODULE_': (is_node ? 'node-stats' : 'stats'),
            '_MESSENGER_MODULE_': (is_node ? 'node-messenger' : 'messenger')
        }),
        resolve({
            browser: !is_node,
            exportConditions: is_node ? ['node'] : [],
            preferBuiltins: is_node
        }),
        commonjs(),
        worker_loader({
            targetPlatform: (is_node ? "node" : "browser"),
            sourcemap: is_dev_build,
        }),
        inject_process(is_node), // must be after commonjs and worker_loader
        !is_node && !is_dev_build && babel({
            babelHelpers: 'bundled',
            presets: [['@babel/env', { "targets": "defaults and supports es6-module" }]],
        }),
        !is_dev_build && terser({
            output: {comments: false},
        }),
        fixups(is_node), // must be after terser
        license({
            banner:
`Copyright Croquet Corporation ${git_date.slice(0, 4)}
Bundle of ${pkg.name}
Date: ${bundle_date.slice(0, 10)}
Version: ${process.env.CROQUET_VERSION}`,
        })
    ]
});

export default config;
