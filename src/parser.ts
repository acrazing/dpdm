/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import { DependencyTree, ParseOptions } from './types';

export async function parseDependencyTree(
  entries: string[] | string,
  options: Partial<ParseOptions>,
  output: DependencyTree = {},
): Promise<DependencyTree> {
  return output;
}
