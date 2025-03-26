const HtmlWebPackPlugin = require('html-webpack-plugin');

var path = require('path');

module.exports = {
    entry : './rapier2d.js',
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
            template: 'rapier2d.html',   // input
            filename: 'index.html',         // output filename in dist/
        }),
    ]
};
