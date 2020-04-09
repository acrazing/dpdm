/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:47
 */

import { dirname, join } from 'path';
import { simpleResolver } from './utils';

describe('util', () => {
  it('should resolve correctly', async () => {
    const ext = ['', '.js', '.jsx', '.ts', '.tsx', '.json'];
    const local = await simpleResolver(__dirname, './bin/dpdm', ext);
    const index = await simpleResolver(__dirname, '.', ext);
    // dependents on yarn.lock
    const pkg = await simpleResolver(__dirname, 'base', ext);
    const deepPkg = await simpleResolver(dirname(pkg!), 'define-property', ext);
    const notFound = await simpleResolver(__dirname, './utils.tsx', ext);
    expect([local, index, pkg, deepPkg, notFound]).toEqual([
      join(__dirname, 'bin/dpdm.ts'),
      join(__dirname, 'index.ts'),
      join(__dirname, '../node_modules/base/index.js'),
      join(
        __dirname,
        '../node_modules/base/node_modules/define-property/index.js',
      ),
      null,
    ]);
  });
});
