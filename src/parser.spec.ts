/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2026-05-09 14:35:00
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { DependencyKind } from './consts';
import { parseDependencyTree } from './parser';

describe('parser', () => {
  let fixture: string;

  beforeEach(async () => {
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dpdm-parser-'));
  });

  afterEach(async () => {
    await fs.remove(fixture);
  });

  it('should parse relative entries from a custom cwd', async () => {
    await fs.outputFile(
      path.join(fixture, 'src/index.ts'),
      "import { value } from './dep';\nconsole.log(value);\n",
    );
    await fs.outputFile(
      path.join(fixture, 'src/dep.ts'),
      'export const value = 1;\n',
    );

    const tree = await parseDependencyTree('src/index.ts', { cwd: fixture });

    expect(tree).toEqual({
      'src/index.ts': [
        {
          issuer: 'src/index.ts',
          request: './dep',
          kind: DependencyKind.StaticImport,
          id: 'src/dep.ts',
        },
      ],
      'src/dep.ts': [],
    });
  });

  it('should parse an absolute entry file path', async () => {
    await fs.outputFile(
      path.join(fixture, 'src/index.ts'),
      "import { value } from './dep';\nconsole.log(value);\n",
    );
    await fs.outputFile(
      path.join(fixture, 'src/dep.ts'),
      'export const value = 1;\n',
    );

    const tree = await parseDependencyTree(path.join(fixture, 'src/index.ts'), {
      context: fixture,
    });

    expect(tree).toEqual({
      'src/index.ts': [
        {
          issuer: 'src/index.ts',
          request: './dep',
          kind: DependencyKind.StaticImport,
          id: 'src/dep.ts',
        },
      ],
      'src/dep.ts': [],
    });
  });

  it('should resolve aliases from an absolute tsconfig path', async () => {
    await fs.outputJSON(path.join(fixture, 'tsconfig.json'), {
      compilerOptions: {
        paths: {
          '~/*': ['./src/*'],
        },
      },
    });
    await fs.outputFile(
      path.join(fixture, 'src/index.ts'),
      "import { value } from '~/dep';\nconsole.log(value);\n",
    );
    await fs.outputFile(
      path.join(fixture, 'src/dep.ts'),
      'export const value = 1;\n',
    );

    const tree = await parseDependencyTree(path.join(fixture, 'src/index.ts'), {
      context: fixture,
      tsconfig: path.join(fixture, 'tsconfig.json'),
    });

    expect(tree['src/index.ts']).toEqual([
      {
        issuer: 'src/index.ts',
        request: '~/dep',
        kind: DependencyKind.StaticImport,
        id: 'src/dep.ts',
      },
    ]);
  });
});
