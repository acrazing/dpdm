/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2026-05-09 14:35:00
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { DependencyKind } from './consts.js';
import { parseDependencyTree } from './parser.js';
import {
  groupCircularsByPackage,
  groupDependencyTreeByPackage,
  groupEntriesByPackage,
  parseCircular,
} from './utils.js';

async function withProject(
  files: Record<string, string>,
  run: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'dpdm-parser-')),
  );
  try {
    for (const [name, content] of Object.entries(files)) {
      await fs.outputFile(path.join(cwd, name), content);
    }
    await run(cwd);
  } finally {
    await fs.remove(cwd);
  }
}

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

  it('should resolve Bundler paths relative to the tsconfig', async () => {
    await withProject(
      {
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            module: 'esnext',
            moduleResolution: 'bundler',
            paths: { '@shared/*': ['./shared/*'] },
          },
        }),
        'src/index.ts': "export * from '@shared/dep';",
        'shared/dep.ts': 'export const dep = 1;',
      },
      async (cwd) => {
        const tree = await parseDependencyTree('src/index.ts', { cwd });
        expect(tree['src/index.ts']).toMatchObject([
          { request: '@shared/dep', id: 'shared/dep.ts' },
        ]);
      },
    );
  });

  it('should use the inherited baseUrl for bare imports and aliases', async () => {
    await withProject(
      {
        'tsconfig.json': JSON.stringify({ extends: './config/base.json' }),
        'config/base.json': JSON.stringify({
          compilerOptions: {
            module: 'nodenext',
            moduleResolution: 'nodenext',
            baseUrl: '../shared',
            paths: { '@shared/*': ['*'], dep: ['./missing'] },
          },
        }),
        'src/index.ts': ["import 'dep';", "import '@shared/dep';"].join('\n'),
        'shared/dep.ts': 'export const dep = 1;',
      },
      async (cwd) => {
        const tree = await parseDependencyTree('src/index.ts', { cwd });
        expect(tree['src/index.ts']).toMatchObject([
          { request: 'dep', id: 'shared/dep.ts' },
          { request: '@shared/dep', id: 'shared/dep.ts' },
        ]);
      },
    );
  });

  it.each([undefined, 'node'])(
    'should preserve Node10 subpath lookup with moduleResolution=%s',
    async (moduleResolution) => {
      await withProject(
        {
          'tsconfig.json': JSON.stringify({
            compilerOptions: { moduleResolution },
          }),
          'src/index.ts': "import 'legacy-package/private';",
          'node_modules/legacy-package/package.json': JSON.stringify({
            exports: { '.': './public.js' },
          }),
          'node_modules/legacy-package/private.ts': 'export const dep = 1;',
        },
        async (cwd) => {
          const tree = await parseDependencyTree('src/index.ts', { cwd });
          expect(tree['src/index.ts']).toMatchObject([
            {
              request: 'legacy-package/private',
              id: 'node_modules/legacy-package/private.ts',
            },
          ]);
        },
      );
    },
  );

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

  it('should elide type imports and retain ignore comments through transforms', async () => {
    await withProject(
      {
        'src/index.ts': [
          "import type { T } from './types';",
          '// @dpdm-ignore',
          "enum N { X = require('./ignored') }",
          "export { runtime } from './runtime';",
        ].join('\n'),
        'src/types.ts': 'export type T = string;',
        'src/ignored.ts': 'export const ignored = 1;',
        'src/runtime.ts': 'export const runtime = 1;',
      },
      async (cwd) => {
        const original = await parseDependencyTree('src/index.ts', { cwd });
        expect(original['src/index.ts']).toMatchObject([
          { request: './types', id: 'src/types.ts' },
          { request: './runtime', id: 'src/runtime.ts' },
        ]);

        const transformed = await parseDependencyTree('src/index.ts', {
          cwd,
          transform: true,
        });
        expect(transformed['src/index.ts']).toMatchObject([
          { request: './runtime', id: 'src/runtime.ts' },
        ]);
      },
    );
  });

  it('should elide imports used only as types and keep imports used at runtime', async () => {
    await withProject(
      {
        'src/index.tsx': [
          "import { Model } from './model';",
          "import { Runtime, type Options } from './mixed';",
          "import React from './react';",
          "import './setup';",
          "import { Reexport } from './reexport';",
          'export type Shape = typeof Model & Options;',
          'export { Reexport };',
          'export const rendered = <Runtime />;',
        ].join('\n'),
        'src/model.ts': 'export class Model {}',
        'src/mixed.ts':
          'export const Runtime = () => null; export type Options = {};',
        'src/react.ts': 'export default {};',
        'src/setup.ts': 'export {};',
        'src/reexport.ts': 'export const Reexport = 1;',
      },
      async (cwd) => {
        const tree = await parseDependencyTree('src/index.tsx', {
          cwd,
          transform: true,
        });
        expect(tree['src/index.tsx']).toMatchObject([
          { request: './mixed', id: 'src/mixed.ts' },
          { request: './react', id: 'src/react.ts' },
          { request: './setup', id: 'src/setup.ts' },
          { request: './reexport', id: 'src/reexport.ts' },
        ]);
      },
    );
  });

  it('should filter repeated requests using their original source positions', async () => {
    await withProject(
      {
        'src/index.ts': [
          "import { Model } from './shared';",
          "const label = '😀'; import { first } from './shared';",
          '// @dpdm-ignore',
          "import { second } from './shared';",
          "export { type Model, first } from './shared';",
          'export type Type = Model;',
          'export const value = label + (first + second);',
        ].join('\r\n'),
        'src/shared.ts':
          'export type Model = string; export const first = 1, second = 2;',
      },
      async (cwd) => {
        const tree = await parseDependencyTree('src/index.ts', {
          cwd,
          transform: true,
        });
        expect(tree['src/index.ts']).toMatchObject([
          { kind: DependencyKind.StaticImport, id: 'src/shared.ts' },
          { kind: DependencyKind.StaticExport, id: 'src/shared.ts' },
        ]);
      },
    );
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
});
