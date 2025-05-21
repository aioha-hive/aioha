const path = require('path')
const { DefinePlugin, ProvidePlugin } = require('webpack')
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')

module.exports = {
  entry: './src/index.ts',
  output: {
    library: {
      type: 'module'
    },
    filename: 'bundle.js',
    chunkFilename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist')
  },
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    fallback: {
      url: false,
      buffer: require.resolve('buffer/')
    },
    extensions: ['.js', '.ts'],
    extensionAlias: {
      '.js': ['.js', '.ts'],
      '.cjs': ['.cjs', '.cts'],
      '.mjs': ['.mjs', '.mts']
    }
  },
  plugins: [
    new DefinePlugin({
      'process.env.NODE_DEBUG': false
    }),
    new ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    }),
    new BundleAnalyzerPlugin({
      generateStatsFile: true,
      analyzerMode: 'static',
      reportFilename: path.resolve(__dirname, 'bundle-analyzer/report.html'),
      statsFilename: path.resolve(__dirname, 'bundle-analyzer/stats.json'),
      openAnalyzer: false
    })
  ],
  optimization: {
    splitChunks: {
      name: (module, chunks, cacheGroupKey) => {
        const allChunksNames = chunks.map((chunk) => chunk.name).join('-')
        return allChunksNames
      }
    }
  },
  experiments: {
    outputModule: true
  }
}
