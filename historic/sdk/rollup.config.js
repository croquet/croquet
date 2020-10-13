import commonjs from '@rollup/plugin-commonjs';
import sourcemaps from 'rollup-plugin-sourcemaps';
import { terser } from 'rollup-plugin-terser';
import license from 'rollup-plugin-license';
import moment from 'moment';
require('dotenv-flow').config({
    default_node_env: 'development'
});
const Croquet = require('@croquet/croquet/package.json');
const is_dev_build = process.env.NODE_ENV !== "production";

const config = {
    input: `node_modules/@croquet/croquet/${Croquet.main}`,
    output: {
        file: 'dist/croquet-dev-bundled.js',
        format: 'iife',
        name: 'Croquet',
        sourcemap: true,
    },
    plugins: [
        commonjs(),
        sourcemaps(),
        !is_dev_build && terser({
            output: { comments: false },
        }),
        license({
            banner: `Copyright Croquet Corporation ${moment().format('YYYY')}
Generated: ${moment().format('YYYY-MM-DD')}
Version: ${Croquet.version}`,
        })
    ]
};

export default config;
