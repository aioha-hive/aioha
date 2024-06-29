const path = require('path')
const { DefinePlugin, ProvidePlugin } = require('webpack')

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
