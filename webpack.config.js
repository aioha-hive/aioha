const path = require('path')
const { DefinePlugin } = require('webpack')

module.exports = {
  entry: './src/index.ts',
  output: {
    library: {
      type: 'module'
    },
    filename: 'bundle.js',
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
      url: false
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
    })
  ],
  experiments: {
    outputModule: true
  }
}
