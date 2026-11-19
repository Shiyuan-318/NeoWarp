const path = require('path');
const {DefinePlugin, ProvidePlugin} = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const base = {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: process.env.NODE_ENV === 'production' ? false : 'cheap-source-map',
    target: 'web',
    resolve: {
        fallback: {
            // webpack4 会自动 polyfill node 核心模块，webpack5 需要显式声明；
            // scratch-parser 内嵌的 ajv6 在编译 schema 时会调用 url.parse/resolve，
            // 不能用空模块（会报 o.parse is not a function），必须给真实垫片
            url: require.resolve('url/')
        }
    },
    module: {
        rules: [
            {
                test: /\.jsx?$/,
                type: 'javascript/auto',
                loader: 'babel-loader',
                options: {
                    presets: ['@babel/preset-env', '@babel/preset-react']
                }
            },
            {
                // 注意：保持 file-loader 而非 webpack5 asset modules。
                // scratch-gui 有 120+ 处内联 loader 导入（tw-recolor、url-loader、
                // raw-loader、base64-loader、arraybuffer-loader 等），webpack5 的
                // 内联 loader 只屏蔽规则中的 loader，不屏蔽规则的 type —— 若这里
                // 用 asset/resource，这些导入会拿到资源 URL 而非 JS 模块导出，
                // 导致 tw-recolor 图标调用崩溃、addons 图标/样式失效。
                test: /\.(svg|png|wav|gif|jpg|mp3|woff2|hex)$/,
                loader: 'file-loader',
                options: {
                    outputPath: 'static/assets/',
                    esModule: false
                }
            },
            {
                test: /\.css$/,
                use: [
                    {
                        loader: 'style-loader'
                    },
                    {
                        loader: 'css-loader',
                        options: {
                            importLoaders: 1,
                            modules: {
                                mode: 'local',
                                localIdentName: '[name]_[local]_[hash:base64:5]',
                                exportLocalsConvention: 'camelCase',
                                // css-loader v7 默认 namedExport:true（只导出具名导出），
                                // 而 scratch-gui 全部使用默认导入，需显式关闭
                                namedExport: false
                            }
                        }
                    },
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: [
                                    require('postcss-import'),
                                    require('postcss-simple-vars'),
                                    require('autoprefixer')
                                ]
                            }
                        }
                    }
                ]
            }
        ]
    }
}

module.exports = [
    {
        ...base,
        output: {
            path: path.resolve(__dirname, 'dist-renderer-webpack/editor/gui'),
            filename: 'index.js'
        },
        entry: './src-renderer-webpack/editor/gui/index.jsx',
        externals: {
            electron: 'commonjs2 electron'
        },
        plugins: [
            // webpack4 会自动为裸 process/Buffer 注入浏览器垫片，webpack5 需要显式提供
            new ProvidePlugin({
                process: 'process/browser',
                Buffer: ['buffer', 'Buffer']
            }),
            new DefinePlugin({
                'process.env.ROOT': '""'
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: 'node_modules/scratch-blocks/media',
                        to: 'static/blocks-media/default'
                    },
                    {
                        from: 'node_modules/scratch-blocks/media',
                        to: 'static/blocks-media/high-contrast'
                    },
                    {
                        from: 'node_modules/scratch-gui/src/lib/themes/blocks/high-contrast-media/blocks-media',
                        to: 'static/blocks-media/high-contrast',
                        force: true
                    },
                    {
                        context: 'src-renderer-webpack/editor/gui/',
                        from: '*.html'
                    }
                ]
            })
        ],
        resolve: {
            fallback: {
                url: require.resolve('url/')
            },
            alias: {
                'scratch-gui$': path.resolve(__dirname, 'node_modules/scratch-gui/src/index.js'),
                'scratch-render-fonts$': path.resolve(__dirname, 'node_modules/scratch-gui/src/lib/tw-scratch-render-fonts'),
                // Fix: override menuHeightAdjustment from 88 to 44 for proper fullscreen stage sizing
                'scratch-gui/src/lib/screen-utils': path.resolve(__dirname, 'src-renderer-webpack/editor/lib/screen-utils.js'),
            }
        }
    },

    {
        ...base,
        output: {
            path: path.resolve(__dirname, 'dist-renderer-webpack/editor/addons'),
            filename: 'index.js'
        },
        entry: './src-renderer-webpack/editor/addons/index.jsx',
        plugins: [
            new ProvidePlugin({
                process: 'process/browser',
                Buffer: ['buffer', 'Buffer']
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        context: 'src-renderer-webpack/editor/addons/',
                        from: '*.html'
                    }
                ]
            })
        ]
    }
];
