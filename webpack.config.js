const path = require('path');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

const configFile = path.resolve(__dirname, "tsconfig.browser.json")

const devConfig = {
    context: __dirname,
    devtool: 'inline-source-map',
    entry: { index: './src/index.ts' },
    mode: 'development',
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: [{
                    loader: 'ts-loader',
                    options: { configFile },
                }],
                exclude: /node_modules/,
            },
        ],
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'umd',
        library: 'ts-promise-scheduler',
        umdNamedDefine: true
    },
    resolve: {
        plugins: [
            new TsconfigPathsPlugin({ configFile }),
        ],
        extensions: ['.tsx', '.ts', '.jsx', '.js']
    },
};


const prodConfig = {
    ...devConfig,
    optimization: {
        minimize: true,
    },
    output: {
        filename: '[name].min.js',
    },
};

module.exports = (env) => {
    switch (env) {
        case 'production':
            return [devConfig, prodConfig];
        default:
            return devConfig;
    }
};
