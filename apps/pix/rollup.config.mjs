import { cleandir } from 'rollup-plugin-cleandir';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import css from 'rollup-plugin-import-css';
import html from '@rollup/plugin-html';

export default {
    input: 'pix.js',
    output: {
        dir: 'dist',
        entryFileNames: '[name]-[hash].js',
        format: 'iife',
        sourcemap: true,
    },
    plugins: [
        cleandir('dist'),
        resolve({browser:true}), // tells Rollup how to resolve stuff in node_modules
        commonjs(), // converts all modules to ES modules
        terser(),
        css(),
        html({
            title: 'Croquet Pix',
            meta: [
                { charset: 'utf-8' },
                { name: 'viewport', content: 'width=device-width, initial-scale=1' },
            ],
        }),
    ],
};
