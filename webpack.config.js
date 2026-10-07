const CopyWebpackPlugin = require('copy-webpack-plugin');
const defaultsDeep = require('lodash.defaultsdeep');
const path = require('path');

const base = {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devServer: {
        contentBase: false,
        host: '0.0.0.0',
        port: process.env.PORT || 8073
    },
    devtool: 'cheap-module-source-map',
    output: {
        library: 'VirtualMachine',
        filename: '[name].js'
    },
    resolve: {
        alias: {
            // @turbowarp/scratch-svg-renderer's font-inliner.js does a plain
            // require('scratch-render-fonts') and needs the woff2 fonts that ship with
            // scratch-gui. Point at that copy so no vendored local-deps/ is needed.
            'scratch-render-fonts': path.resolve(__dirname, '../scratch-gui/src/lib/tw-scratch-render-fonts')
        }
    },
    module: {
        rules: [{
            test: /\.js$/,
            loader: 'babel-loader',
            include: path.resolve(__dirname, 'src'),
            query: {
                presets: [['@babel/preset-env']]
            }
        },
        {
            test: /\.mp3$/,
            loader: 'file-loader',
            options: {
                outputPath: 'media/music/'
            }
        },
        {
            // tw-scratch-render-fonts requires the woff2 files directly.
            test: /\.woff2$/,
            loader: 'url-loader'
        }]
    },
    plugins: []
};

module.exports = [
    // Web-compatible
    defaultsDeep({}, base, {
        target: 'web',
        entry: {
            'scratch-vm': './src/index.js',
            'scratch-vm.min': './src/index.js'
        },
        output: {
            libraryTarget: 'umd',
            path: path.resolve('dist', 'web')
        },
        module: {
            rules: base.module.rules.concat([
                {
                    test: require.resolve('./src/index.js'),
                    loader: 'expose-loader?VirtualMachine'
                }
            ])
        }
    }),
    // Node-compatible
    defaultsDeep({}, base, {
        target: 'node',
        entry: {
            'scratch-vm': './src/index.js'
        },
        output: {
            libraryTarget: 'commonjs2',
            path: path.resolve('dist', 'node')
        },
        externals: {
            'decode-html': true,
            'format-message': true,
            'htmlparser2': true,
            'scratch-parser': true,
            'socket.io-client': true,
            'text-encoding': true
        }
    }),
    // Playground
    defaultsDeep({}, base, {
        target: 'web',
        entry: {
            'benchmark': './src/playground/benchmark',
            'video-sensing-extension-debug': './src/extensions/scratch3_video_sensing/debug'
        },
        output: {
            path: path.resolve(__dirname, 'playground'),
            filename: '[name].js'
        },
        module: {
            rules: base.module.rules.concat([
                {
                    test: require.resolve('./src/index.js'),
                    loader: 'expose-loader?VirtualMachine'
                },
                {
                    test: require.resolve('./src/extensions/scratch3_video_sensing/debug.js'),
                    loader: 'expose-loader?Scratch3VideoSensingDebug'
                },
                {
                    test: require.resolve('stats.js/build/stats.min.js'),
                    loader: 'script-loader'
                },
                {
                    // Use the shim entry rather than dist/vertical.js: dist is a build artifact
                    // (gitignored in scratch-blocks) and is not present after a fresh clone, which
                    // broke this build. shim/vertical.js is the same entry scratch-gui aliases to
                    // and resolves through the committed shim/ chain.
                    test: require.resolve('scratch-blocks/shim/vertical.js'),
                    loader: 'expose-loader?Blockly'
                },
                {
                    test: require.resolve('scratch-audio/src/index.js'),
                    loader: 'expose-loader?AudioEngine'
                },
                {
                    test: require.resolve('scratch-storage/src/index.js'),
                    loader: 'expose-loader?ScratchStorage'
                },
                {
                    test: require.resolve('scratch-render/src/index.js'),
                    loader: 'expose-loader?ScratchRender'
                }
            ])
        },
        performance: {
            hints: false
        },
        plugins: base.plugins.concat([
            new CopyWebpackPlugin([{
                from: 'node_modules/scratch-blocks/media',
                to: 'media'
            }, {
                from: 'node_modules/scratch-storage/dist/web'
            }, {
                from: 'node_modules/scratch-render/dist/web'
            }, {
                from: 'node_modules/@turbowarp/scratch-svg-renderer/dist/web'
            }, {
                from: 'src/playground'
            }])
        ])
    })
];
