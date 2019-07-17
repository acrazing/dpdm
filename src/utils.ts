/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import { DependencyTree, ParseOptions } from './types';

export function normalizeOptions(options: Partial<ParseOptions>) {
  const newOptions = Object.assign(options, {
    context: process.cwd(),
    extensions: ['', '.js', '.jsx', '.ts', '.tsx', '.json'],
    include: /\.[tj]sx?$/,
    exclude: /\/node_modules\//,
  } as ParseOptions);
  if (newOptions.extensions.indexOf('') < 0) {
    newOptions.extensions.unshift('');
  }
  return newOptions;
}

export function resolve(
  request: string,
  context: string,
  options: ParseOptions,
) {}

export function parseCircular(tree: DependencyTree): string[][] {
  return [];
}

export function shortenTree(
  context: string,
  tree: DependencyTree,
): DependencyTree {
  return {};
}
