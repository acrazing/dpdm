/*!
 * Copyright 2020 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2020-05-25 10:39:25
 */

import webpack from 'webpack';

export default {
  mode: 'production',
  entry: {
    dpdm: './src/index.ts',
  },
  output: {
    path: process.cwd() + '/dist',
    library: 'dpdm',
    libraryTarget: 'commonjs',
  },
  target: 'node',
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.node'],
  },
  externals: Object.keys(require('../package.json').dependencies),
  optimization: {
    runtimeChunk: {
      name: 'runtime',
    },
  },
  module: {
    rules: [
      {
        oneOf: [
          {
            test: /\.tsx?$/,
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                module: 'esnext',
              },
            },
          },
        ],
      },
    ],
  },
} as webpack.Configuration;
