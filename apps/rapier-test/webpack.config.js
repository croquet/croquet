const HtmlWebPackPlugin = require('html-webpack-plugin');

var path = require('path');

module.exports = {
    entry : './rapier-test.js',
    output: {
        path: path.join(__dirname, 'dist'),
        filename: 'index.js',
        clean: true,
    },
    experiments: {
        asyncWebAssembly: true,
    },
    resolve: {
        fallback: { "crypto": false }
    },
    devServer: {
        port: 3333,
    },
    plugins: [
        new HtmlWebPackPlugin({
            template: 'rapier-test.html',   // input
            filename: 'index.html',         // output filename in dist/
        }),
    ]
};
