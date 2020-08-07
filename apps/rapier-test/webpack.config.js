const HtmlWebPackPlugin = require('html-webpack-plugin');

var path = require('path');

module.exports = {
    entry : './rapier-test.js',
    output: {
        path: path.join(__dirname, 'dist'),
        filename: 'index.js'
    },
    devServer: {
        contentBase: path.join(__dirname, 'dist'),
        port: 1234
    },
    plugins: [
        new HtmlWebPackPlugin({
            template: 'rapier-test.html',   // input
            filename: 'index.html'          // output filename in dist/
        }),
    ]
};
