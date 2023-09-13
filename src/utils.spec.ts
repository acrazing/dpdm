/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:47
 */

import fs from 'fs-extra';
import { dirname, join } from 'path';
import { simpleResolver } from './utils';

describe('util', () => {
  it('should resolve correctly', async () => {
    const ext = ['', '.js', '.jsx', '.ts', '.tsx', '.json'];
    const local = await simpleResolver(__dirname, './bin/dpdm', ext);
    const index = await simpleResolver(__dirname, '.', ext);

    await fs.outputJSON('node_modules/dpdm-ut-parent/package.json', {
      name: 'dpdm-ut-parent',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        'dpdm-ut-deep': '^1.0.0',
      },
    });
    await fs.outputFile('node_modules/dpdm-ut-parent/index.js', '');

    await fs.outputJSON(
      'node_modules/dpdm-ut-parent/node_modules/dpdm-ut-deep/package.json',
      {
        name: 'dpdm-ut-deep',
        version: '1.0.0',
        main: 'index.js',
      },
    );
    await fs.outputFile(
      'node_modules/dpdm-ut-parent/node_modules/dpdm-ut-deep/index.js',
      '',
    );

    await fs.outputJSON('node_modules/dpdm-ut-deep/package.json', {
      name: 'dpdm-ut-deep',
      version: '2.0.0',
      main: 'index.js',
    });
    await fs.outputFile('node_modules/dpdm-ut-deep/index.js', '');

    const pkg = await simpleResolver(__dirname, 'dpdm-ut-parent', ext);
    const deepPkg = await simpleResolver(dirname(pkg!), 'dpdm-ut-deep', ext);
    const notFound = await simpleResolver(__dirname, './utils.tsx', ext);
    expect([local, index, pkg, deepPkg, notFound]).toEqual([
      join(__dirname, 'bin/dpdm.ts'),
      join(__dirname, 'index.ts'),
      join(__dirname, '../node_modules/dpdm-ut-parent/index.js'),
      join(
        __dirname,
        '../node_modules/dpdm-ut-parent/node_modules/dpdm-ut-deep/index.js',
      ),
      null,
    ]);
  });
});
