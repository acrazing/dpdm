/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2026-05-09 14:35:00
 */

import path from 'path';
import { DependencyKind } from './consts';
import { parseDependencyTree } from './parser';
import {
  groupDependencyTreeByPackage,
  groupEntriesByPackage,
  parseCircular,
} from './utils';

describe('parser', () => {
  const fixture = path.join(__dirname, '../fixtures/parser/monorepo');

  it('should parse relative entries from a custom cwd', async () => {
    const tree = await parseDependencyTree('packages/shared/src/index.ts', {
      cwd: fixture,
    });

    expect(tree).toEqual({
      'packages/shared/src/index.ts': [
        {
          issuer: 'packages/shared/src/index.ts',
          request: './dep',
          kind: DependencyKind.StaticExport,
          id: 'packages/shared/src/dep.ts',
        },
      ],
      'packages/shared/src/dep.ts': [],
    });
  });

  it('should parse an absolute entry file path', async () => {
    const tree = await parseDependencyTree(
      path.join(fixture, 'packages/shared/src/index.ts'),
      {
        context: fixture,
      },
    );

    expect(tree).toEqual({
      'packages/shared/src/index.ts': [
        {
          issuer: 'packages/shared/src/index.ts',
          request: './dep',
          kind: DependencyKind.StaticExport,
          id: 'packages/shared/src/dep.ts',
        },
      ],
      'packages/shared/src/dep.ts': [],
    });
  });

  it('should resolve aliases from an absolute tsconfig path', async () => {
    const tree = await parseDependencyTree(
      path.join(fixture, 'packages/alias-user/src/index.ts'),
      {
        context: fixture,
        tsconfig: path.join(fixture, 'tsconfig.json'),
      },
    );

    expect(tree['packages/alias-user/src/index.ts']).toEqual([
      {
        issuer: 'packages/alias-user/src/index.ts',
        request: '~/dep',
        kind: DependencyKind.StaticImport,
        id: 'packages/shared/src/dep.ts',
      },
    ]);
  });

  it('should group dependencies and circulars by package', async () => {
    const tree = await parseDependencyTree(
      ['packages/app/src/index.ts', 'packages/ui/src/index.ts'],
      { cwd: fixture },
    );
    const packageTree = groupDependencyTreeByPackage(tree, fixture);

    expect(
      groupEntriesByPackage(
        [
          'packages/app/src/index.ts',
          'packages/ui/src/index.ts',
          'packages/app/src/local.ts',
        ],
        fixture,
      ),
    ).toEqual(['@repo/app', '@repo/ui']);
    expect(packageTree).toEqual({
      '@repo/app': [
        {
          issuer: '@repo/app',
          request: '../../shared/src',
          kind: DependencyKind.StaticImport,
          id: '@repo/shared',
        },
        {
          issuer: '@repo/app',
          request: '../../ui/src',
          kind: DependencyKind.StaticImport,
          id: '@repo/ui',
        },
      ],
      '@repo/ui': [
        {
          issuer: '@repo/ui',
          request: '../../shared/src',
          kind: DependencyKind.StaticImport,
          id: '@repo/shared',
        },
      ],
      '@repo/shared': [],
    });
    expect(parseCircular(packageTree)).toEqual([]);
  });

  it('should detect package-level circular dependencies', async () => {
    const tree = await parseDependencyTree(
      ['packages/cycle-a/src/index.ts', 'packages/cycle-b/src/index.ts'],
      {
        cwd: fixture,
      },
    );
    const packageTree = groupDependencyTreeByPackage(tree, fixture);

    const circulars = parseCircular(packageTree);
    expect(circulars).toHaveLength(1);
    expect(circulars[0].sort()).toEqual(['@repo/cycle-a', '@repo/cycle-b']);
  });
});
