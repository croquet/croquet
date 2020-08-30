import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import cleanup from 'rollup-plugin-cleanup';

export default {
    input: 'math.js',
    output: {
        file: 'math-dist.js',
    },
    plugins: [
        resolve(),
        commonjs(),
        cleanup(),
    ]
};
