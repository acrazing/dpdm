/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2026-05-09 14:35:00
 */

import path from 'path';
import { DependencyKind } from './consts';
import { parseDependencyTree } from './parser';
import {
  groupCircularsByPackage,
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

  it('should parse entries with Windows path separators', async () => {
    const tree = await parseDependencyTree('packages\\shared\\src\\index.ts', {
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

  it('should ignore imports preceded by @dpdm-ignore comments', async () => {
    const entries = [
      'packages/comment-ignore/src/index.ts',
      'packages/comment-ignore/src/cycle-b.ts',
    ];
    const tree = await parseDependencyTree(entries, {
      cwd: fixture,
    });

    expect(tree['packages/comment-ignore/src/index.ts']).toEqual([]);
    expect(tree['packages/comment-ignore/src/cycle-b.ts']).toEqual([
      {
        issuer: 'packages/comment-ignore/src/cycle-b.ts',
        request: './index',
        kind: DependencyKind.StaticImport,
        id: 'packages/comment-ignore/src/index.ts',
      },
    ]);
    expect(tree['packages/shared/src/dep.ts']).toBeUndefined();
    expect(tree['packages/ui/src/index.ts']).toBeUndefined();
    expect(parseCircular(tree)).toEqual([]);

    expect(
      await parseDependencyTree(entries, {
        cwd: fixture,
        transform: true,
      }),
    ).toEqual(tree);
  });

  it('should resolve dependencies from the nearest package tsconfig', async () => {
    const source = path.join(fixture, 'packages/ref-cycle/src');
    const tree = await parseDependencyTree('index.ts', {
      cwd: source,
    });

    expect(tree).toEqual({
      'index.ts': [
        {
          issuer: 'index.ts',
          request: '#ref-cycle/a.js',
          kind: DependencyKind.StaticExport,
          id: 'a.ts',
        },
      ],
      'a.ts': [
        {
          issuer: 'a.ts',
          request: './b.js',
          kind: DependencyKind.StaticImport,
          id: 'b.ts',
        },
      ],
      'b.ts': [
        {
          issuer: 'b.ts',
          request: './a.js',
          kind: DependencyKind.StaticImport,
          id: 'a.ts',
        },
      ],
    });
    expect(parseCircular(tree)).toEqual([['a.ts', 'b.ts']]);
  });

  it('should resolve dependencies from referenced tsconfig projects', async () => {
    const packages = path.join(fixture, 'packages');
    const tree = await parseDependencyTree('ref-cycle/src/index.ts', {
      cwd: packages,
      tsconfig: 'tsconfig.json',
    });

    expect(groupCircularsByPackage(parseCircular(tree), packages)).toEqual([
      ['@repo/ref-cycle'],
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

  it('should resolve package.json subpath imports', async () => {
    const subpathFixture = path.join(
      __dirname,
      '../fixtures/parser/subpath-imports',
    );
    const tree = await parseDependencyTree('src/index.js', {
      cwd: subpathFixture,
    });

    expect(tree['src/index.js']!.map((item) => item.id)).toEqual([
      'src/lib/a.js',
      'src/lib/dir/index.js',
      'src/config.js',
    ]);
    expect(parseCircular(tree)).toEqual([['src/lib/a.js', 'src/lib/b.js']]);
  });
});
